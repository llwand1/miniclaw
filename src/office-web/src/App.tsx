import { useState } from 'react';
import ChatPage from './pages/ChatPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  const [tab, setTab] = useState<'chat' | 'settings'>('chat');
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ display: 'flex', alignItems: 'center', padding: '0 16px', borderBottom: '1px solid #e0e0e0', background: '#f5f5f5', height: 48 }}>
        <h1 style={{ margin: 0, fontSize: 18, marginRight: 32 }}>MiniClaw</h1>
        <nav style={{ display: 'flex', gap: 4 }}>
          {(['chat', 'settings'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: '8px 16px', border: 'none', background: tab === t ? '#007aff' : 'transparent', color: tab === t ? '#fff' : '#333', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
              {t === 'chat' ? '对话' : '设置'}
            </button>
          ))}
        </nav>
      </header>
      <div style={{ flex: 1, overflow: 'hidden' }}>{tab === 'chat' ? <ChatPage /> : <SettingsPage />}</div>
    </div>
  );
}
