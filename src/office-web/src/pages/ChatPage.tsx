import { Fragment, useEffect, useRef, useState } from 'react';
import { previewClient } from '../preview/PreviewClient';
import type { RunningTaskFront } from '../preview/PreviewClient';
import ChatPane from '../components/chat/ChatPane';
import { useChatPane } from '../components/chat/useChatPane';
import { FileView } from '../components/chat/FileView';
import PreviewPage from './PreviewPage';
import QuizBankPage from './QuizBankPage';
import MemorizePage from './MemorizePage';
import SettingsPage from './SettingsPage';
import { TaskChip } from '../components/chat/TaskComponents';
import { MC_CSS } from '../components/chat/chatStyles';
import { IconChat, IconCross, IconDots, IconEdit, IconFiles, IconNew, IconPin, IconSearch, IconShare, IconTrash, IconCaret } from '../components/chat/chatIcons';
import { IconDatabase, IconBrain, IconSettings, IconSun, IconMoon } from '../components/Icons';
import { useTheme } from '../components/ThemeContext';
import type { ModelOption, OpenReq, SelectedModel, Session, SessionNode } from '../components/chat/chatTypes';

/* =========================================================================
 * studentbuddy · 对话页外壳（侧边栏 + 双 Pane 分栏 + 后台任务栏）
 * -------------------------------------------------------------------------
 * 架构（对照预览版 studentbuddy-split-preview.html，已落地到正式代码）：
 *   ChatPage
 *     ├─ 侧边栏（会话列表 + ⋯菜单：置顶/重命名/分享/删除，自绘 SVG，无 emoji）
 *     └─ 内容区 Vertical Split View
 *            ├─ ChatPane A（对话，默认聚焦）
 *            ├─ Splitter（可拖拽；拖到 <84px 自动收起该侧，留恢复条）
 *            └─ ChatPane B（默认文件视图，对标 WorkBuddy 预览面板）
 *
 * 每个 ChatPane 独立持有：sessionId / 消息 / 输入 / 联网搜索 / 上下文用量，
 * 并各自建立一条 EventSource（sessionId 隔离，杜绝串台）。
 * 文件视图复用 previewClient（SSE 全局订阅 artifact），与 PreviewPage 同源。
 * 视觉：全部内联 style + 一段组件级 <style>（仅放 keyframes / 细滚动条 / :hover 等
 *       伪类，前缀 mc- 避免污染其它组件），沿用项目「内联样式」约定。
 * ========================================================================= */

// =========================================================================
// ChatPage —— 外壳：侧边栏 + 分栏视图
// =========================================================================
export default function ChatPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  // 会话树（父子层级）：侧边栏树状历史渲染数据源（/api/sessions/tree）
  const [sessionTree, setSessionTree] = useState<SessionNode[]>([]);
  const [hasProvider, setHasProvider] = useState<boolean | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(null);
  const [focused, setFocused] = useState<'A' | 'B'>('A');
  const [paneInfo, setPaneInfo] = useState<{ A: { sessionId: string | null; view: 'chat' | 'files' }; B: { view: 'preview' } }>({
    A: { sessionId: null, view: 'chat' },
    B: { view: 'preview' },
  });
  // 右栏辅助面板当前子标签：文件（产出/工作区）/ 预览
  const [rightTab, setRightTab] = useState<'files' | 'preview'>('files');
  const [openReq, setOpenReq] = useState<OpenReq | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; onUndo?: () => void } | null>(null);
  // 搜索历史对话：query = 输入关键词；results = 命中消息片段（会话归属）
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{
    id: number; sessionId: string; sessionTitle: string; role: string; snippet: string; ts: string;
  }[]>([]);
  const [searching, setSearching] = useState(false);
  // 搜索框：点击式展开（默认只显示入口按钮，点击后才出现输入框）
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 侧边栏会话列表：整体收起（对话太多时可折叠，仅留新对话入口）
  const [listCollapsed, setListCollapsed] = useState(false);
  // 分组折叠：按根会话分组，collapsedGroups 记录已收起子对话的根会话 id
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (id: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // 搜索历史对话（防抖 300ms）：调 /api/search 检索消息内容
  const runSearch = (q: string) => {
    const query = q.trim();
    if (!query) { setSearchResults([]); return; }
    setSearching(true);
    fetch('/api/search?q=' + encodeURIComponent(query)).then(r => r.json()).then((d: any) => {
      if (d && Array.isArray(d.results)) setSearchResults(d.results);
      else setSearchResults([]);
    }).catch(() => setSearchResults([])).finally(() => setSearching(false));
  };
  const onSearchInput = (v: string) => {
    setSearchQuery(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => runSearch(v), 300);
  };

  // 后台任务（生成中/已完成的会话）：底部任务栏数据源，切走不打断、随时可点回
  const [runningTasks, setRunningTasks] = useState<RunningTaskFront[]>([]);
  const runningTasksRef = useRef<RunningTaskFront[]>([]);
  runningTasksRef.current = runningTasks;

  // 中屏视图：对话（默认）/ 题库 / 设置（由左屏底部入口切换）
  const [centerView, setCenterView] = useState<'chat' | 'quiz' | 'memorize' | 'settings'>('chat');
  // 右屏（文件预览与管理）：唤出式。默认收起；对话中有文件产出时自动弹出；可拖拽调宽，拖到 <84px 自动收起
  const [rightOpen, setRightOpen] = useState(false);
  const [splitPct, setSplitPct] = useState(50); // 右屏宽度百分比（相对中屏+右屏区域）
  const [dragging, setDragging] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  // 主题切换（左屏底部）：图标弹入动画 key
  const [iconKey, setIconKey] = useState(0);
  const { isDark, toggle } = useTheme();
  const handleToggle = () => { setIconKey(k => k + 1); toggle(); };

  // 计时 toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.onUndo ? 4000 : 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // 初始加载：状态 / 会话列表。联网搜索为默认开启（对话页不再提供开关）；
  // 若旧库 search_config 仍为关闭，这里强制开启一次，保证「默认联网搜索」对所有库生效。
  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(d => {
      setHasProvider(d.hasProviders);
      if (d.hasProviders) {
        fetch('/api/sessions').then(r => r.json()).then((list: Session[]) => {
          setSessions(list);
          if (list.length > 0) {
            setPaneInfo(p => ({ ...p, A: { sessionId: list[0].id, view: 'chat' } }));
            setOpenReq({ pane: 'A', sessionId: list[0].id, nonce: Date.now() });
          }
        });
        fetch('/api/sessions/tree').then(r => r.json()).then((td: any) => {
          if (td && Array.isArray(td.roots)) setSessionTree(td.roots as SessionNode[]);
        }).catch(() => {});
      }
    });
    fetch('/api/search-config').then(r => r.json()).then(cfg => {
      if (cfg && !cfg.enabled) {
        fetch('/api/search-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true, provider: 'duckduckgo' }) }).catch(() => {});
      }
    }).catch(() => {});
    loadModels();
    previewClient.start();

    // 运行任务订阅：先拉一次快照对齐（兼容页面刷新时已有后台任务），再收实时事件
    previewClient.subscribeRunning(onRunState);
    fetch('/api/running-tasks').then(r => r.json()).then((d: any) => {
      if (Array.isArray(d.tasks)) setRunningTasks(prev => mergeRunning(prev, d.tasks.map((t: any) => ({ ...t }))));
    }).catch(() => {});
  }, []);

  // 合并 run-state 事件到 runningTasks（按 sessionId upsert / done 标记 / removed 移除）
  function mergeRunning(prev: RunningTaskFront[], next: RunningTaskFront[]): RunningTaskFront[] {
    const map = new Map<string, RunningTaskFront>();
    for (const t of prev) map.set(t.sessionId, t);
    for (const t of next) map.set(t.sessionId, { ...t });
    return [...map.values()].sort((a, b) => a.startedAt - b.startedAt);
  }
  function onRunState(d: { sessionId: string; task?: RunningTaskFront; done?: boolean; error?: string; removed?: boolean; aborted?: boolean }) {
    setRunningTasks(prev => {
      let next: RunningTaskFront[];
      if (d.removed || (d.done && !d.task)) {
        next = prev.filter(t => t.sessionId !== d.sessionId);
      } else if (d.task) {
        next = mergeRunning(prev, [{ ...d.task, done: d.done, error: d.error, aborted: d.aborted }]);
      } else {
        next = prev;
      }
      return next;
    });
  }

  async function loadModels() {
    try {
      const [opts, sel] = await Promise.all([
        fetch('/api/model-options').then(r => r.json()),
        fetch('/api/model').then(r => r.json()),
      ]);
      const optsArr = Array.isArray(opts) ? opts as ModelOption[] : [];
      setModelOptions(optsArr);
      if (sel && sel.providerId && sel.model) {
        setSelectedModel({ providerId: sel.providerId, model: sel.model });
      } else if (optsArr.length > 0) {
        setSelectedModel({ providerId: optsArr[0].providerId, model: optsArr[0].models[0] });
      }
    } catch { /* ignore */ }
  }

  function selectModel(m: SelectedModel) {
    setSelectedModel(m);
    fetch('/api/model', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) }).catch(() => {});
  }

  function refreshSessions() {
    fetch('/api/sessions').then(r => r.json()).then(setSessions).catch(() => {});
    // 会话树（父子层级）：侧边栏树状历史渲染用
    fetch('/api/sessions/tree').then(r => r.json()).then((d: any) => {
      if (d && Array.isArray(d.roots)) setSessionTree(d.roots as SessionNode[]);
    }).catch(() => {});
  }

  // 派生子对话（fork）：以某会话为父创建独立子会话，并立即在对话面板打开
  async function forkSession(id: string) {
    try {
      const r = await fetch(`/api/sessions/${id}/fork`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const d = await r.json();
      if (!r.ok || !d.id) { setToast({ msg: '派生子对话失败：' + (d.error || '') }); return; }
      refreshSessions();
      openInPane(d.id);
      setToast({ msg: '已派生子对话「' + (d.title || '') + '」，可在此继续追问' });
    } catch { setToast({ msg: '派生子对话失败' }); }
  }

  // 在「对话面板 A」打开会话（B 面板固定为预览，不再承载对话）
  function openInPane(id: string) {
    setCenterView('chat');
    setFocused('A');
    setPaneInfo(p => ({ ...p, A: { sessionId: id, view: 'chat' } }));
    setOpenReq({ pane: 'A', sessionId: id, nonce: Date.now() });
  }
  function newConversation() {
    setCenterView('chat');
    setFocused('A');
    setPaneInfo(p => ({ ...p, A: { sessionId: null, view: 'chat' } }));
    setOpenReq({ pane: 'A', sessionId: null, nonce: Date.now() });
  }

  async function togglePin(id: string) {
    try {
      await fetch(`/api/sessions/${id}/pin`, { method: 'PUT' });
      refreshSessions();
    } catch { /* ignore */ }
  }
  async function renameSession(id: string, title: string) {
    const t = title.trim();
    if (!t) { setRenamingId(null); return; }
    try {
      await fetch(`/api/sessions/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t }) });
      refreshSessions();
    } catch { /* ignore */ }
    setRenamingId(null);
  }
  async function shareSession(id: string) {
    try {
      const r = await fetch(`/api/sessions/${id}/share`, { method: 'POST' });
      const d = await r.json();
      if (d.markdown) {
        try { await navigator.clipboard.writeText(d.markdown); } catch { /* 剪贴板不可用时忽略 */ }
        setToast({ msg: '已复制分享内容（含导出 Markdown）' });
      }
    } catch { setToast({ msg: '分享失败' }); }
  }
  async function deleteSession(id: string) {
    try {
      const r = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      if (!r.ok) return;
      refreshSessions();
      setToast({ msg: '已删除对话' });
      // 若被删会话正打开在对话面板 A：重置为新对话状态，
      // 避免「对话已删除但面板里还显示旧内容」的界面残留。（B 面板为预览，无会话）
      if (paneInfo.A.sessionId === id) {
        setPaneInfo(p => ({ ...p, A: { ...p.A, sessionId: null } }));
        setOpenReq({ pane: 'A', sessionId: null, nonce: Date.now() });
      }
    } catch { /* ignore */ }
  }

  function openMenu(id: string, x: number, y: number) {
    setMenu({ id, x, y });
  }

  // 背诵页「AI 学」联动：fork 当前会话为子对话，在子对话中让 AI 讲解/造句/出题该词条，并打开子对话
  async function forkMemorizeTerm(term: string, definition: string, mode: 'explain' | 'example' | 'quiz') {
    const parentId = storeA.sid;
    if (!parentId) {
      setToast({ msg: '请先在对话页打开一个会话，再点「AI 学」' });
      return;
    }
    try {
      const resp = await fetch(`/api/sessions/${encodeURIComponent(parentId)}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `背诵 · ${term.slice(0, 20)}` }),
      });
      const d = await resp.json().catch(() => null);
      if (!resp.ok || !d || !d.id) throw new Error((d && d.error) || '派生子对话失败');
      const modeName = mode === 'example' ? '造句/举例' : mode === 'quiz' ? '出题' : '讲解';
      const text = `请针对词条「${term}」${definition ? `（释义：${definition}）` : ''}，给我 ${modeName} 内容，帮助我记住这个词条。用 Markdown 组织，语言通俗。`;
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, sessionId: d.id }),
      }).catch(() => { /* 子对话由网关异步执行，失败不阻断打开 */ });
      setCenterView('chat');
      storeA.openSession(d.id);
    } catch (err: any) {
      setToast({ msg: '开启词条学习失败：' + err.message });
    }
  }

  // 左栏对话 store：提升到页面级，右栏辅助面板（文件/预览）与左栏共享同一份会话状态。
  // 注意 hooks 必须无条件调用，故放在 hasProvider 早退之前。
  const storeA = useChatPane({
    paneId: 'A', focused: focused === 'A', view: 'chat', openReq, sessions, sessionTree,
    modelOptions, selectedModel, onSelectModel: selectModel,
    onFocus: () => setFocused('A'), onViewChange: v => setPaneInfo(p => ({ ...p, A: { ...p.A, view: v } })),
    onPaneSessionKnown: id => setPaneInfo(p => ({ ...p, A: { ...p.A, sessionId: id } })),
    onSessionsMutated: refreshSessions, onToast: (msg) => setToast({ msg }),
    runningSessionIds: runningTasks.filter(t => !t.done && t.phase !== 'error').map(t => t.sessionId),
  });

  // ── 唤出式右屏 ─────────────────────────────────────────────
  // 自动弹出：对话视图下，当本会话有文件产出（变更/产物）时弹出；新产出到达时无视用户上次手动收起强制弹出。
  // 手动收起（拖到 <84px 或点 ×）后，除非有新产出或切换会话，不再自动弹出。
  const hasFiles = storeA.paneArtifacts.length > 0 || storeA.paneChanges.length > 0;
  const prevHasFilesRef = useRef(false);
  const userClosedRef = useRef(false);
  useEffect(() => {
    const gained = hasFiles && !prevHasFilesRef.current;
    prevHasFilesRef.current = hasFiles;
    if (centerView !== 'chat') { setRightOpen(false); return; }
    if (gained) { userClosedRef.current = false; setRightOpen(true); return; }
    if (hasFiles && !userClosedRef.current && !rightOpen) setRightOpen(true);
  }, [centerView, hasFiles, rightOpen]);

  // Splitter 拖动：调整右屏宽度（相对中屏+右屏区域）；拖到 <84px 自动收起
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const el = contentRef.current; if (!el) return;
      const r = el.getBoundingClientRect();
      const rightW = r.right - e.clientX;
      if (rightW < 84) { userClosedRef.current = true; setRightOpen(false); setDragging(false); return; }
      setSplitPct(Math.max(20, Math.min(70, (rightW / r.width) * 100)));
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging]);

  // 树状历史：递归渲染会话节点（根 + 子对话缩进，分支标识 + 更多菜单）。
  // 依赖 side-scope 状态：activeSessionIds / runningTasks / renamingId 等。
  // 分组折叠：根会话（有 children 时）显示折叠箭头，collapsedGroups 记录已收起的根 id，收起时隐藏其子对话。
  const renderTreeNode = (nodes: SessionNode[]): React.ReactNode =>
    nodes.map((s) => {
      const isActive = activeSessionIds.has(s.id);
      const isRunning = runningTasks.some(t => t.sessionId === s.id && !t.done && t.phase !== 'error');
      const indent = 6 + s.depth * 12; // 子对话逐层右缩
      const hasChildren = !!(s.children && s.children.length > 0);
      const groupCollapsed = s.depth === 0 && collapsedGroups.has(s.id);
      const showChildren = hasChildren && !groupCollapsed;
      return (
        <Fragment key={s.id}>
          <div
            className={`mc-row ${isActive ? 'active' : ''} ${s.pinned ? 'pinned' : ''} ${renamingId === s.id ? 'renaming' : ''}`}
            onClick={() => { if (renamingId !== s.id) openInPane(s.id); }}
            style={{ paddingLeft: indent, ...(renamingId === s.id ? { background: 'transparent' } : {}) }}>
            {renamingId === s.id ? (
              <input autoFocus defaultValue={s.title}
                onKeyDown={e => { if (e.key === 'Enter') renameSession(s.id, (e.target as HTMLInputElement).value); else if (e.key === 'Escape') setRenamingId(null); }}
                onBlur={e => renameSession(s.id, e.target.value)}
                style={{ width: '100%', fontSize: 12, fontFamily: 'inherit', border: '1px solid var(--mc-accent)', borderRadius: 5, padding: '2px 5px', outline: 'none', background: 'var(--mc-glass-strong)', color: 'var(--mc-text)' }} />
            ) : (
              <>
                {s.depth > 0 && <span style={{ color: 'var(--mc-pin)', display: 'flex', flexShrink: 0, fontSize: 10 }}>└</span>}
                {/* 分组折叠箭头：仅根会话且带子对话时显示，点击展开/收起整组 */}
                {hasChildren && s.depth === 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleGroup(s.id); }}
                    title={groupCollapsed ? '展开该组对话' : '收起该组对话'}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      width: 16, height: 16, padding: 0, border: 'none', borderRadius: 4,
                      background: 'transparent', color: 'var(--mc-muted2)', cursor: 'pointer',
                      transition: 'transform .2s, background .15s, color .15s',
                      transform: groupCollapsed ? 'rotate(-90deg)' : 'none',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--mc-hair)'; e.currentTarget.style.color = 'var(--mc-text)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--mc-muted2)'; }}>
                    <IconCaret />
                  </button>
                )}
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {s.pinned > 0 ? (
                    <span style={{ color: 'var(--mc-pin)', display: 'flex', flexShrink: 0 }}><IconPin /></span>
                  ) : (
                    <span style={{ color: 'var(--mc-muted2)', display: 'flex', flexShrink: 0 }}><IconChat /></span>
                  )}
                  <span>{s.title || '新对话'}</span>
                  {isRunning && (
                    <span className="mc-spin" style={{ width: 11, height: 11, borderRadius: '50%', border: '2px solid var(--mc-accent)', borderTopColor: 'transparent', flexShrink: 0 }} title="后台生成中" />
                  )}
                </span>
                <button className="mc-more" onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); openMenu(s.id, r.right - 168, r.bottom + 4); }} title="更多操作"><IconDots /></button>
              </>
            )}
          </div>
          {showChildren && renderTreeNode(s.children)}
        </Fragment>
      );
    });

  if (hasProvider === false) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 16, color: 'var(--mc-muted)' }}>请先在设置页添加 API 服务商</div>
        <div style={{ fontSize: 13, color: 'var(--mc-muted2)' }}>点击左侧底部「设置」入口，填写 API Key</div>
      </div>
    );
  }
  if (hasProvider === null) {
    return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mc-muted2)', fontSize: 14 }}>加载中...</div>;
  }

  const sorted = [...sessions].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (a.updated_at < b.updated_at ? 1 : -1));
  const activeSessionIds = new Set(
    (paneInfo.A.view === 'chat' && paneInfo.A.sessionId ? [paneInfo.A.sessionId] : [])
  );
  // 仍在后台生成中的会话 id（切回时恢复 busy 动画）
  const runningIds = runningTasks.filter(t => !t.done && t.phase !== 'error').map(t => t.sessionId);

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden', position: 'relative', background: 'var(--mc-bg)', fontFamily: '-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif', fontSize: 14, color: 'var(--mc-text)', WebkitFontSmoothing: 'antialiased' }}>
      <style>{MC_CSS}</style>

      {/* ─── 玻璃背景装饰层：品牌色光斑（翠绿+蓝），供上方毛玻璃面板 backdrop-filter 透过；zIndex:-1 置于内容之下 ─── */}
      <div style={{ position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', width: 620, height: 620, borderRadius: '50%', left: -180, top: -160, background: 'radial-gradient(circle at 35% 35%, rgba(0,185,107,.26), transparent 70%)', filter: 'blur(80px)' }} />
        <div style={{ position: 'absolute', width: 540, height: 540, borderRadius: '50%', right: -160, bottom: -140, background: 'radial-gradient(circle at 60% 40%, rgba(22,119,255,.22), transparent 70%)', filter: 'blur(86px)' }} />
      </div>

      {/* ─── 左屏（1 份）：对话管理 ─── */}
      <aside style={{ flex: 1, minWidth: 0, background: 'var(--mc-glass-grad)', backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)', borderRight: '1px solid var(--mc-glass-border)', boxShadow: 'var(--mc-glow-hi)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '6px', borderBottom: '1px solid var(--mc-hair)', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {/* 新对话：绿色渐变主按钮（对齐 WorkBuddy 新建任务样式） */}
          <button onClick={newConversation} title="新对话"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              padding: '9px 8px', borderRadius: 9, width: '100%',
              border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
              background: 'linear-gradient(135deg, #00B96B, #00A85F)',
              color: '#fff',
              boxShadow: '0 2px 8px rgba(0,185,107,.25)',
              transition: 'transform .15s, box-shadow .15s, filter .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,185,107,.35)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,185,107,.25)'; }}
            onMouseDown={e => { e.currentTarget.style.filter = 'brightness(.95)'; }}
            onMouseUp={e => { e.currentTarget.style.filter = 'none'; }}>
            <span style={{ display: 'inline-flex' }}><IconNew /></span> 新对话
          </button>

          {/* 搜索历史对话：点击式展开（默认入口按钮，点击后才出现输入框） */}
          {searchOpen ? (
            <div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'var(--mc-seg)', borderRadius: 7, padding: '0 7px', height: 28,
                border: '1px solid var(--mc-hair)', transition: 'border-color .15s',
              }}
                onFocusCapture={e => { e.currentTarget.style.borderColor = 'var(--mc-accent)'; }}
                onBlurCapture={e => { e.currentTarget.style.borderColor = 'var(--mc-hair)'; }}>
                <span style={{ color: 'var(--mc-muted)', flexShrink: 0, display: 'inline-flex' }}><IconSearch /></span>
                <input autoFocus value={searchQuery} onChange={e => onSearchInput(e.target.value)}
                  placeholder="搜索历史对话…" style={{
                    flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none',
                    fontSize: 12, color: 'var(--mc-text)', fontFamily: 'inherit',
                  }} />
                {searchQuery ? (
                  <button onClick={() => { setSearchQuery(''); setSearchResults([]); if (searchTimer.current) clearTimeout(searchTimer.current); }}
                    title="清空" style={{ border: 'none', background: 'transparent', color: 'var(--mc-muted2)', cursor: 'pointer', fontSize: 11, padding: '2px 4px', display: 'inline-flex' }}><IconCross /></button>
                ) : (
                  <button onClick={() => { setSearchOpen(false); }}
                    title="收起搜索" style={{ border: 'none', background: 'transparent', color: 'var(--mc-muted2)', cursor: 'pointer', fontSize: 11, padding: '2px 4px', display: 'inline-flex' }}><IconCross /></button>
                )}
              </div>
              {searchQuery && (
                <div className="mc-scroll" style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 0 8px' }}>
                  {searching && <div style={{ fontSize: 11.5, color: 'var(--mc-muted2)', padding: '4px 6px' }}>搜索中…</div>}
                  {!searching && searchResults.length === 0 && (
                    <div style={{ fontSize: 11.5, color: 'var(--mc-muted2)', padding: '4px 6px' }}>未找到匹配的对话</div>
                  )}
                  {searchResults.map(r => (
                    <button key={r.id} onClick={() => { openInPane(r.sessionId); setSearchOpen(false); setSearchQuery(''); setSearchResults([]); }}
                      title={`${r.sessionTitle} · ${r.role === 'user' ? '我' : 'AI'} · ${r.ts}`}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3,
                        padding: '7px 9px', borderRadius: 8, border: 'none', background: 'transparent',
                        cursor: 'pointer', textAlign: 'left', fontSize: 12, color: 'var(--mc-text)',
                        transition: 'background .12s', flexShrink: 0,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--mc-hair)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--mc-accent)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                        {r.sessionTitle}
                        <span style={{ color: 'var(--mc-muted2)', fontWeight: 400, marginLeft: 6 }}>{r.role === 'user' ? '我' : 'AI'}</span>
                      </span>
                      <span style={{ fontSize: 11.5, color: 'var(--mc-muted)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.snippet}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <button onClick={() => setSearchOpen(true)} title="搜索历史对话"
              className="mc-float"
              style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 7,
                border: 'none', cursor: 'pointer', fontSize: 12, textAlign: 'left', width: '100%',
                background: 'transparent', color: 'var(--mc-muted)',
                transition: 'background .15s, color .15s, transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--mc-hair)'; e.currentTarget.style.color = 'var(--mc-text)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--mc-muted)'; }}>
              <span className="mc-float-icon" style={{ display: 'inline-flex', color: 'var(--mc-muted)' }}><IconSearch /></span> 搜索历史对话
            </button>
          )}
        </div>
        {/* 会话列表头：整体收起/展开切换（对话太多时可折叠，仅留一条计数栏） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px 1px' }}>
          <button
            onClick={() => setListCollapsed(v => !v)}
            title={listCollapsed ? '展开对话列表' : '收起对话列表'}
            className="mc-float"
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', borderRadius: 6,
              border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--mc-muted)',
              background: 'transparent', transition: 'background .15s, color .15s, transform .16s cubic-bezier(.2,.7,.3,1)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--mc-hair)'; e.currentTarget.style.color = 'var(--mc-text)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--mc-muted)'; }}>
            <span style={{ display: 'inline-flex', transform: listCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform .2s' }}><IconCaret /></span>
            {listCollapsed ? `展开对话（${sessions.length}）` : '收起对话'}
          </button>
        </div>
        {!listCollapsed ? (
          <div className="mc-scroll" style={{ flex: 1, overflowY: 'auto', padding: '4px 6px', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {/* 会话树：树状节点（根 + 子对话缩进；节点可打开/更多菜单） */}
            {renderTreeNode(sessionTree.length > 0 ? sessionTree : sorted.map(s => ({ ...s, depth: 0, children: [] as SessionNode[] })))}
          </div>
        ) : (
          /* 收起态：仅显示计数摘要，占位保高 */
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--mc-muted2)', userSelect: 'none' }}>
            共 {sessions.length} 个对话已收起
          </div>
        )}

        {/* 底部：文件预览 / 题库 / 设置 入口 + 主题切换 */}
        <div style={{ padding: '6px', borderTop: '1px solid var(--mc-hair)', display: 'flex', flexDirection: 'column', gap: 1 }}>
          <button
            onClick={() => setRightOpen(true)}
            title="唤出文件预览面板"
            className="mc-float"
            style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 7,
              border: 'none', cursor: 'pointer', fontSize: 12, textAlign: 'left', width: '100%',
              background: rightOpen && centerView === 'chat' ? 'var(--mc-accent-soft)' : 'transparent',
              color: rightOpen && centerView === 'chat' ? 'var(--mc-accent)' : 'var(--mc-muted)',
              fontWeight: rightOpen && centerView === 'chat' ? 600 : 400,
              transition: 'background .15s, color .15s, transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s',
            }}>
            <span className="mc-float-icon" style={{ display: 'inline-flex' }}><IconFiles /></span> 文件预览
          </button>
          <button
            onClick={() => setCenterView('quiz')}
            className="mc-float"
            style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 7,
              border: 'none', cursor: 'pointer', fontSize: 12, textAlign: 'left', width: '100%',
              background: centerView === 'quiz' ? 'var(--mc-accent-soft)' : 'transparent',
              color: centerView === 'quiz' ? 'var(--mc-accent)' : 'var(--mc-muted)',
              fontWeight: centerView === 'quiz' ? 600 : 400,
              transition: 'background .15s, color .15s, transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s',
            }}>
            <span className="mc-float-icon" style={{ display: 'inline-flex' }}><IconDatabase size={15} /></span> 题库
          </button>
          <button
            onClick={() => setCenterView('memorize')}
            className="mc-float"
            style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 7,
              border: 'none', cursor: 'pointer', fontSize: 12, textAlign: 'left', width: '100%',
              background: centerView === 'memorize' ? 'var(--mc-accent-soft)' : 'transparent',
              color: centerView === 'memorize' ? 'var(--mc-accent)' : 'var(--mc-muted)',
              fontWeight: centerView === 'memorize' ? 600 : 400,
              transition: 'background .15s, color .15s, transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s',
            }}>
            <span className="mc-float-icon" style={{ display: 'inline-flex' }}><IconBrain size={15} /></span> 背背背
          </button>
          <button
            onClick={() => setCenterView('settings')}
            className="mc-float"
            style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 7,
              border: 'none', cursor: 'pointer', fontSize: 12, textAlign: 'left', width: '100%',
              background: centerView === 'settings' ? 'var(--mc-accent-soft)' : 'transparent',
              color: centerView === 'settings' ? 'var(--mc-accent)' : 'var(--mc-muted)',
              fontWeight: centerView === 'settings' ? 600 : 400,
              transition: 'background .15s, color .15s, transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s',
            }}>
            <span className="mc-float-icon" style={{ display: 'inline-flex' }}><IconSettings size={15} /></span> 设置
          </button>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px 2px', borderTop: '1px solid var(--mc-hair)', marginTop: 1 }}>
            <span style={{ fontSize: 11, color: 'var(--mc-muted2)' }}>本地模式</span>
            <button onClick={handleToggle} title={isDark ? '切换到亮色模式' : '切换到暗色模式'}
              className="mc-float"
              style={{ width: 28, height: 28, flexShrink: 0, border: 'none', borderRadius: 8, background: 'var(--mc-seg)', color: 'var(--mc-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .15s, color .15s, transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--mc-hair)'; e.currentTarget.style.color = 'var(--mc-accent)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--mc-seg)'; e.currentTarget.style.color = 'var(--mc-muted)'; }}>
              <span key={iconKey} className="theme-pop mc-float-icon">{isDark ? <IconSun size={14} /> : <IconMoon size={14} />}</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ─── 中屏（4.5 份，弹性）+ 右屏（唤出式，可拖拽）─── */}
      <main ref={contentRef} style={{ flex: 9, minWidth: 0, display: 'flex', gap: 10, padding: 10, position: 'relative' }}>
        <div key={centerView} className="mc-fade-up" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {centerView === 'chat' ? (
            <ChatPane
              store={storeA} focused={focused === 'A'} onFocus={() => setFocused('A')}
              style={{ flex: 1, display: 'flex', minHeight: 0 }}
            />
          ) : centerView === 'quiz' ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
              <QuizBankPage />
            </div>
          ) : centerView === 'memorize' ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
              <MemorizePage sessionId={storeA.sid} onForkTerm={forkMemorizeTerm} />
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
              <SettingsPage />
            </div>
          )}
        </div>

        {/* 右屏：唤出式文件预览与管理（对话中有文件产出时自动弹出 / 手动唤出；可拖拽调宽，拖到 <84px 自动收起） */}
        {rightOpen && (
          <>
            <div className="mc-splitter" style={{ width: 6, flex: '0 0 6px', cursor: 'col-resize', alignSelf: 'stretch' }}
              onMouseDown={() => setDragging(true)} title="拖拽调整宽度" />
            <aside className="mc-slide-in-right" style={{ width: `${splitPct}%`, flexShrink: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
              <div
                onMouseDown={() => setFocused('B')}
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0,
                  background: 'var(--mc-glass-grad)',
                  backdropFilter: 'blur(28px) saturate(180%)', WebkitBackdropFilter: 'blur(28px) saturate(180%)',
                  border: '1px solid var(--mc-glass-border)', borderRadius: 18, overflow: 'hidden', boxShadow: 'var(--mc-glow-hi), var(--mc-shadow-md)',
                }}
              >
                {/* 辅助面板标签条：文件 / 预览 + 收起 */}
                <div style={{ display: 'flex', gap: 2, alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid var(--mc-hair)', background: 'var(--mc-glass)', flexShrink: 0 }}>
                  <button className={`mc-pill ${rightTab === 'files' ? 'on' : ''}`} onClick={() => setRightTab('files')} title="产出文件 / 工作区">文件</button>
                  <button className={`mc-pill ${rightTab === 'preview' ? 'on' : ''}`} onClick={() => setRightTab('preview')} title="AI 产物实时预览">预览</button>
                  <button onClick={() => { userClosedRef.current = true; setRightOpen(false); }}
                    title="收起文件预览" style={{ marginLeft: 'auto', width: 26, height: 26, border: 'none', borderRadius: 7, background: 'var(--mc-seg)', color: 'var(--mc-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .15s, color .15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--mc-hair)'; e.currentTarget.style.color = 'var(--mc-text)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'var(--mc-seg)'; e.currentTarget.style.color = 'var(--mc-muted)'; }}>
                    <IconCross />
                  </button>
                </div>
                {rightTab === 'files' ? <FileView store={storeA} /> : <PreviewPage initialHtml={null} />}
              </div>
            </aside>
          </>
        )}
      </main>

      {/* ⋯ 浮动菜单 */}
      {menu && (
        <div className="mc-menu" style={{ top: menu.y, left: Math.max(8, menu.x) }}>
          <button onClick={() => { togglePin(menu.id); setMenu(null); }}>
            <span className="mi"><IconPin /></span><span>{sorted.find(s => s.id === menu.id)?.pinned ? '取消置顶' : '置顶'}</span>
          </button>
          <button onClick={() => { setRenamingId(menu.id); setMenu(null); }}>
            <span className="mi"><IconEdit /></span><span>重命名</span>
          </button>
          <button onClick={() => { forkSession(menu.id); setMenu(null); }}>
            <span className="mi"><IconChat /></span><span>派生子对话（fork）</span>
          </button>
          <button onClick={() => { shareSession(menu.id); setMenu(null); }}>
            <span className="mi"><IconShare /></span><span>分享任务</span>
          </button>
          <div className="sep" />
          <button className="danger" onClick={() => { deleteSession(menu.id); setMenu(null); }}>
            <span className="mi"><IconTrash /></span><span>删除</span>
          </button>
        </div>
      )}
      {menu && <div style={{ position: 'fixed', inset: 0, zIndex: 55 }} onClick={() => setMenu(null)} />}

      {/* 后台任务栏：任意会话生成时固定在底部，随阶段实时刷新；点击即切回对应会话 */}
      {runningTasks.length > 0 && (
        <div style={{ position: 'fixed', left: '50%', bottom: 16, transform: 'translateX(-50%)', zIndex: 70, display: 'flex', gap: 8, maxWidth: 'min(92vw, 760px)', flexWrap: 'nowrap', overflowX: 'auto' }}>
          {runningTasks.map(t => <TaskChip key={t.sessionId} task={t} onClick={() => openInPane(t.sessionId)} />)}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 80 }}>
          <div className="mc-toast">
            <span>{toast.msg}</span>
          </div>
        </div>
      )}
    </div>
  );
}
