import { useEffect, useState } from 'react';

type Tab = 'providers' | 'memories' | 'search';

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('providers');
  const [providers, setProviders] = useState<any[]>([]);
  const [memories, setMemories] = useState<any[]>([]);
  const [show, setShow] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [f, setF] = useState({ type: 'openai', name: '', baseUrl: 'https://api.openai.com/v1', apiKey: '', defaultModel: 'gpt-4o-mini' });

  // Search config state
  const [searchCfg, setSearchCfg] = useState({ enabled: false, provider: 'duckduckgo', customApiUrl: '', customApiKey: '' });
  const [searchDirty, setSearchDirty] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);

  useEffect(() => { loadProviders(); loadMemories(); loadSearchConfig(); }, []);

  async function loadProviders() {
    try { setProviders(await (await fetch('/api/providers')).json()); } catch { setMsg('加载失败'); }
  }

  async function loadMemories() {
    try { setMemories(await (await fetch('/api/memories')).json()); } catch { /* ignore */ }
  }

  async function loadSearchConfig() {
    try {
      const row = await (await fetch('/api/search-config')).json();
      if (row) setSearchCfg({ enabled: !!row.enabled, provider: row.provider || 'duckduckgo', customApiUrl: row.custom_api_url || '', customApiKey: row.custom_api_key || '' });
    } catch { /* ignore */ }
  }

  function newForm() {
    setF({ type: 'openai', name: '', baseUrl: 'https://api.openai.com/v1', apiKey: '', defaultModel: 'gpt-4o-mini' });
    setEdit(null); setShow(true); setMsg('');
  }

  function editForm(p: any) {
    setF({ type: p.type, name: p.name, baseUrl: p.base_url, apiKey: p.api_key || '', defaultModel: p.default_model });
    setEdit(p.id); setShow(true); setMsg('');
  }

  async function save() {
    if (!f.name.trim() || !f.apiKey.trim()) { setMsg('名称和 API Key 不能为空'); return; }
    setBusy(true); setMsg('');
    try {
      if (edit) {
        const res = await fetch(`/api/providers/${edit}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || '保存失败'); }
      } else {
        const res = await fetch('/api/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || '保存失败'); }
      }
      setShow(false); setMsg(''); loadProviders();
    } catch (err: any) {
      setMsg(err.message);
    } finally { setBusy(false); }
  }

  async function delProvider(id: string) {
    if (!confirm('确认删除？')) return;
    setMsg('');
    try {
      const res = await fetch(`/api/providers/${id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || '删除失败'); }
      loadProviders();
    } catch (err: any) { setMsg(err.message); }
  }

  async function delMemory(id: number) {
    if (!confirm('删除这条记忆？')) return;
    try {
      await fetch(`/api/memories/${id}`, { method: 'DELETE' });
      loadMemories();
    } catch { /* ignore */ }
  }

  async function saveSearchConfig() {
    setSearchBusy(true);
    try {
      const body: any = { enabled: searchCfg.enabled, provider: searchCfg.provider };
      if (searchCfg.customApiUrl) body.customApiUrl = searchCfg.customApiUrl;
      if (searchCfg.customApiKey) body.customApiKey = searchCfg.customApiKey;
      const res = await fetch('/api/search-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) { setSearchDirty(false); setMsg('搜索配置已保存'); } else { setMsg('保存失败'); }
    } catch { setMsg('保存失败'); } finally { setSearchBusy(false); }
  }

  const tabBtn = (t: Tab, label: string) => (
    <button onClick={() => setTab(t)} style={{ padding: '6px 14px', border: 'none', borderRadius: 6, cursor: 'pointer', background: tab === t ? '#007aff' : '#e0e0e0', color: tab === t ? '#fff' : '#333', fontSize: 13 }}>{label}</button>
  );

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {tabBtn('providers', '服务商')}
        {tabBtn('search', '联网搜索')}
        {tabBtn('memories', '长期记忆')}
      </div>

      {msg && <div style={{ padding: '8px 12px', background: '#fff3cd', color: '#856404', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{msg}</div>}

      {tab === 'providers' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>服务商配置</h2>
            <button onClick={newForm} style={{ padding: '6px 14px', background: '#007aff', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>+ 添加</button>
          </div>

          {show && <div style={{ background: '#f9f9f9', padding: 16, borderRadius: 8, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input placeholder="名称（如：我的 OpenAI）" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} style={s} />
            <select value={f.type} onChange={e => setF({ ...f, type: e.target.value })} style={s}>
              <option value="openai">OpenAI 兼容</option><option value="anthropic">Anthropic</option>
            </select>
            <input placeholder="API 地址（如：https://api.openai.com/v1）" value={f.baseUrl} onChange={e => setF({ ...f, baseUrl: e.target.value })} style={s} />
            <input placeholder="API Key" value={f.apiKey} onChange={e => setF({ ...f, apiKey: e.target.value })} style={s} type="password" />
            <input placeholder="默认模型（如：gpt-4o-mini）" value={f.defaultModel} onChange={e => setF({ ...f, defaultModel: e.target.value })} style={s} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={save} disabled={busy} style={{ padding: '6px 14px', background: busy ? '#ccc' : '#007aff', color: '#fff', border: 'none', borderRadius: 6, cursor: busy ? 'not-allowed' : 'pointer' }}>{busy ? '保存中...' : (edit ? '保存' : '添加')}</button>
              <button onClick={() => setShow(false)} disabled={busy} style={{ padding: '6px 14px', background: '#ccc', border: 'none', borderRadius: 6, cursor: 'pointer' }}>取消</button>
            </div>
          </div>}

          {providers.length === 0 && !show && <p style={{ color: '#999' }}>暂无配置，点击右上角「+ 添加」新增</p>}
          {providers.map(p => (
            <div key={p.id} style={{ padding: '12px 16px', border: '1px solid #e0e0e0', borderRadius: 8, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><strong>{p.name}</strong><span style={{ marginLeft: 8, color: '#666', fontSize: 12 }}>{p.type}</span>
                <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>{p.base_url} | 模型: {p.default_model}</div></div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => editForm(p)} style={{ padding: '4px 10px', background: '#007aff', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>编辑</button>
                <button onClick={() => delProvider(p.id)} style={{ padding: '4px 10px', background: '#ff4d4f', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>删除</button>
              </div>
            </div>
          ))}
        </>
      )}

      {tab === 'search' && (
        <>
          <h2 style={{ margin: 0, fontSize: 16, marginBottom: 16 }}>联网搜索</h2>
          <p style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>开启后，AI 在需要时可以自动搜索网络获取最新信息。</p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <span style={{ fontSize: 14 }}>联网搜索</span>
            <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24, cursor: 'pointer' }}>
              <input type="checkbox" checked={searchCfg.enabled} onChange={e => { setSearchCfg({ ...searchCfg, enabled: e.target.checked }); setSearchDirty(true); }} style={{ opacity: 0, width: 0, height: 0 }} />
              <span style={{ position: 'absolute', inset: 0, background: searchCfg.enabled ? '#007aff' : '#ccc', borderRadius: 24, transition: '0.3s' }}>
                <span style={{ position: 'absolute', left: searchCfg.enabled ? 22 : 2, top: 2, width: 20, height: 20, background: '#fff', borderRadius: '50%', transition: '0.3s' }} />
              </span>
            </label>
            <span style={{ fontSize: 13, color: searchCfg.enabled ? '#007aff' : '#999' }}>{searchCfg.enabled ? '已开启' : '已关闭'}</span>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, color: '#666', display: 'block', marginBottom: 4 }}>搜索服务商</label>
            <select value={searchCfg.provider} onChange={e => { setSearchCfg({ ...searchCfg, provider: e.target.value as any }); setSearchDirty(true); }} style={{ ...s, width: '100%' }}>
              <option value="duckduckgo">DuckDuckGo（免费，无需 API Key）</option>
              <option value="custom">自定义搜索 API</option>
            </select>
          </div>

          {searchCfg.provider === 'custom' && (
            <>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, color: '#666', display: 'block', marginBottom: 4 }}>搜索 API 地址（用 {`{q}`} 代替查询词）</label>
                <input placeholder="如：https://api.bing.microsoft.com/v7.0/search?q={q}" value={searchCfg.customApiUrl} onChange={e => { setSearchCfg({ ...searchCfg, customApiUrl: e.target.value }); setSearchDirty(true); }} style={s} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, color: '#666', display: 'block', marginBottom: 4 }}>API Key（如有）</label>
                <input placeholder="API Key" value={searchCfg.customApiKey} onChange={e => { setSearchCfg({ ...searchCfg, customApiKey: e.target.value }); setSearchDirty(true); }} style={s} type="password" />
              </div>
            </>
          )}

          <button onClick={saveSearchConfig} disabled={searchBusy || !searchDirty} style={{ padding: '6px 14px', background: (searchBusy || !searchDirty) ? '#ccc' : '#007aff', color: '#fff', border: 'none', borderRadius: 6, cursor: (searchBusy || !searchDirty) ? 'not-allowed' : 'pointer' }}>
            {searchBusy ? '保存中...' : '保存'}
          </button>
        </>
      )}

      {tab === 'memories' && (
        <>
          <h2 style={{ margin: 0, fontSize: 16, marginBottom: 16 }}>长期记忆</h2>
          <p style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>对话结束后 AI 自动总结值得记住的信息。A=长期重要（上限15条），B=短期关注（上限10条）。</p>
          {memories.length === 0 && <p style={{ color: '#999' }}>暂无记忆，开始对话后 AI 会自动生成</p>}
          {(['A', 'B'] as const).map(cat => {
            const items = memories.filter((m: any) => m.category === cat);
            if (items.length === 0) return null;
            return (
              <div key={cat} style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 14, marginBottom: 8, color: cat === 'A' ? '#d4380d' : '#0958d9' }}>{cat === 'A' ? '长期记忆' : '短期记忆'}</h3>
                {items.map((m: any) => (
                  <div key={m.id} style={{ padding: '8px 12px', border: '1px solid #e0e0e0', borderRadius: 6, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                    <span>{m.content}</span>
                    <button onClick={() => delMemory(m.id)} style={{ padding: '2px 8px', background: 'none', border: '1px solid #ff4d4f', color: '#ff4d4f', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>删除</button>
                  </div>
                ))}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
const s: any = { padding: '8px 12px', borderRadius: 6, border: '1px solid #ccc', fontSize: 13 };
