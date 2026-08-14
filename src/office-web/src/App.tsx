import { useEffect, useState } from 'react';
import ChatPage from './pages/ChatPage';
import SettingsPage from './pages/SettingsPage';
import QuizBankPage from './pages/QuizBankPage';
import { IconChat, IconSettings, IconDatabase, IconSun, IconMoon, IconPlus } from './components/Icons';
import { useTheme } from './components/ThemeContext';
import { previewClient } from './preview/PreviewClient';
import { notifyTaskDone, notifyChatDone } from './lib/notify';

type Tab = 'chat' | 'quiz' | 'settings';

const tabs: { id: Tab; label: string; icon: typeof IconChat }[] = [
  { id: 'chat', label: '对话', icon: IconChat },
  { id: 'quiz', label: '题库', icon: IconDatabase },
  { id: 'settings', label: '设置', icon: IconSettings },
];

/** 侧边栏导航分组：工作区（核心功能）+ 系统 */
const navGroups: { label: string; items: { id: Tab; label: string; icon: typeof IconChat }[] }[] = [
  {
    label: '工作区',
    items: [
      { id: 'chat', label: '对话', icon: IconChat },
      { id: 'quiz', label: '题库', icon: IconDatabase },
    ],
  },
  {
    label: '系统',
    items: [
      { id: 'settings', label: '设置', icon: IconSettings },
    ],
  },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('chat');
  const [iconKey, setIconKey] = useState(0);
  const [connected, setConnected] = useState<boolean | null>(null);
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

  // 连接状态：顶栏右侧「已连接」圆点（有服务商即视为就绪）
  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(d => setConnected(!!d.hasProviders)).catch(() => setConnected(false));
  }, []);

  const handleToggle = () => { setIconKey(k => k + 1); toggle(); };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, -apple-system, sans-serif', background: 'var(--bg)', color: 'var(--text)', transition: 'background 0.25s' }}>
      {/* ─── 顶部标签栏（app-bar） ─── */}
      <header style={{
        height: 48, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, padding: '0 16px',
        borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)',
        position: 'relative', zIndex: 10, transition: 'background 0.25s, border-color 0.25s',
      }}>
        {tabs.map((t) => {
          const active = tab === t.id;
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} title={t.label}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', border: 'none', borderRadius: 8,
                background: active ? 'var(--accent-soft)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text-3)',
                cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 500,
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'var(--bg-muted)'; e.currentTarget.style.color = 'var(--text)'; } }}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; } }}>
              <Icon size={15} />
              <span>{t.label}</span>
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        {/* 连接状态 + 版本 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--text-3)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? 'var(--success)' : connected === null ? 'var(--text-5)' : 'var(--danger)', display: 'inline-block' }} />
            {connected === null ? '连接中…' : connected ? '已连接 · 本地服务' : '未配置服务商'}
          </span>
          <span style={{ whiteSpace: 'nowrap' }}>studentbuddy v0.1.0</span>
        </div>
      </header>

      {/* ─── 主体：左侧边栏 + 主工作区 ─── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 左侧边栏（所有视图共享） */}
        <aside style={{
          width: 232, flexShrink: 0, background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          transition: 'background 0.25s, border-color 0.25s',
        }}>
          {/* 品牌区 */}
          <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border-light)' }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
            }}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a7 7 0 0 0-7 7c0 2.5 1.3 4.7 3.2 6 .5.3.8.9.8 1.5V18a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-1.5c0-.6.3-1.2.8-1.5A7 7 0 0 0 19 9a7 7 0 0 0-7-7z" />
                <path d="M10 22v-4M14 22v-4" />
              </svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: -0.3, whiteSpace: 'nowrap' }}>studentbuddy</div>
              <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 1 }}>你的 AI 学习伙伴</div>
            </div>
          </div>

          {/* 主操作按钮：新建对话（跳转到对话页） */}
          <div style={{ padding: '12px' }}>
            <button onClick={() => setTab('chat')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                width: '100%', padding: '10px 0', border: 'none', borderRadius: 10,
                background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
                color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(99,102,241,0.3)', transition: 'all 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(99,102,241,0.4)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(99,102,241,0.3)'; }}>
              <IconPlus size={15} /> 新建对话
            </button>
          </div>

          {/* 导航分组 */}
          <nav style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
            {navGroups.map(g => (
              <div key={g.label} style={{ marginBottom: 4 }}>
                <div style={{ padding: '10px 10px 6px', fontSize: 11, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>{g.label}</div>
                {g.items.map(item => {
                  const active = tab === item.id;
                  const Icon = item.icon;
                  return (
                    <button key={item.id} onClick={() => setTab(item.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                        padding: '8px 10px', border: 'none', borderRadius: 8, textAlign: 'left',
                        background: active ? 'var(--accent-soft)' : 'transparent',
                        color: active ? 'var(--accent)' : 'var(--text-2)',
                        cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 400,
                        boxShadow: active ? 'inset 3px 0 0 var(--accent)' : 'none',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'var(--bg-muted)'; e.currentTarget.style.color = 'var(--text)'; } }}
                      onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-2)'; } }}>
                      <span style={{ display: 'inline-flex', flexShrink: 0 }}><Icon size={16} /></span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* 底部：用户 + 主题切换 */}
          <div style={{ padding: '12px', borderTop: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, #667eea, #764ba2)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 600,
            }}>S</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>本地用户</div>
              <div style={{ fontSize: 11, color: 'var(--text-4)' }}>数据保存在本机</div>
            </div>
            <button onClick={handleToggle} title={isDark ? '切换到亮色模式' : '切换到暗色模式'}
              style={{
                width: 30, height: 30, flexShrink: 0, border: 'none', borderRadius: 8,
                background: 'var(--bg-muted)', color: 'var(--text-3)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-soft)'; e.currentTarget.style.color = 'var(--accent)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-muted)'; e.currentTarget.style.color = 'var(--text-3)'; }}>
              <span key={iconKey} className="theme-pop">{isDark ? <IconSun size={16} /> : <IconMoon size={16} />}</span>
            </button>
          </div>
        </aside>

        {/* 主工作区（切 Tab 整页淡入上移过渡） */}
        <main style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <div key={tab} className="page-enter" style={{ height: '100%' }}>
            {tab === 'chat' ? <ChatPage /> : tab === 'quiz' ? <QuizBankPage /> : <SettingsPage />}
          </div>
        </main>
      </div>
    </div>
  );
}
