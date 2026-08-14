import { CSSProperties } from 'react';
import { ChatView } from './ChatView';
import type { ChatPaneStore } from './useChatPane';

/** ChatPane —— 左栏对话分栏。store 由父级 ChatPage 经 useChatPane 创建并传入（右栏辅助面板共享同一 store）。 */
interface ChatPaneShellProps {
  store: ChatPaneStore;
  focused: boolean;
  onFocus: () => void;
  style?: CSSProperties;
}

function ChatPane({ store, focused, onFocus, style }: ChatPaneShellProps) {
  const { conn, sessionTitle } = store;

  const paneBase: CSSProperties = {
    display: 'flex', flexDirection: 'column', minWidth: 0,
    background: 'var(--mc-glass-grad)',
    backdropFilter: 'blur(28px) saturate(180%)', WebkitBackdropFilter: 'blur(28px) saturate(180%)',
    border: '1px solid var(--mc-glass-border)', borderRadius: 18, overflow: 'hidden',
    boxShadow: 'var(--mc-glow-hi), var(--mc-shadow-md)', transition: 'box-shadow .18s, transform .18s',
  };

  return (
    <div className={`mc-pane ${focused ? 'mc-focused' : ''}`} style={{ ...paneBase, ...(style || {}) }} onMouseDown={onFocus}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: '1px solid var(--mc-hair)', background: 'var(--mc-glass)', flexShrink: 0 }}>
        <span className="mc-conn" title={conn === 'open' ? '已连接' : conn === 'reconnecting' ? '连接中断，正在重连…' : '连接中…'} style={{ background: conn === 'open' ? '#34C759' : conn === 'reconnecting' ? 'var(--mc-pin)' : '#aeaeb2', flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sessionTitle}</span>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <ChatView store={store} />
      </div>
    </div>
  );
}

export default ChatPane;
