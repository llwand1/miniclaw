import { useEffect, useState } from 'react';
import { IconActivity, IconAlertCircle, IconCheck, IconCloud, IconDatabase, IconEdit, IconPlus, IconTrash, IconX } from '../Icons';
import { btnBase, btnDanger, btnGhost, btnPrimary, cardStyle, inputStyle } from './styles';

/** 服务商 Tab：CRUD + 单选当前 + 连通性测试。从 SettingsPage 拆出。 */
export function ProvidersTab({ onMsg }: { onMsg: (msg: string) => void }) {
  const [providers, setProviders] = useState<any[]>([]);
  const [show, setShow] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ type: 'openai', name: '', baseUrl: 'https://api.openai.com/v1', apiKey: '', defaultModel: 'gpt-4o-mini' });
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({});

  async function loadProviders() {
    try { setProviders(await (await fetch('/api/providers')).json()); } catch { onMsg('加载失败'); }
  }
  useEffect(() => { loadProviders(); }, []);

  function newForm() {
    setF({ type: 'openai', name: '', baseUrl: 'https://api.openai.com/v1', apiKey: '', defaultModel: 'gpt-4o-mini' });
    setEdit(null); setShow(true); onMsg('');
  }
  function editForm(p: any) {
    setF({ type: p.type, name: p.name, baseUrl: p.base_url, apiKey: p.api_key || '', defaultModel: p.default_model });
    setEdit(p.id); setShow(true); onMsg('');
  }
  async function save() {
    if (!f.name.trim() || !f.apiKey.trim()) { onMsg('名称和 API Key 不能为空'); return; }
    setBusy(true); onMsg('');
    try {
      if (edit) {
        const res = await fetch(`/api/providers/${edit}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || '保存失败'); }
      } else {
        const res = await fetch('/api/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || '保存失败'); }
      }
      setShow(false); onMsg(''); loadProviders();
    } catch (err: any) {
      onMsg(err.message);
    } finally { setBusy(false); }
  }
  async function delProvider(id: string) {
    if (!confirm('确认删除？')) return;
    onMsg('');
    try {
      const res = await fetch(`/api/providers/${id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || '删除失败'); }
      loadProviders();
    } catch (err: any) { onMsg(err.message); }
  }
  async function selectProvider(id: string) {
    try {
      const res = await fetch(`/api/providers/${id}/select`, { method: 'PUT' });
      const data = await res.json();
      if (!res.ok) { onMsg(data.error || '操作失败'); return; }
      onMsg('已切换到该服务商');
      loadProviders();
    } catch (err: any) { onMsg(err.message); }
  }
  async function testProvider(id: string) {
    setTestingId(id);
    setTestResult(prev => { const c = { ...prev }; delete c[id]; return c; });
    try {
      const res = await fetch(`/api/providers/${id}/test`, { method: 'POST' });
      const data = await res.json();
      setTestResult(prev => ({ ...prev, [id]: { ok: !!data.ok, msg: data.ok ? `连通 (${data.status})` : (data.error || `失败 (${data.status})`) } }));
    } catch (err: any) {
      setTestResult(prev => ({ ...prev, [id]: { ok: false, msg: err.message } }));
    } finally { setTestingId(null); }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>服务商配置</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-4)' }}>同一时刻只能用一个大模型，选中谁就用谁的默认模型</p>
        </div>
        <button onClick={newForm} style={btnPrimary}><IconPlus size={14} /> 添加服务商</button>
      </div>

      {show && (
        <div style={{ ...cardStyle, background: 'var(--bg-inset)', border: '1px solid #c7d2fe' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontWeight: 600, color: 'var(--text-2)', fontSize: 14 }}>
            {edit ? <><IconEdit size={16} /> 编辑服务商</> : <><IconPlus size={16} /> 新增服务商</>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <input placeholder="名称（如：我的 OpenAI）" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} style={inputStyle} />
            <select value={f.type} onChange={e => setF({ ...f, type: e.target.value })} style={{ ...inputStyle, cursor: 'pointer' }}>
              <option value="openai">OpenAI 兼容</option><option value="anthropic">Anthropic</option>
            </select>
            <input placeholder="API 地址" value={f.baseUrl} onChange={e => setF({ ...f, baseUrl: e.target.value })} style={{ ...inputStyle, gridColumn: '1 / -1' }} />
            <input placeholder="API Key" value={f.apiKey} onChange={e => setF({ ...f, apiKey: e.target.value })} style={inputStyle} type="password" />
            <input placeholder="默认模型（如：gpt-4o-mini）" value={f.defaultModel} onChange={e => setF({ ...f, defaultModel: e.target.value })} style={inputStyle} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={save} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}>
              {busy ? '保存中...' : <><IconCheck size={14} /> {edit ? '保存' : '添加'}</>}
            </button>
            <button onClick={() => setShow(false)} disabled={busy} style={btnGhost}><IconX size={14} /> 取消</button>
          </div>
        </div>
      )}

      {providers.length === 0 && !show && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-4)' }}>
          <IconCloud size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
          <div style={{ fontSize: 14, marginBottom: 4 }}>暂无配置</div>
          <div style={{ fontSize: 12 }}>点击右上角「添加服务商」新增</div>
        </div>
      )}

      {providers.map(p => {
        const activeCount = providers.filter(pp => pp.enabled).length;
        return (
          <div key={p.id} style={{ ...cardStyle, opacity: p.enabled ? 1 : 0.72, borderColor: p.enabled ? '#c7d2fe' : 'var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: p.enabled ? 'var(--accent-soft)' : 'var(--bg-muted)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <IconCloud size={18} style={{ color: p.enabled ? 'var(--accent)' : 'var(--text-4)' }} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 14 }}>{p.name}</strong>
                    <span style={{ color: 'var(--text-4)', fontSize: 12 }}>{p.type}</span>
                  </div>
                  <div style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 2 }}>
                    <IconDatabase size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
                    {p.base_url} · 模型: {p.default_model}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {p.enabled && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#fff', fontSize: 11, background: 'var(--success)', padding: '3px 10px', borderRadius: 12, fontWeight: 500 }}>
                    <IconCheck size={12} /> 当前使用
                  </span>
                )}
                {activeCount === 0 && !p.enabled && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--danger)', fontSize: 11, background: 'var(--danger-bg)', padding: '3px 10px', borderRadius: 12, border: '1px solid var(--danger-bdr)' }}>
                    <IconAlertCircle size={12} /> 无可用服务商
                  </span>
                )}
                {!p.enabled && (
                  <button onClick={() => selectProvider(p.id)} style={{ ...btnPrimary, fontSize: 11, padding: '4px 10px' }}>
                    <IconCheck size={12} /> 设为当前
                  </button>
                )}
                <button onClick={() => testProvider(p.id)} disabled={testingId === p.id}
                  style={{
                    ...btnBase,
                    background: testResult[p.id]?.ok === true ? 'var(--success-bg)' : testResult[p.id]?.ok === false ? 'var(--danger-bg)' : 'var(--bg-muted)',
                    color: testResult[p.id]?.ok === true ? '#16a34a' : testResult[p.id]?.ok === false ? '#dc2626' : 'var(--text-3)',
                    border: `1px solid ${testResult[p.id]?.ok === true ? 'var(--success-bdr)' : testResult[p.id]?.ok === false ? 'var(--danger-bdr)' : 'var(--border)'}`,
                    fontSize: 11, padding: '4px 10px',
                  }}>
                  {testingId === p.id ? '测试中...' : testResult[p.id] ? testResult[p.id].msg : <><IconActivity size={12} /> 测试</>}
                </button>
                <button onClick={() => editForm(p)} style={{ ...btnGhost, fontSize: 11, padding: '4px 10px' }}><IconEdit size={12} /> 编辑</button>
                <button onClick={() => delProvider(p.id)} style={{ ...btnDanger, fontSize: 11, padding: '4px 10px' }}><IconTrash size={12} /> 删除</button>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
