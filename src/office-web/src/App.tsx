import { useEffect, useState } from 'react';
import ChatPage from './pages/ChatPage';
import SettingsPage from './pages/SettingsPage';
import PreviewPage from './pages/PreviewPage';
import { IconChat, IconEye, IconSettings, IconSun, IconMoon } from './components/Icons';
import { useTheme } from './components/ThemeContext';
import { previewClient } from './preview/PreviewClient';
import { notifyTaskDone, notifyChatDone } from './lib/notify';

type Tab = 'chat' | 'preview' | 'settings';

const tabs: { id: Tab; label: string; icon: typeof IconChat }[] = [
  { id: 'chat', label: '对话', icon: IconChat },
  { id: 'preview', label: '预览', icon: IconEye },
  { id: 'settings', label: '设置', icon: IconSettings },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('chat');
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [iconKey, setIconKey] = useState(0);
  const { isDark, toggle } = useTheme();

  // 全局任务完成通知：任意会话（含后台定时任务）结束时，若页面不在前台则弹浏览器系统通知。
  useEffect(() => {
    previewClient.start();
    const off = previewClient.subscribeRunning((d) => {
      if ((d.done || d.error) && !d.removed && d.task) {
        // 仅当用户切到其它窗口（studentbuddy 不在前台）时弹，避免前台冗余打扰，也天然规避「主动停止」误通知。
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
        const failed = !!d.error;
        const title = failed ? 'studentbuddy · 任务失败' : 'studentbuddy · 任务完成';
        const body = d.task.title || (failed ? (d.error as string) : '任务已完成');
        notifyTaskDone({ title, body });
      }
    });
    // 对话回复完成通知：任意会话的 AI 回复成功结束时，若页面不在前台则弹浏览器系统通知。
    // 与任务通知同策略（前台不打扰），由设置页「对话回复完成提醒」开关独立控制。
    const offChat = previewClient.subscribeChatDone((d) => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
      notifyChatDone({ title: 'studentbuddy · 回复完成', body: 'AI 已回复完成，点击回到对话' });
    });
    return () => { off(); offChat(); };
  }, []);

  const handleToggle = () => { setIconKey(k => k + 1); toggle(); };

  const openPreview = (html: string) => {
    setPreviewHtml(html);
    setTab('preview');
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, -apple-system, sans-serif', background: 'var(--bg)', transition: 'background 0.25s' }}>
      {/* ─── 顶部导航栏 ─── */}
      <header style={{
        display: 'flex', alignItems: 'center', padding: '0 20px',
        borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)',
        height: 52, boxShadow: 'var(--shadow-sm)', position: 'relative', zIndex: 10,
        transition: 'background 0.25s, border-color 0.25s',
      }}>
        {/* Logo + 品牌 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 40, userSelect: 'none' }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
          }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a7 7 0 0 0-7 7c0 2.5 1.3 4.7 3.2 6 .5.3.8.9.8 1.5V18a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-1.5c0-.6.3-1.2.8-1.5A7 7 0 0 0 19 9a7 7 0 0 0-7-7z" />
              <path d="M10 22v-4M14 22v-4" />
            </svg>
          </div>
          <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', letterSpacing: -0.3, transition: 'color 0.25s' }}>studentbuddy</span>
        </div>

        {/* 标签页导航 */}
        <nav style={{ display: 'flex', gap: 2, background: 'var(--bg-muted)', borderRadius: 10, padding: 3, transition: 'background 0.25s' }}>
          {tabs.map((t) => {
            const active = tab === t.id;
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 16px', border: 'none', borderRadius: 8,
                  background: active ? 'var(--bg-surface)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text-3)',
                  cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 500,
                  boxShadow: active ? 'var(--shadow)' : 'none',
                  transition: 'all 0.15s ease',
                }}>
                <Icon size={15} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </nav>

        <div style={{ flex: 1 }} />

        {/* ─── 主题切换按钮 ─── */}
        <button onClick={handleToggle}
          title={isDark ? '切换到亮色模式' : '切换到暗色模式'}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 36, height: 36, border: 'none', borderRadius: 10,
            background: 'var(--bg-muted)', color: 'var(--text-3)',
            cursor: 'pointer', transition: 'all 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-soft)'; e.currentTarget.style.color = 'var(--accent)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-muted)'; e.currentTarget.style.color = 'var(--text-3)'; }}
        >
          <span key={iconKey} className="theme-pop">{isDark ? <IconSun size={18} /> : <IconMoon size={18} />}</span>
        </button>
      </header>

        {/* ─── 页面内容（切 Tab 整页淡入上移过渡） ─── */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div key={tab} className="page-enter" style={{ height: '100%' }}>
          {tab === 'chat' ? <ChatPage onOpenPreview={openPreview} /> : tab === 'preview' ? <PreviewPage initialHtml={previewHtml} /> : tab === 'quiz' ? <QuizBankPage /> : <SettingsPage />}
        </div>
      </div>
    </div>
  );
}
