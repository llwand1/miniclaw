import { useState } from 'react';
import {
  IconAlertCircle, IconCheck, IconSettings,
} from '../components/Icons';
import { SecurityTab } from '../components/settings/SecurityTab';
import { ProvidersTab } from '../components/settings/ProvidersTab';
import { SearchTab } from '../components/settings/SearchTab';
import { PromptTab } from '../components/settings/PromptTab';
import { MemoriesTab } from '../components/settings/MemoriesTab';
import { SkillsTab } from '../components/settings/SkillsTab';
import { NotificationsTab } from '../components/settings/NotificationsTab';
import { sidebarTabs } from '../components/settings/tabs';
import type { Tab } from '../components/settings/tabs';

/** 设置页外壳：左侧 Tab 导航 + 右侧内容区。各 Tab 内容拆到 components/settings/*Tab.tsx。 */
export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('providers');
  const [msg, setMsg] = useState('');
  const onMsg = setMsg;

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* ─── 左侧边栏（玻璃质感）─── */}
      <aside style={{
        width: 200, borderRight: '1px solid var(--mc-glass-border, rgba(255,255,255,.4))',
        background: 'var(--mc-glass-grad, rgba(255,255,255,.55))',
        backdropFilter: 'blur(22px) saturate(180%)', WebkitBackdropFilter: 'blur(22px) saturate(180%)',
        boxShadow: 'var(--mc-glow-hi, inset 0 1px 0 rgba(255,255,255,.5))',
        display: 'flex', flexDirection: 'column', padding: '16px 0', flexShrink: 0,
        transition: 'background 0.25s, border-color 0.25s',
      }}>
        <div style={{ padding: '0 16px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconSettings size={16} style={{ color: 'var(--text-3)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>设置</span>
        </div>
        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px' }}>
          {sidebarTabs.map((t) => {
            const active = tab === t.id;
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 12px', border: 'none', borderRadius: 8,
                  background: active ? 'var(--accent-soft)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text-3)',
                  cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 400,
                  textAlign: 'left', width: '100%',
                  transition: 'all 0.12s ease, transform .16s cubic-bezier(.2,.7,.3,1)',
                }}
                onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'var(--bg-muted)'; e.currentTarget.style.transform = 'translateX(2px)'; } }}
                onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.transform = 'none'; } }}>
                <Icon size={16} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span>{t.label}</span>
                  <span style={{ fontSize: 10, color: active ? 'var(--accent)' : 'var(--text-4)', fontWeight: 400, opacity: 0.7 }}>{t.desc}</span>
                </div>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* ─── 右侧内容区（玻璃容器）─── */}
      <main style={{ flex: 1, overflowY: 'auto', padding: '20px 28px', background: 'var(--mc-glass, rgba(255,255,255,.35))', backdropFilter: 'blur(16px) saturate(160%)', WebkitBackdropFilter: 'blur(16px) saturate(160%)', transition: 'background 0.25s' }}>
        {/* 全局消息提示 */}
        {msg && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 16px',
            background: msg.includes('失败') || msg.includes('错误') ? 'var(--danger-bg)' : 'var(--success-bg)',
            color: msg.includes('失败') || msg.includes('错误') ? 'var(--danger)' : 'var(--success)',
            borderRadius: 10, marginBottom: 16, fontSize: 13, fontWeight: 500,
            border: `1px solid ${msg.includes('失败') || msg.includes('错误') ? 'var(--danger-bdr)' : 'var(--success-bdr)'}`,
          }}>
            {msg.includes('失败') || msg.includes('错误') ? <IconAlertCircle size={16} /> : <IconCheck size={16} />}
            {msg}
          </div>
        )}

        {/* 服务商 */}
        {tab === 'providers' && <ProvidersTab onMsg={onMsg} />}

        {/* 联网搜索 */}
        {tab === 'search' && <SearchTab onMsg={onMsg} />}

        {/* 系统提示词 */}
        {tab === 'prompt' && <PromptTab onMsg={onMsg} />}

        {/* 长期记忆 */}
        {tab === 'memories' && <MemoriesTab onMsg={onMsg} />}

        {/* 技能 */}
        {tab === 'skills' && <SkillsTab onMsg={onMsg} />}

        {/* 安全：权限矩阵 / 审批 / 沙箱 / 密钥保护 */}
        {tab === 'security' && <SecurityTab />}

        {/* 通知：任务完成浏览器提醒 */}
        {tab === 'notifications' && <NotificationsTab onMsg={onMsg} />}
      </main>
    </div>
  );
}
