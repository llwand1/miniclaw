import { CSSProperties } from 'react';
import { IconChat, IconFiles, IconTrace } from './chatIcons';
import { ChatView } from './ChatView';
import { FileView } from './FileView';
import { useChatPane } from './useChatPane';
import type { ChatPaneProps } from './chatTypes';

/** ChatPane —— 单个分栏（对话 / 文件）。状态与操作见 useChatPane.ts，渲染拆到 ChatView / FileView。 */
function ChatPane(props: ChatPaneProps) {
  const store = useChatPane(props);
  const { focused, view, conn, sessionTitle, showTrace, setShowTrace, traceUserClosedRef, setView } = store;

  const paneBase: CSSProperties = {
    display: 'flex', flexDirection: 'column', minWidth: 0,
    background: 'var(--mc-glass-strong)',
    backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    border: '1px solid var(--mc-hair)', borderRadius: 16, overflow: 'hidden',
    boxShadow: 'var(--mc-shadow-md)', transition: 'box-shadow .18s',
  };

  return (
    <div className={`mc-pane ${focused ? 'mc-focused' : ''}`} style={{ ...paneBase, ...(props.style || {}) }} onMouseDown={props.onFocus}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: '1px solid var(--mc-hair)', background: 'var(--mc-glass)', flexShrink: 0 }}>
        <span className="mc-conn" title={conn === 'open' ? '已连接' : conn === 'reconnecting' ? '连接中断，正在重连…' : '连接中…'} style={{ background: conn === 'open' ? '#34C759' : conn === 'reconnecting' ? 'var(--mc-pin)' : '#aeaeb2', flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sessionTitle}</span>
        <span style={{ display: 'flex', gap: 2, background: 'var(--mc-seg)', borderRadius: 9, padding: 2, flexShrink: 0 }}>
          <button className={`mc-viewbtn ${view === 'chat' ? 'on' : ''}`} onClick={() => setView('chat')} title="对话"><IconChat /></button>
          <button className={`mc-viewbtn ${view === 'files' ? 'on' : ''}`} onClick={() => setView('files')} title="文件"><IconFiles /></button>
        </span>
        <button className={`mc-viewbtn ${showTrace ? 'on' : ''}`} onClick={() => { setShowTrace(v => { const nv = !v; traceUserClosedRef.current = !nv; return nv; }); }} title="本次请求的调用瀑布（Trace，点击行可展开详情）"><IconTrace /></button>
      </div>
      <div style={{ flex: 1, display: view === 'chat' ? 'flex' : 'none', flexDirection: 'column', minHeight: 0 }}>
        <ChatView store={store} />
      </div>
      <div style={{ flex: 1, display: view === 'files' ? 'flex' : 'none', flexDirection: 'column', minHeight: 0 }}>
        <FileView store={store} />
      </div>
    </div>
  );
}

export default ChatPane;
