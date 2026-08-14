import { useEffect, useState } from 'react';
import { IconCheck, IconSearch } from '../Icons';
import { btnPrimary, cardStyle, inputStyle } from './styles';

/** 联网搜索 Tab。从 SettingsPage 拆出。 */
export function SearchTab({ onMsg }: { onMsg: (msg: string) => void }) {
  const [searchCfg, setSearchCfg] = useState({ enabled: false, provider: 'duckduckgo', customApiUrl: '', customApiKey: '' });
  const [searchDirty, setSearchDirty] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);

  async function loadSearchConfig() {
    try {
      const row = await (await fetch('/api/search-config')).json();
      if (row) setSearchCfg({ enabled: !!row.enabled, provider: row.provider || 'duckduckgo', customApiUrl: row.custom_api_url || '', customApiKey: row.custom_api_key || '' });
    } catch { /* ignore */ }
  }
  useEffect(() => { loadSearchConfig(); }, []);

  async function saveSearchConfig() {
    setSearchBusy(true);
    try {
      const body: any = { enabled: searchCfg.enabled, provider: searchCfg.provider };
      if (searchCfg.customApiUrl) body.customApiUrl = searchCfg.customApiUrl;
      if (searchCfg.customApiKey) body.customApiKey = searchCfg.customApiKey;
      const res = await fetch('/api/search-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) { setSearchDirty(false); onMsg('搜索配置已保存'); } else { onMsg('保存失败'); }
    } catch { onMsg('保存失败'); } finally { setSearchBusy(false); }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <IconSearch size={18} style={{ color: 'var(--accent)' }} />
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>联网搜索</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-4)' }}>开启后 AI 在需要时自动搜索网络获取最新信息</p>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-2)' }}>启用联网搜索</span>
          <label style={{ position: 'relative', display: 'inline-block', width: 48, height: 26, cursor: 'pointer', transition: 'transform .16s cubic-bezier(.2,.7,.3,1)' }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}>
            <input type="checkbox" checked={searchCfg.enabled} onChange={e => { setSearchCfg({ ...searchCfg, enabled: e.target.checked }); setSearchDirty(true); }} style={{ opacity: 0, width: 0, height: 0 }} />
            <span style={{ position: 'absolute', inset: 0, background: searchCfg.enabled ? 'var(--accent)' : '#d1d5db', borderRadius: 26, transition: '0.3s', boxShadow: searchCfg.enabled ? '0 2px 8px rgba(0,185,107,.3)' : 'none' }}>
              <span style={{ position: 'absolute', left: searchCfg.enabled ? 24 : 2, top: 2, width: 22, height: 22, background: '#fff', borderRadius: '50%', transition: '0.3s', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }} />
            </span>
          </label>
          <span style={{ fontSize: 13, color: searchCfg.enabled ? 'var(--accent)' : 'var(--text-4)', fontWeight: 500 }}>
            {searchCfg.enabled ? '已开启' : '已关闭'}
          </span>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 6, fontWeight: 500 }}>搜索服务商</label>
          <select value={searchCfg.provider} onChange={e => { setSearchCfg({ ...searchCfg, provider: e.target.value as any }); setSearchDirty(true); }} style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}>
            <option value="duckduckgo">DuckDuckGo（免费，无需 API Key）</option>
            <option value="custom">自定义搜索 API</option>
          </select>
        </div>

        {searchCfg.provider === 'custom' && (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 6, fontWeight: 500 }}>搜索 API 地址（用 {`{q}`} 代替查询词）</label>
              <input placeholder="如：https://api.bing.microsoft.com/v7.0/search?q={q}" value={searchCfg.customApiUrl} onChange={e => { setSearchCfg({ ...searchCfg, customApiUrl: e.target.value }); setSearchDirty(true); }} style={{ ...inputStyle, width: '100%' }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 6, fontWeight: 500 }}>API Key（如有）</label>
              <input placeholder="API Key" value={searchCfg.customApiKey} onChange={e => { setSearchCfg({ ...searchCfg, customApiKey: e.target.value }); setSearchDirty(true); }} style={{ ...inputStyle, width: '100%' }} type="password" />
            </div>
          </>
        )}

        <button onClick={saveSearchConfig} disabled={searchBusy || !searchDirty}
          className="mc-float" style={{ ...btnPrimary, opacity: searchBusy || !searchDirty ? 0.5 : 1, cursor: searchBusy || !searchDirty ? 'not-allowed' : 'pointer' }}>
          {searchBusy ? '保存中...' : <><IconCheck size={14} /> 保存</>}
        </button>
      </div>
    </>
  );
}
