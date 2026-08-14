import { Fragment, useEffect, useRef, useState } from 'react';
import { previewClient } from '../preview/PreviewClient';
import type { RunningTaskFront } from '../preview/PreviewClient';
import ChatPane from '../components/chat/ChatPane';
import { useChatPane } from '../components/chat/useChatPane';
import { FileView } from '../components/chat/FileView';
import PreviewPage from './PreviewPage';
import { TaskChip } from '../components/chat/TaskComponents';
import { MC_CSS } from '../components/chat/chatStyles';
import { IconChat, IconDots, IconEdit, IconMenu, IconNew, IconPin, IconSearch, IconShare, IconTrash } from '../components/chat/chatIcons';
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
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Splitter 状态
  const [splitPct, setSplitPct] = useState(60); // 非对称：对话更宽（默认 60/40）
  const [collapsed, setCollapsed] = useState<null | 'A' | 'B'>(null);
  const [dragging, setDragging] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  // 侧边栏折叠（WorkBuddy 式图标条）：持久化到 localStorage
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('mc-sidebar-collapsed') === '1'; } catch { return false; }
  });
  const toggleSidebar = () => {
    setSidebarCollapsed(v => {
      try { localStorage.setItem('mc-sidebar-collapsed', v ? '0' : '1'); } catch { /* ignore */ }
      return !v;
    });
  };

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

  // Splitter 拖动（<84px 自动收起该侧）
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const el = contentRef.current; if (!el) return;
      const r = el.getBoundingClientRect();
      const aW = e.clientX - r.left;
      if (aW < 84) { setCollapsed('A'); setDragging(false); return; }
      if (r.width - aW < 84) { setCollapsed('B'); setDragging(false); return; }
      setSplitPct(Math.max(20, Math.min(80, (aW / r.width) * 100)));
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging]);

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
    setFocused('A');
    setPaneInfo(p => ({ ...p, A: { sessionId: id, view: 'chat' } }));
    setOpenReq({ pane: 'A', sessionId: id, nonce: Date.now() });
  }
  function newConversation() {
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

  // 左栏对话 store：提升到页面级，右栏辅助面板（文件/预览）与左栏共享同一份会话状态。
  // 注意 hooks 必须无条件调用，故放在 hasProvider 早退之前。
  const storeA = useChatPane({
    paneId: 'A', focused: focused === 'A', view: 'chat', openReq, sessions,
    modelOptions, selectedModel, onSelectModel: selectModel,
    onFocus: () => setFocused('A'), onViewChange: v => setPaneInfo(p => ({ ...p, A: { ...p.A, view: v } })),
    onPaneSessionKnown: id => setPaneInfo(p => ({ ...p, A: { ...p.A, sessionId: id } })),
    onSessionsMutated: refreshSessions, onToast: (msg) => setToast({ msg }),
    runningSessionIds: runningTasks.filter(t => !t.done && t.phase !== 'error').map(t => t.sessionId),
  });

  // 树状历史：递归渲染会话节点（根 + 子对话缩进，分支标识 + 更多菜单）。
  // 依赖 side-scope 状态：activeSessionIds / runningTasks / renamingId 等。
  const renderTreeNode = (nodes: SessionNode[]): React.ReactNode =>
    nodes.map((s) => {
      const isActive = activeSessionIds.has(s.id);
      const isRunning = runningTasks.some(t => t.sessionId === s.id && !t.done && t.phase !== 'error');
      const indent = 8 + s.depth * 14; // 子对话逐层右缩
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
                style={{ width: '100%', fontSize: 13.5, fontFamily: 'inherit', border: '1px solid var(--mc-accent)', borderRadius: 5, padding: '2px 5px', outline: 'none', background: 'var(--mc-glass-strong)', color: 'var(--mc-text)' }} />
            ) : (
              <>
                {s.depth > 0 && <span style={{ color: 'var(--mc-pin)', display: 'flex', flexShrink: 0, fontSize: 10 }}>└</span>}
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {s.pinned && <span style={{ color: 'var(--mc-pin)', display: 'flex', flexShrink: 0 }}><IconPin /></span>}
                  <span>{s.title || '新对话'}</span>
                  {isRunning && (
                    <span className="mc-spin" style={{ width: 11, height: 11, borderRadius: '50%', border: '2px solid var(--mc-accent)', borderTopColor: 'transparent', flexShrink: 0 }} title="后台生成中" />
                  )}
                </span>
                <button className="mc-more" onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); openMenu(s.id, r.right - 168, r.bottom + 4); }} title="更多操作"><IconDots /></button>
              </>
            )}
          </div>
          {s.children && s.children.length > 0 && renderTreeNode(s.children)}
        </Fragment>
      );
    });

  if (hasProvider === false) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 16, color: 'var(--mc-muted)' }}>请先在设置页添加 API 服务商</div>
        <div style={{ fontSize: 13, color: 'var(--mc-muted2)' }}>点击上方「设置」标签，填写 API Key</div>
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

  // Pane 宽度计算
  const paneAWidth = collapsed === 'B' ? '100%' : collapsed === 'A' ? '0' : `${splitPct}%`;
  const paneBWidth = collapsed === 'A' ? '100%' : collapsed === 'B' ? '0' : `${100 - splitPct}%`;
  const paneAFlex = collapsed ? 1 : 0;
  const paneBFlex = collapsed ? 1 : 0;

  return (
    <div style={{ height: '100%', display: 'flex', background: 'var(--mc-bg)', fontFamily: '-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif', fontSize: 14, color: 'var(--mc-text)', WebkitFontSmoothing: 'antialiased' }}>
      <style>{MC_CSS}</style>

      {/* 侧边栏：可折叠（WorkBuddy 式图标条） */}
      <aside style={{ width: sidebarCollapsed ? 60 : 216, flexShrink: 0, background: 'var(--mc-glass)', backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)', borderRight: '1px solid var(--mc-hair)', display: 'flex', flexDirection: 'column', transition: 'width .2s ease' }}>
        <div style={{ padding: '10px 8px 8px', borderBottom: '1px solid var(--mc-hair)', display: 'flex', flexDirection: sidebarCollapsed ? 'column' : 'row', alignItems: 'center', gap: 6 }}>
          {/* 三杠：展开/收起侧边栏（展开态与收起态均显示，点击即伸缩） */}
          <button onClick={toggleSidebar} title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            style={{ width: 28, height: 28, flexShrink: 0, border: 'none', borderRadius: 8, background: 'var(--mc-seg)', color: 'var(--mc-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .15s, color .15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--mc-hair)'; e.currentTarget.style.color = 'var(--mc-text)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--mc-seg)'; e.currentTarget.style.color = 'var(--mc-muted)'; }}>
            <IconMenu />
          </button>
          <button className="mc-newbtn" onClick={newConversation} title="新对话"
            style={sidebarCollapsed
              ? { width: 36, height: 36, padding: 0, flex: '0 0 auto', borderRadius: 10 }
              : { flex: 1, minWidth: 0, padding: '8px' }}>
            <IconNew />{!sidebarCollapsed && '新对话'}
          </button>
        </div>
        {/* 搜索历史对话：输入关键词检索历史消息，点结果跳转到对应会话 */}
        {!sidebarCollapsed && (
          <div style={{ padding: '8px 8px 2px', borderBottom: '1px solid var(--mc-hair)' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--mc-seg)', borderRadius: 9, padding: '0 8px', height: 30,
              border: '1px solid var(--mc-hair)', transition: 'border-color .15s',
            }}
              onFocusCapture={e => { e.currentTarget.style.borderColor = 'var(--mc-accent)'; }}
              onBlurCapture={e => { e.currentTarget.style.borderColor = 'var(--mc-hair)'; }}>
              <span style={{ color: 'var(--mc-muted)', flexShrink: 0, display: 'inline-flex' }}><IconSearch /></span>
              <input value={searchQuery} onChange={e => onSearchInput(e.target.value)}
                placeholder="搜索历史对话…" style={{
                  flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none',
                  fontSize: 12.5, color: 'var(--mc-text)', fontFamily: 'inherit',
                }} />
              {searchQuery && (
                <button onClick={() => { setSearchQuery(''); setSearchResults([]); if (searchTimer.current) clearTimeout(searchTimer.current); }}
                  title="清空" style={{ border: 'none', background: 'transparent', color: 'var(--mc-muted2)', cursor: 'pointer', fontSize: 11, padding: '2px 4px' }}>✕</button>
              )}
            </div>
            {searchQuery && (
              <div className="mc-scroll" style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 0 8px' }}>
                {searching && <div style={{ fontSize: 11.5, color: 'var(--mc-muted2)', padding: '4px 6px' }}>搜索中…</div>}
                {!searching && searchResults.length === 0 && (
                  <div style={{ fontSize: 11.5, color: 'var(--mc-muted2)', padding: '4px 6px' }}>未找到匹配的对话</div>
                )}
                {searchResults.map(r => (
                  <button key={r.id} onClick={() => { openInPane(r.sessionId); }}
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
        )}
        <div className="mc-scroll" style={{ flex: 1, overflowY: 'auto', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sidebarCollapsed ? (
            // 收起态：扁平图标列表（根+子会话都显示，方便快速切换）
            sorted.map(s => {
              const isActive = activeSessionIds.has(s.id);
              const isRunning = runningTasks.some(t => t.sessionId === s.id && !t.done && t.phase !== 'error');
              return (
                <div key={s.id} title={(s.title || '新对话') + (s.pinned ? '（已置顶）' : '')}
                  onClick={() => openInPane(s.id)}
                  style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px 0', cursor: 'pointer', borderRadius: 9, background: isActive ? 'var(--mc-accent-soft)' : 'transparent', transition: 'background .15s' }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--mc-hair)'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}>
                  <span style={{
                    width: 32, height: 32, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 600, flexShrink: 0,
                    background: isActive ? 'var(--mc-accent)' : 'var(--mc-seg)',
                    color: isActive ? '#fff' : 'var(--mc-text)',
                    boxShadow: 'var(--mc-shadow-sm)',
                  }}>
                    {(s.title || '新对话').slice(0, 1)}
                  </span>
                  {s.pinned && <span style={{ position: 'absolute', top: 2, right: 4, color: 'var(--mc-pin)', fontSize: 9 }}>★</span>}
                  {isRunning && <span className="mc-spin" style={{ position: 'absolute', bottom: 3, right: 5, width: 8, height: 8, borderRadius: '50%', border: '2px solid var(--mc-accent)', borderTopColor: 'transparent' }} />}
                </div>
              );
            })
          ) : (
            // 展开态：树状节点（根 + 子对话缩进；节点可打开/更多菜单）
            renderTreeNode(sessionTree.length > 0 ? sessionTree : sorted.map(s => ({ ...s, depth: 0, children: [] as SessionNode[] })))
          )}
        </div>
      </aside>

      {/* 内容区：Vertical Split View */}
      <main ref={contentRef} style={{ flex: 1, display: 'flex', minWidth: 0, gap: 10, padding: 10, position: 'relative' }}>
        <ChatPane
          store={storeA} focused={focused === 'A'} onFocus={() => setFocused('A')}
          style={{ width: paneAWidth, flex: paneAFlex, flexBasis: collapsed ? '100%' : paneAWidth, display: collapsed === 'A' ? 'none' : 'flex' }}
        />
        <div className="mc-splitter" style={{ width: 6, flex: '0 0 6px', display: collapsed ? 'none' : 'block' }}
          onMouseDown={() => { if (!collapsed) setDragging(true); }} />
        {/* 第二面板：对话辅助面板（文件产出/工作区 / 预览），与左栏对话共享同一 store */}
        <div
          onMouseDown={() => setFocused('B')}
          style={{
            width: paneBWidth, flex: paneBFlex, flexBasis: collapsed ? '100%' : paneBWidth,
            display: collapsed === 'B' ? 'none' : 'flex', flexDirection: 'column', minWidth: 0,
            background: 'var(--mc-glass-strong)', backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)',
            border: '1px solid var(--mc-hair)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--mc-shadow-md)',
          }}
        >
          {/* 辅助面板标签条：文件 / 预览 */}
          <div style={{ display: 'flex', gap: 2, alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid var(--mc-hair)', background: 'var(--mc-glass)', flexShrink: 0 }}>
            <button className={`mc-pill ${rightTab === 'files' ? 'on' : ''}`} onClick={() => setRightTab('files')} title="产出文件 / 工作区">文件</button>
            <button className={`mc-pill ${rightTab === 'preview' ? 'on' : ''}`} onClick={() => setRightTab('preview')} title="AI 产物实时预览">预览</button>
          </div>
          {rightTab === 'files' ? <FileView store={storeA} /> : <PreviewPage initialHtml={null} />}
        </div>

        {/* 收起后的恢复条 */}
        {collapsed && (
          <div className="mc-restore" style={collapsed === 'A' ? { left: 0 } : { right: 0 }}
            onClick={() => setCollapsed(null)}>
            {collapsed === 'A' ? '恢复对话' : '恢复辅助面板'}
          </div>
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
