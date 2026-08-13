import { useEffect, useRef, useState } from 'react';
import { previewClient } from '../preview/PreviewClient';
import type { RunningTaskFront } from '../preview/PreviewClient';
import ChatPane from '../components/chat/ChatPane';
import { TaskChip } from '../components/chat/TaskComponents';
import { MC_CSS } from '../components/chat/chatStyles';
import { IconChat, IconDots, IconEdit, IconMenu, IconNew, IconPin, IconShare, IconTrash } from '../components/chat/chatIcons';
import type { ModelOption, OpenReq, SelectedModel, Session } from '../components/chat/chatTypes';

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
 * 每个 ChatPane 独立持有：sessionId / 消息 / 输入 / 思考强度 / 联网搜索 / 上下文用量，
 * 并各自建立一条 EventSource（sessionId 隔离，杜绝串台）。
 * 文件视图复用 previewClient（SSE 全局订阅 artifact），与 PreviewPage 同源。
 * 视觉：全部内联 style + 一段组件级 <style>（仅放 keyframes / 细滚动条 / :hover 等
 *       伪类，前缀 mc- 避免污染其它组件），沿用项目「内联样式」约定。
 * ========================================================================= */

// =========================================================================
// ChatPage —— 外壳：侧边栏 + 分栏视图
// =========================================================================
export default function ChatPage({ onOpenPreview }: { onOpenPreview?: (html: string) => void }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [hasProvider, setHasProvider] = useState<boolean | null>(null);
  const [initialSearchOn, setInitialSearchOn] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(null);
  const [focused, setFocused] = useState<'A' | 'B'>('A');
  const [paneInfo, setPaneInfo] = useState<{ A: { sessionId: string | null; view: 'chat' | 'files' }; B: { sessionId: string | null; view: 'chat' | 'files' } }>({
    A: { sessionId: null, view: 'chat' },
    B: { sessionId: null, view: 'files' },
  });
  const [openReq, setOpenReq] = useState<OpenReq | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; onUndo?: () => void } | null>(null);

  // 后台任务（生成中/已完成的会话）：底部任务栏数据源，切走不打断、随时可点回
  const [runningTasks, setRunningTasks] = useState<RunningTaskFront[]>([]);
  const runningTasksRef = useRef<RunningTaskFront[]>([]);
  runningTasksRef.current = runningTasks;

  // Splitter 状态
  const [splitPct, setSplitPct] = useState(50);
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

  // 初始加载：状态 / 会话列表 / 搜索开关
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
      }
    });
    fetch('/api/search-config').then(r => r.json()).then(cfg => { if (cfg && cfg.enabled) setInitialSearchOn(true); }).catch(() => {});
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
  function onRunState(d: { sessionId: string; task?: RunningTaskFront; done?: boolean; error?: string; removed?: boolean }) {
    setRunningTasks(prev => {
      let next: RunningTaskFront[];
      if (d.removed || (d.done && !d.task)) {
        next = prev.filter(t => t.sessionId !== d.sessionId);
      } else if (d.task) {
        next = mergeRunning(prev, [{ ...d.task, done: d.done, error: d.error }]);
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
  }

  // 在「当前聚焦 Pane」打开会话（自动切到对话视图）
  function openInPane(id: string) {
    const fid = focused;
    setFocused(fid);
    setPaneInfo(p => ({ ...p, [fid]: { sessionId: id, view: 'chat' } }));
    setOpenReq({ pane: fid, sessionId: id, nonce: Date.now() });
  }
  function newConversation() {
    const fid = focused;
    setFocused(fid);
    setPaneInfo(p => ({ ...p, [fid]: { sessionId: null, view: 'chat' } }));
    setOpenReq({ pane: fid, sessionId: null, nonce: Date.now() });
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
    } catch { /* ignore */ }
  }

  function openMenu(id: string, x: number, y: number) {
    setMenu({ id, x, y });
  }

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
    (['A', 'B'] as const)
      .filter(p => paneInfo[p].view === 'chat' && paneInfo[p].sessionId)
      .map(p => paneInfo[p].sessionId as string)
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
        <div className="mc-scroll" style={{ flex: 1, overflowY: 'auto', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sorted.map(s => {
            const isActive = activeSessionIds.has(s.id);
            const isRunning = runningTasks.some(t => t.sessionId === s.id && !t.done && t.phase !== 'error');
            if (sidebarCollapsed) {
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
            }
            return (
              <div key={s.id}
                className={`mc-row ${isActive ? 'active' : ''} ${s.pinned ? 'pinned' : ''} ${renamingId === s.id ? 'renaming' : ''}`}
                onClick={() => { if (renamingId !== s.id) openInPane(s.id); }}
                style={renamingId === s.id ? { background: 'transparent' } : undefined}>
                {renamingId === s.id ? (
                  <input autoFocus defaultValue={s.title}
                    onKeyDown={e => { if (e.key === 'Enter') renameSession(s.id, (e.target as HTMLInputElement).value); else if (e.key === 'Escape') setRenamingId(null); }}
                    onBlur={e => renameSession(s.id, e.target.value)}
                    style={{ width: '100%', fontSize: 13.5, fontFamily: 'inherit', border: '1px solid var(--mc-accent)', borderRadius: 5, padding: '2px 5px', outline: 'none', background: 'var(--mc-glass-strong)', color: 'var(--mc-text)' }} />
                ) : (
                  <>
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
            );
          })}
        </div>
      </aside>

      {/* 内容区：Vertical Split View */}
      <main ref={contentRef} style={{ flex: 1, display: 'flex', minWidth: 0, gap: 10, padding: 10, position: 'relative' }}>
        <ChatPane
          paneId="A" focused={focused === 'A'} view={paneInfo.A.view} openReq={openReq} initialSearchOn={initialSearchOn} sessions={sessions}
          modelOptions={modelOptions} selectedModel={selectedModel} onSelectModel={selectModel}
          onFocus={() => setFocused('A')} onViewChange={v => setPaneInfo(p => ({ ...p, A: { ...p.A, view: v } }))}
          onPaneSessionKnown={id => setPaneInfo(p => ({ ...p, A: { ...p.A, sessionId: id } }))}
          onSessionsMutated={refreshSessions} onOpenPreview={onOpenPreview} onToast={(msg) => setToast({ msg })}
          runningSessionIds={runningIds}
          style={{ width: paneAWidth, flex: paneAFlex, flexBasis: collapsed ? '100%' : paneAWidth, display: collapsed === 'A' ? 'none' : 'flex' }}
        />
        <div className="mc-splitter" style={{ width: 6, flex: '0 0 6px', display: collapsed ? 'none' : 'block' }}
          onMouseDown={() => { if (!collapsed) setDragging(true); }} />
        <ChatPane
          paneId="B" focused={focused === 'B'} view={paneInfo.B.view} openReq={openReq} initialSearchOn={initialSearchOn} sessions={sessions}
          modelOptions={modelOptions} selectedModel={selectedModel} onSelectModel={selectModel}
          onFocus={() => setFocused('B')} onViewChange={v => setPaneInfo(p => ({ ...p, B: { ...p.B, view: v } }))}
          onPaneSessionKnown={id => setPaneInfo(p => ({ ...p, B: { ...p.B, sessionId: id } }))}
          onSessionsMutated={refreshSessions} onOpenPreview={onOpenPreview} onToast={(msg) => setToast({ msg })}
          runningSessionIds={runningIds}
          style={{ width: paneBWidth, flex: paneBFlex, flexBasis: collapsed ? '100%' : paneBWidth, display: collapsed === 'B' ? 'none' : 'flex' }}
        />

        {/* 收起后的恢复条 */}
        {collapsed && (
          <div className="mc-restore" style={collapsed === 'A' ? { left: 0 } : { right: 0 }}
            onClick={() => setCollapsed(null)}>
            {collapsed === 'A' ? '恢复对话 A' : '恢复对话 B'}
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
