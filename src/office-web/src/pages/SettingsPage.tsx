import { useEffect, useState } from 'react';
import {
  IconCloud, IconSearch, IconMessageSquare, IconBrain,
  IconPlus, IconRefresh, IconExternalLink, IconTrash, IconEdit, IconCopy,
  IconSync, IconCheck, IconAlertCircle, IconInfo, IconLock,
  IconDatabase, IconActivity,
  IconSettings, IconCode, IconX, IconChevronRight, IconShield,
} from '../components/Icons';

type Tab = 'providers' | 'memories' | 'search' | 'prompt' | 'skills' | 'security';

// =========================================================================
// SetupGuide —— 分步教学引导面板
// =========================================================================
type GuideStep = {
  title: string;
  body: React.ReactNode;
};

function CopyChip({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 6 }}>
      <code style={{ background: '#f0f0f0', padding: '3px 8px', borderRadius: 5, fontSize: 12, fontFamily: 'Menlo, Consolas, monospace' }}>{value}</code>
      <button
        onClick={() => {
          try { navigator.clipboard?.writeText(value); } catch { /* ignore */ }
          setCopied(true); setTimeout(() => setCopied(false), 1200);
        }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid #e0e0e0', background: '#fff', borderRadius: 5, padding: '3px 10px', fontSize: 11, cursor: 'pointer', color: '#555', transition: 'all 0.15s' }}
      >
        {copied ? <><IconCheck size={12} /> 已复制</> : <><IconCopy size={12} /> {label || '复制'}</>}
      </button>
    </span>
  );
}

function SetupGuide({
  steps,
  done,
}: {
  steps: GuideStep[];
  done: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (done) return null;
  return (
    <div style={{ marginTop: 12, marginBottom: 8, border: '1px solid #ffd591', background: '#fffbe6', borderRadius: 10, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', textAlign: 'left', padding: '12px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: '#874d00', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}
      >
        <IconInfo size={16} />
        {open ? '收起配置指引' : `第一次用？点这里看怎么配置（${steps.length} 步）`}
        <IconChevronRight size={14} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', marginLeft: 'auto' }} />
      </button>
      {open && (
        <ol style={{ margin: 0, padding: '12px 18px 16px 36px', fontSize: 13, color: '#5b3a00', lineHeight: 1.8 }}>
          {steps.map((st, i) => (
            <li key={i} style={{ marginBottom: 6 }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{st.title}</div>
              <div>{st.body}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ─── 侧栏 Tab 定义 ──────────────────────────────────────────
const sidebarTabs: { id: Tab; label: string; icon: typeof IconCloud; desc: string }[] = [
  { id: 'providers', label: '服务商', icon: IconCloud, desc: '管理 AI 模型接入' },
  { id: 'search', label: '联网搜索', icon: IconSearch, desc: '配置网络搜索能力' },
  { id: 'prompt', label: '系统提示词', icon: IconMessageSquare, desc: '定义 AI 行为准则' },
  { id: 'memories', label: '长期记忆', icon: IconBrain, desc: '管理 AI 记忆' },
  { id: 'skills', label: '技能', icon: IconCode, desc: '管理 AI 技能' },
  { id: 'security', label: '安全', icon: IconLock, desc: '权限矩阵 / 审批 / 沙箱' },
];

// ─── 工具样式 ────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  padding: '9px 14px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13,
  background: 'var(--bg-surface)', color: 'var(--text)', outline: 'none', transition: 'border-color 0.15s, background 0.25s, color 0.25s',
};
const codeStyle: React.CSSProperties = {
  background: '#f0f0f0', padding: '2px 6px', borderRadius: 5, fontSize: 12, fontFamily: 'Menlo, Consolas, monospace',
};
const cardStyle: React.CSSProperties = {
  padding: '14px 18px', border: '1px solid var(--border)', borderRadius: 10,
  marginBottom: 10, background: 'var(--bg-surface)', transition: 'box-shadow 0.15s, background 0.25s, border-color 0.25s',
};
const btnBase: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '6px 14px', border: 'none', borderRadius: 7, cursor: 'pointer',
  fontSize: 12.5, fontWeight: 500, transition: 'all 0.15s',
};
const btnPrimary: React.CSSProperties = { ...btnBase, background: 'var(--accent)', color: '#fff' };
const btnDanger: React.CSSProperties = { ...btnBase, background: 'var(--danger)', color: '#fff' };
const btnGhost: React.CSSProperties = { ...btnBase, background: 'var(--bg-muted)', color: 'var(--text-2)', border: '1px solid var(--border)' };
const th: any = { padding: '8px 12px', textAlign: 'left' as const, fontWeight: 600, fontSize: 12, color: 'var(--text-3)', borderBottom: '2px solid var(--border)' };
const td: any = { padding: '8px 12px', textAlign: 'left' as const, fontSize: 12.5 };

// ─── 通用开关（复用搜索配置的同款样式） ──────────────────────
function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
      <span style={{ position: 'absolute', inset: 0, background: checked ? 'var(--accent)' : '#d1d5db', borderRadius: 24, transition: '0.3s' }}>
        <span style={{ position: 'absolute', left: checked ? 22 : 2, top: 2, width: 20, height: 20, background: '#fff', borderRadius: '50%', transition: '0.3s', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }} />
      </span>
    </label>
  );
}

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

  // 系统提示词
  const [prompt, setPrompt] = useState('');
  const [promptDefault, setPromptDefault] = useState('');
  const [promptPreview, setPromptPreview] = useState('');
  const [promptDirty, setPromptDirty] = useState(false);
  const [promptBusy, setPromptBusy] = useState(false);

  // 测试连通性状态
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({});

  // 技能
  const [skills, setSkills] = useState<any[]>([]);
  const [skillEdit, setSkillEdit] = useState<string | null>(null); // null=关闭, 'new'=新建, 否则为编辑的 id
  const [skillForm, setSkillForm] = useState({ name: '', description: '', content: '', enabled: true });
  const [skillBusy, setSkillBusy] = useState(false);
  const [importing, setImporting] = useState(false);

  // 技能「使用教学」：如何把 WorkBuddy 的 skills 加载到本软件
  const skillGuideSteps: GuideStep[] = [
    {
      title: '① 确认 WorkBuddy 技能已在本机',
      body: (
        <>
          WorkBuddy 的技能都存放在你本机目录
          <CopyChip value="~/.workbuddy/skills" label="复制路径" />，
          Windows 上对应 <code style={codeStyle}>C:\Users\你的用户名\.workbuddy\skills</code>。
          每个技能是一个含 <code style={codeStyle}>SKILL.md</code> 的子文件夹。
        </>
      ),
    },
    {
      title: '② 一键导入到本软件',
      body: (
        <>
          点击本页右上角的「从 WorkBuddy 导入」按钮，软件会自动扫描上述目录，把本机所有技能登记进来（来源标记为 <b>WorkBuddy</b>）。
          导入是<b>只读引用</b>——不会复制或覆盖你 WorkBuddy 里的原文件，两边各自保留。
        </>
      ),
    },
    {
      title: '③ 启用你要用的技能',
      body: (
        <>
          导入后默认是「禁用」状态（安全起见不自动生效）。在列表中找到技能，打开右侧开关即可启用。
          也可以点「新建技能」在 MiniClaw 内自己从头写一个。
        </>
      ),
    },
    {
      title: '④ 让 AI 自动调用',
      body: (
        <>
          启用后，AI 会在对话中自动判断何时需要某个技能，并按需加载其正文来组织回答——与 WorkBuddy 一致的「目录 + 按需加载」机制，你无需手动指定。
        </>
      ),
    },
    {
      title: '⑤ 双向互通（可选）',
      body: (
        <>
          列表右侧的导出图标可把 MiniClaw 里的技能导出回 <code style={codeStyle}>~/.workbuddy/skills/</code>，实现两个软件共享同一套技能。
        </>
      ),
    },
];

  useEffect(() => { loadProviders(); loadMemories(); loadSearchConfig(); loadSystemPrompt(); }, []);
  useEffect(() => { if (tab === 'skills') { loadSkills(); } }, [tab]);

  async function loadProviders() {
    try { setProviders(await (await fetch('/api/providers')).json()); } catch { setMsg('加载失败'); }
  }
  async function loadMemories() {
    try { setMemories(await (await fetch('/api/memories')).json()); } catch { /* ignore */ }
  }

  // ─── 技能 API ──────────────────────────────────────────────
  async function loadSkills() {
    try { setSkills(await (await fetch('/api/skills')).json()); } catch { setMsg('技能加载失败'); }
  }
  function startNewSkill() {
    setSkillEdit('new');
    setSkillForm({ name: '', description: '', content: '', enabled: true });
  }
  async function startEditSkill(s: any) {
    try {
      const detail = await (await fetch(`/api/skills/${s.id}`)).json();
      setSkillEdit(s.id);
      setSkillForm({ name: detail.name || '', description: detail.description || '', content: detail.content || '', enabled: !!detail.enabled });
    } catch { setMsg('加载技能失败'); }
  }
  async function saveSkill() {
    if (!skillForm.name.trim()) { setMsg('技能名称必填'); return; }
    setSkillBusy(true);
    try {
      const body = { name: skillForm.name.trim(), description: skillForm.description, content: skillForm.content, enabled: skillForm.enabled ? 1 : 0 };
      const url = skillEdit === 'new' ? '/api/skills' : `/api/skills/${skillEdit}`;
      const method = skillEdit === 'new' ? 'POST' : 'PUT';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || '保存失败');
      setSkillEdit(null);
      setSkillForm({ name: '', description: '', content: '', enabled: true });
      await loadSkills();
      setMsg(skillEdit === 'new' ? '技能已创建' : '技能已更新');
    } catch (e: any) { setMsg(e.message); }
    finally { setSkillBusy(false); }
  }
  async function deleteSkill(id: string) {
    if (!confirm('删除该技能？本地文件也会被删除（WorkBuddy 来源的技能只取消引用、不删原文件）。')) return;
    try { await fetch(`/api/skills/${id}`, { method: 'DELETE' }); await loadSkills(); } catch { /* ignore */ }
  }
  async function toggleSkill(s: any) {
    try {
      const res = await fetch(`/api/skills/${s.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: s.enabled ? 0 : 1 }) });
      if (!res.ok) throw new Error((await res.json()).error || '操作失败');
      await loadSkills();
    } catch (e: any) { setMsg(e.message); }
  }
  async function importSkills() {
    setImporting(true);
    try {
      const res = await fetch('/api/skills/import', { method: 'POST' });
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (!ct.includes('application/json')) {
        // 后端返回了非 JSON（通常是旧实例的 HTML 兜底页）→ 提示重启，避免抛出难懂的 "<!DOCTYPE" 错误
        throw new Error('后端未返回 JSON，请完全退出并重启应用后再试（可能仍在运行旧版本）');
      }
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || '导入失败');
      await loadSkills();
      setMsg(`已从 WorkBuddy 导入 ${d.added} 个技能（跳过 ${d.skipped} 个已存在），默认禁用，请按需启用`);
    } catch (e: any) { setMsg(e.message); }
    finally { setImporting(false); }
  }
  async function exportSkill(id: string) {
    try {
      const res = await fetch(`/api/skills/${id}/export`, { method: 'POST' });
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (!ct.includes('application/json')) {
        throw new Error('后端未返回 JSON，请完全退出并重启应用后再试');
      }
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || '导出失败');
      setMsg(`已导出到 WorkBuddy：${d.path}`);
    } catch (e: any) { setMsg(e.message); }
  }
  async function loadSearchConfig() {
    try {
      const row = await (await fetch('/api/search-config')).json();
      if (row) setSearchCfg({ enabled: !!row.enabled, provider: row.provider || 'duckduckgo', customApiUrl: row.custom_api_url || '', customApiKey: row.custom_api_key || '' });
    } catch { /* ignore */ }
  }
  async function loadSystemPrompt() {
    try {
      const d = await (await fetch('/api/system-prompt')).json();
      if (d) { setPrompt(d.custom || ''); setPromptDefault(d.default || ''); setPromptPreview(d.preview || ''); }
    } catch { /* ignore */ }
  }
  async function saveSystemPrompt() {
    setPromptBusy(true); setMsg('');
    try {
      const res = await fetch('/api/system-prompt', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: prompt }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || '保存失败');
      setPromptPreview(d.preview || '');
      setPromptDirty(false);
      setMsg('系统提示词已保存');
    } catch (err: any) { setMsg(err.message); } finally { setPromptBusy(false); }
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
  async function selectProvider(id: string) {
    try {
      const res = await fetch(`/api/providers/${id}/select`, { method: 'PUT' });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || '操作失败'); return; }
      setMsg('已切换到该服务商');
      loadProviders();
    } catch (err: any) { setMsg(err.message); }
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

  // ─── 渲染 ──────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* ─── 左侧边栏 ─── */}
      <aside style={{
        width: 200, borderRight: '1px solid var(--border)', background: 'var(--bg-inset)',
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
                  transition: 'all 0.12s ease',
                }}>
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

      {/* ─── 右侧内容区 ─── */}
      <main style={{ flex: 1, overflowY: 'auto', padding: '20px 28px', background: 'var(--bg)', transition: 'background 0.25s' }}>
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

        {/* ════════════════════════════════════════════════════
            服务商 Tab
            ════════════════════════════════════════════════════ */}
        {tab === 'providers' && (
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
        )}

        {/* ════════════════════════════════════════════════════
            联网搜索 Tab
            ════════════════════════════════════════════════════ */}
        {tab === 'search' && (
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
                <label style={{ position: 'relative', display: 'inline-block', width: 48, height: 26, cursor: 'pointer' }}>
                  <input type="checkbox" checked={searchCfg.enabled} onChange={e => { setSearchCfg({ ...searchCfg, enabled: e.target.checked }); setSearchDirty(true); }} style={{ opacity: 0, width: 0, height: 0 }} />
                  <span style={{ position: 'absolute', inset: 0, background: searchCfg.enabled ? 'var(--accent)' : '#d1d5db', borderRadius: 26, transition: '0.3s' }}>
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
                style={{ ...btnPrimary, opacity: searchBusy || !searchDirty ? 0.5 : 1, cursor: searchBusy || !searchDirty ? 'not-allowed' : 'pointer' }}>
                {searchBusy ? '保存中...' : <><IconCheck size={14} /> 保存</>}
              </button>
            </div>
          </>
        )}

        {/* ════════════════════════════════════════════════════
            系统提示词 Tab
            ════════════════════════════════════════════════════ */}
        {tab === 'prompt' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <IconMessageSquare size={18} style={{ color: 'var(--accent)' }} />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>系统提示词</h2>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-4)' }}>定义 AI 的角色、准则与行为规范</p>
              </div>
            </div>

            <div style={cardStyle}>
              <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 12 }}>
                留空则使用内置默认提示词（借鉴 Claude Code / Cline 等开源项目风格）。
              </p>
              <textarea
                value={prompt}
                onChange={e => { setPrompt(e.target.value); setPromptDirty(true); }}
                placeholder={promptDefault}
                style={{ ...inputStyle, width: '100%', minHeight: 280, resize: 'vertical', fontFamily: 'Menlo, Consolas, monospace', fontSize: 12.5, lineHeight: 1.7, marginBottom: 12, boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <button onClick={saveSystemPrompt} disabled={promptBusy || !promptDirty}
                  style={{ ...btnPrimary, opacity: promptBusy || !promptDirty ? 0.5 : 1, cursor: promptBusy || !promptDirty ? 'not-allowed' : 'pointer' }}>
                  {promptBusy ? '保存中...' : <><IconCheck size={14} /> 保存</>}
                </button>
                <button onClick={() => loadSystemPrompt()} style={btnGhost}><IconRefresh size={14} /> 撤销修改</button>
              </div>
            </div>

            <div style={{ ...cardStyle, background: 'var(--bg-inset)' }}>
              <details>
                <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-3)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <IconCode size={14} /> 最终发给模型的系统提示词（含自动注入的工具说明与记忆）
                </summary>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, color: 'var(--text-2)', marginTop: 10, lineHeight: 1.7, maxHeight: 340, overflowY: 'auto', background: '#fff', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--border)', fontFamily: 'Menlo, Consolas, monospace' }}>
                  {promptPreview || '（暂无预览，保存后刷新）'}
                </pre>
              </details>
            </div>
          </>
        )}

        {/* ════════════════════════════════════════════════════
            长期记忆 Tab
            ════════════════════════════════════════════════════ */}
        {tab === 'memories' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <IconBrain size={18} style={{ color: 'var(--accent)' }} />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>长期记忆</h2>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-4)' }}>对话结束后 AI 自动总结值得记住的信息</p>
              </div>
            </div>

            <div style={{ ...cardStyle, background: 'var(--bg-inset)', borderStyle: 'dashed' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-3)' }}>
                <IconInfo size={14} />
                <span>A = 长期重要（上限 15 条）· B = 短期关注（上限 10 条）</span>
              </div>
            </div>

            {memories.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-4)' }}>
                <IconBrain size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
                <div style={{ fontSize: 14, marginBottom: 4 }}>暂无记忆</div>
                <div style={{ fontSize: 12 }}>开始对话后 AI 会自动生成</div>
              </div>
            )}

            {(['A', 'B'] as const).map(cat => {
              const items = memories.filter((m: any) => m.category === cat);
              if (items.length === 0) return null;
              return (
                <div key={cat} style={{ marginBottom: 20 }}>
                  <h3 style={{ fontSize: 14, marginBottom: 10, color: cat === 'A' ? '#7c3aed' : '#2563eb', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                    {cat === 'A' ? <IconBrain size={16} /> : <IconActivity size={16} />}
                    {cat === 'A' ? '长期记忆' : '短期记忆'}
                    <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-4)' }}>（{items.length} 条）</span>
                  </h3>
                  {items.map((m: any) => (
                    <div key={m.id} style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{m.content}</span>
                      <button onClick={() => delMemory(m.id)} style={{ ...btnDanger, fontSize: 11, padding: '3px 10px' }}><IconTrash size={12} /> 删除</button>
                    </div>
                  ))}
                </div>
              );
            })}
          </>
        )}

        {/* ════════════════════════════════════════════════════
            技能 Tab
            ════════════════════════════════════════════════════ */}
        {tab === 'skills' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <IconCode size={18} style={{ color: 'var(--accent)' }} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>技能</h2>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-4)' }}>启用后，AI 会在需要时按需加载该技能正文（与 WorkBuddy 一致的「目录 + 按需加载」模式，可与 WorkBuddy 互通）</p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={importSkills} disabled={importing} style={{ ...btnGhost, opacity: importing ? 0.5 : 1, cursor: importing ? 'not-allowed' : 'pointer' }}>
                  {importing ? '导入中...' : <><IconSync size={14} /> 从 WorkBuddy 导入</>}
                </button>
                <button onClick={startNewSkill} style={btnPrimary}><IconPlus size={14} /> 新建技能</button>
              </div>
            </div>

            {/* 使用教学：如何把 WorkBuddy 的 skills 加载进来 */}
            <SetupGuide steps={skillGuideSteps} done={skills.some((s: any) => s.source === 'workbuddy')} />

            {/* 新建 / 编辑面板 */}
            {skillEdit && (
              <div style={{ ...cardStyle, borderColor: 'var(--accent)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 15, color: 'var(--text)', fontWeight: 600 }}>{skillEdit === 'new' ? '新建技能' : '编辑技能'}</h3>
                  <button onClick={() => setSkillEdit(null)} style={{ ...btnGhost, padding: '4px 10px' }}><IconX size={14} /> 取消</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 6, fontWeight: 500 }}>名称</label>
                    <input value={skillForm.name} onChange={e => setSkillForm({ ...skillForm, name: e.target.value })} placeholder="skill 名称（英文/数字/下划线）" style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 6, fontWeight: 500 }}>一句话描述</label>
                    <input value={skillForm.description} onChange={e => setSkillForm({ ...skillForm, description: e.target.value })} placeholder="这个技能做什么" style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 6, fontWeight: 500 }}>技能正文（Markdown，描述何时以及如何使用）</label>
                  <textarea value={skillForm.content} onChange={e => setSkillForm({ ...skillForm, content: e.target.value })} placeholder={'例如：\n当用户要求「图解/可视化某个概念」时，使用 concept-visual-demo 流程产出单文件交互式 HTML...'} style={{ ...inputStyle, width: '100%', minHeight: 200, resize: 'vertical', fontFamily: 'Menlo, Consolas, monospace', fontSize: 12.5, lineHeight: 1.7, boxSizing: 'border-box' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 500 }}>启用（注入系统提示词）</span>
                  <Toggle checked={skillForm.enabled} onChange={v => setSkillForm({ ...skillForm, enabled: v })} />
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button onClick={saveSkill} disabled={skillBusy} style={{ ...btnPrimary, opacity: skillBusy ? 0.5 : 1, cursor: skillBusy ? 'not-allowed' : 'pointer' }}>
                    {skillBusy ? '保存中...' : <><IconCheck size={14} /> 保存</>}
                  </button>
                </div>
              </div>
            )}

            {/* 列表 / 空态 */}
            {!skillEdit && skills.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-4)' }}>
                <IconCode size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
                <div style={{ fontSize: 14, marginBottom: 4 }}>暂无技能</div>
                <div style={{ fontSize: 12 }}>点「从 WorkBuddy 导入」一键获取本机 37 个技能，或「新建技能」</div>
              </div>
            )}

            {!skillEdit && skills.map((s: any) => (
              <div key={s.id} style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{s.name}</span>
                    <span style={{ fontSize: 10, padding: '1px 8px', borderRadius: 10, fontWeight: 500, background: s.source === 'workbuddy' ? 'var(--accent-soft)' : 'var(--bg-muted)', color: s.source === 'workbuddy' ? 'var(--accent)' : 'var(--text-3)' }}>
                      {s.source === 'workbuddy' ? 'WorkBuddy' : s.source === 'imported' ? '已派生' : '本地'}
                    </span>
                    {s.enabled
                      ? <span style={{ fontSize: 10, padding: '1px 8px', borderRadius: 10, background: 'var(--success-bg)', color: 'var(--success)', fontWeight: 500 }}>已启用</span>
                      : <span style={{ fontSize: 10, padding: '1px 8px', borderRadius: 10, background: 'var(--bg-muted)', color: 'var(--text-4)', fontWeight: 500 }}>已禁用</span>}
                  </div>
                  {s.description && <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>{s.description}</div>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 12, flexShrink: 0 }}>
                  <Toggle checked={!!s.enabled} onChange={() => toggleSkill(s)} />
                  <button onClick={() => startEditSkill(s)} style={{ ...btnGhost, padding: '4px 10px' }}><IconEdit size={13} /> 编辑</button>
                  <button onClick={() => exportSkill(s.id)} style={{ ...btnGhost, padding: '4px 10px' }} title="导出到 WorkBuddy"><IconExternalLink size={13} /></button>
                  <button onClick={() => deleteSkill(s.id)} style={{ ...btnDanger, padding: '4px 10px', fontSize: 11 }}><IconTrash size={13} /></button>
                </div>
              </div>
            ))}
          </>
        )}

        {/* ═══════════════════════════════════════════════════
            安全 Tab —— 权限矩阵 / 审批 / 沙箱 / 密钥保护
            ═══════════════════════════════════════════════════ */}
        {tab === 'security' && (
          <SecurityTab />
        )}
      </main>
    </div>
  );
}

// =========================================================================
// SecurityTab —— 安全设置面板
// =========================================================================
interface SecurityPolicy {
  pathBlocklist: string[];
  extensionAllowlist: string[];
  extensionBlocklist: string[];
  writeRatePerMin: number;
  maxWriteBytes: number;
  maxReadBytes: number;
  approvalMode: 'auto_approve' | 'require_approval';
  sandboxEnabled: boolean;
}

interface ApprovalItem {
  id: string;
  sessionId: string;
  action: 'write' | 'edit';
  path: string;
  before: string;
  after: string;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  createdAt: string;
}

function SecurityTab() {
  const [policy, setPolicy] = useState<SecurityPolicy | null>(null);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [stats, setStats] = useState<{ pending: number; approvedToday: number; rejectedToday: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [newBlockEntry, setNewBlockEntry] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  // 密钥保护状态（从 /api/providers 读取，判断 api_key 是否带 enc:v1: 前缀）
  const [protectedProviders, setProtectedProviders] = useState(0);
  const [totalProviders, setTotalProviders] = useState(0);

  // 健壮性：每个接口独立 try，单接口失败不阻塞整面板；非 200 时读 error 字段
  async function safeJson(url: string): Promise<any | null> {
    try {
      const r = await fetch(url);
      if (!r.ok) {
        const d = await r.json().catch(() => ({ error: r.statusText }));
        throw new Error(d.error || `${r.status} ${r.statusText}`);
      }
      return await r.json();
    } catch (e: any) {
      return { __error: e.message };
    }
  }

  async function loadAll() {
    const [p, a, s, provs] = await Promise.all([
      safeJson('/api/security/policy'),
      safeJson('/api/security/approvals?status=pending'),
      safeJson('/api/security/stats'),
      safeJson('/api/providers'),
    ]);

    // 路由未挂载（404）时的可操作提示——dev server 需重启加载新路由
    if (p?.__error) {
      setLoadError(`安全接口加载失败：${p.__error}。请重启 dev server（npm run web:dev）让新路由生效，再回到此页。`);
      return;
    }
    setLoadError(null);
    setPolicy(p as SecurityPolicy);
    setApprovals(Array.isArray(a) ? a : []);
    setStats(s && !s.__error ? s : null);
    const list = Array.isArray(provs) ? provs : [];
    setTotalProviders(list.length);
    setProtectedProviders(list.filter((x: any) => x.api_key && x.api_key.startsWith('enc:v1:')).length);
  }

  useEffect(() => { loadAll(); const t = setInterval(loadAll, 5000); return () => clearInterval(t); }, []);

  async function savePolicy(patch: Partial<SecurityPolicy>) {
    setBusy(true);
    try {
      const res = await fetch('/api/security/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json()).error || '保存失败');
      setPolicy(await res.json());
      setMsg('安全策略已更新');
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  async function approve(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/security/approvals/${id}/approve`, { method: 'POST' });
      await loadAll();
      setMsg('已批准并写入目标文件');
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  async function reject(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/security/approvals/${id}/reject`, { method: 'POST' });
      await loadAll();
      setMsg('已拒绝，目标文件未修改');
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  function addBlockEntry() {
    if (!policy || !newBlockEntry.trim()) return;
    const entry = newBlockEntry.trim();
    if (policy.pathBlocklist.includes(entry)) { setMsg('该路径已在黑名单中'); return; }
    savePolicy({ pathBlocklist: [...policy.pathBlocklist, entry] });
    setNewBlockEntry('');
  }

  function removeBlockEntry(entry: string) {
    if (!policy) return;
    savePolicy({ pathBlocklist: policy.pathBlocklist.filter(e => e !== entry) });
  }

  if (!policy) {
    if (loadError) {
      return (
        <div style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>
            <IconAlertCircle size={16} />
            <span style={{ fontWeight: 600 }}>安全面板加载失败</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 8, lineHeight: 1.6 }}>{loadError}</div>
          <button onClick={loadAll} style={{ ...btnPrimary, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IconRefresh size={14} /> 重试
          </button>
        </div>
      );
    }
    return <div style={{ padding: 20, color: 'var(--text-3)' }}>加载安全配置中…</div>;
  }

  const protectedPct = totalProviders > 0 ? Math.round((protectedProviders / totalProviders) * 100) : 100;

  return (
    <>
      {/* ─── 安全概览卡片 ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <SecurityStatCard
          icon={<IconLock size={18} />}
          label="密钥保护"
          value={`${protectedProviders}/${totalProviders}`}
          sub={`API Key 加密存储 (${protectedPct}%)`}
          tone={protectedPct === 100 ? 'ok' : 'warn'}
        />
        <SecurityStatCard
          icon={<IconCheck size={18} />}
          label="待审批"
          value={String(stats?.pending ?? 0)}
          sub="沙箱暂存的写入变更"
          tone={(stats?.pending ?? 0) > 0 ? 'warn' : 'ok'}
        />
        <SecurityStatCard
          icon={<IconActivity size={18} />}
          label="今日审批"
          value={String((stats?.approvedToday ?? 0) + (stats?.rejectedToday ?? 0))}
          sub={`批准 ${stats?.approvedToday ?? 0} · 拒绝 ${stats?.rejectedToday ?? 0}`}
          tone="ok"
        />
        <SecurityStatCard
          icon={<IconShield size={18} />}
          label="审批模式"
          value={policy.approvalMode === 'require_approval' ? '需审批' : '自动批准'}
          sub={policy.sandboxEnabled ? '沙箱已开启' : '沙箱已关闭'}
          tone={policy.approvalMode === 'require_approval' ? 'ok' : 'warn'}
        />
      </div>

      {/* ─── 审批模式 ─── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <IconShield size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>审批模式</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13 }}>
            <input type="radio" name="approvalMode" checked={policy.approvalMode === 'require_approval'} onChange={() => savePolicy({ approvalMode: 'require_approval' })} />
            <div>
              <div style={{ fontWeight: 600 }}>需审批（推荐）</div>
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>AI 的 write/edit 先暂存到 .miniclaw-sandbox/，用户在下方队列批准后才写入目标文件</div>
            </div>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13 }}>
            <input type="radio" name="approvalMode" checked={policy.approvalMode === 'auto_approve'} onChange={() => savePolicy({ approvalMode: 'auto_approve' })} />
            <div>
              <div style={{ fontWeight: 600 }}>自动批准</div>
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>AI 的 write/edit 直接写入目标文件（仍受路径黑名单、扩展名黑名单、写入限流约束）</div>
            </div>
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <Toggle checked={policy.sandboxEnabled} onChange={(v) => savePolicy({ sandboxEnabled: v })} />
            <span style={{ fontSize: 13 }}>沙箱暂存（开启后写入先落 .miniclaw-sandbox/，关闭则审批模式下直接拒绝写入）</span>
          </div>
        </div>
      </div>

      {/* ─── 权限矩阵 ─── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <IconLock size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>权限矩阵 & 限流</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>写入限流（次/分钟）</label>
            <input type="number" min={0} max={1000} value={policy.writeRatePerMin}
              onChange={(e) => { const v = parseInt(e.target.value) || 0; setPolicy({ ...policy, writeRatePerMin: v }); }}
              onBlur={(e) => savePolicy({ writeRatePerMin: parseInt(e.target.value) || 0 })}
              style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>单文件写入上限（字节）</label>
            <input type="number" min={1024} value={policy.maxWriteBytes}
              onChange={(e) => { const v = parseInt(e.target.value) || 0; setPolicy({ ...policy, maxWriteBytes: v }); }}
              onBlur={(e) => savePolicy({ maxWriteBytes: parseInt(e.target.value) || 0 })}
              style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>单文件读取上限（字节）</label>
            <input type="number" min={1024} value={policy.maxReadBytes}
              onChange={(e) => { const v = parseInt(e.target.value) || 0; setPolicy({ ...policy, maxReadBytes: v }); }}
              onBlur={(e) => savePolicy({ maxReadBytes: parseInt(e.target.value) || 0 })}
              style={inputStyle} />
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
          扩展名黑名单（禁止 AI 读写）：{policy.extensionBlocklist.map(e => <code key={e} style={{ background: 'var(--bg-muted)', padding: '2px 6px', borderRadius: 4, marginRight: 4, fontFamily: 'Menlo, Consolas, monospace', fontSize: 11 }}>.{e}</code>)}
        </div>
      </div>

      {/* ─── 路径黑名单 ─── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <IconShield size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>路径黑名单</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>
          命中以下路径片段（目录名或文件名）的 AI 读写操作将被拒绝。默认包含 .env、.ssh、.aws、.git、node_modules、私钥文件。
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <input type="text" value={newBlockEntry} onChange={(e) => setNewBlockEntry(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addBlockEntry(); }} placeholder="如：secrets/ 或 credentials.json" style={{ ...inputStyle, flex: 1 }} />
          <button onClick={addBlockEntry} disabled={!newBlockEntry.trim()} style={{ ...btnPrimary, opacity: newBlockEntry.trim() ? 1 : 0.5 }}><IconPlus size={14} /> 添加</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {policy.pathBlocklist.map(entry => (
            <span key={entry} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--bg-muted)', borderRadius: 6, padding: '4px 8px', fontSize: 12 }}>
              <code style={{ fontFamily: 'Menlo, Consolas, monospace' }}>{entry}</code>
              <button onClick={() => removeBlockEntry(entry)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--danger)', padding: 0, lineHeight: 1 }} title="移除">×</button>
            </span>
          ))}
        </div>
      </div>

      {/* ─── 审批队列 ─── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <IconActivity size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>审批队列（{approvals.length} 项待处理）</span>
          <button onClick={loadAll} style={{ ...btnGhost, marginLeft: 'auto' }}><IconRefresh size={14} /> 刷新</button>
        </div>
        {approvals.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '12px 0' }}>暂无待审批的写入变更。当 AI 发起 write/edit 时，变更会出现在这里。</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {approvals.map(item => (
              <div key={item.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--bg)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: item.action === 'write' ? 'var(--accent)' : 'var(--text-2)' }}>{item.action === 'write' ? '写入' : '编辑'}</span>
                  <code style={{ fontSize: 12, fontFamily: 'Menlo, Consolas, monospace' }}>{item.path}</code>
                  <span style={{ fontSize: 11, color: 'var(--text-4)', marginLeft: 'auto' }}>{new Date(item.createdAt).toLocaleTimeString()}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>
                  <span>会话：{item.sessionId.slice(0, 8)}…</span>
                  <span>原内容 {item.before.length} 字符 → 新内容 {item.after.length} 字符</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => approve(item.id)} disabled={busy} style={{ ...btnPrimary, fontSize: 12 }}><IconCheck size={12} /> 批准写入</button>
                  <button onClick={() => reject(item.id)} disabled={busy} style={{ ...btnDanger, fontSize: 12 }}><IconX size={12} /> 拒绝</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── 密钥保护状态 ─── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <IconLock size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>密钥保护状态</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>
          API Key、OAuth Token、App Secret 等敏感凭证已使用 AES-256-GCM 加密存储。
          主密钥由 Windows DPAPI 派生，与本机用户绑定——数据库被拷走也无法解密。
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
          <div>
            <span style={{ color: 'var(--text-3)' }}>服务商密钥：</span>
            <span style={{ fontWeight: 600, color: protectedPct === 100 ? 'var(--accent)' : 'var(--danger)' }}>{protectedProviders}/{totalProviders} 已加密</span>
          </div>
          {stats && (
            <div>
              <span style={{ color: 'var(--text-3)' }}>历史审批总数：</span>
              <span style={{ fontWeight: 600 }}>{stats.total}</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function SecurityStatCard({ icon, label, value, sub, tone }: {
  icon: React.ReactNode; label: string; value: string; sub: string; tone: 'ok' | 'warn' | 'danger';
}) {
  const toneColor = tone === 'ok' ? 'var(--accent)' : tone === 'warn' ? '#d97706' : 'var(--danger)';
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, background: 'var(--bg-surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ color: toneColor }}>{icon}</span>
        <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: toneColor, marginBottom: 2 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{sub}</div>
    </div>
  );
}
