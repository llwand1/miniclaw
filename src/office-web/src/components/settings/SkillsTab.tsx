import { useEffect, useState } from 'react';
import { IconCheck, IconCode, IconEdit, IconExternalLink, IconPlus, IconSync, IconTrash, IconX } from '../Icons';
import { SetupGuide, CopyChip } from './SetupGuide';
import type { GuideStep } from './SetupGuide';
import { Toggle } from './Toggle';
import { btnDanger, btnGhost, btnPrimary, cardStyle, codeStyle, inputStyle } from './styles';

/** 技能 Tab：WorkBuddy 互通（导入/导出/新建/编辑/启停）。从 SettingsPage 拆出。 */
export function SkillsTab({ onMsg }: { onMsg: (msg: string) => void }) {
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
          也可以点「新建技能」在 studentbuddy 内自己从头写一个。
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
          列表右侧的导出图标可把 studentbuddy 里的技能导出回 <code style={codeStyle}>~/.workbuddy/skills/</code>，实现两个软件共享同一套技能。
        </>
      ),
    },
  ];

  useEffect(() => { loadSkills(); }, []);

  async function loadSkills() {
    try { setSkills(await (await fetch('/api/skills')).json()); } catch { onMsg('技能加载失败'); }
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
    } catch { onMsg('加载技能失败'); }
  }
  async function saveSkill() {
    if (!skillForm.name.trim()) { onMsg('技能名称必填'); return; }
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
      onMsg(skillEdit === 'new' ? '技能已创建' : '技能已更新');
    } catch (e: any) { onMsg(e.message); }
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
    } catch (e: any) { onMsg(e.message); }
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
      onMsg(`已从 WorkBuddy 导入 ${d.added} 个技能（跳过 ${d.skipped} 个已存在），默认禁用，请按需启用`);
    } catch (e: any) { onMsg(e.message); }
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
      onMsg(`已导出到 WorkBuddy：${d.path}`);
    } catch (e: any) { onMsg(e.message); }
  }

  return (
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
          <button onClick={importSkills} disabled={importing} className="mc-float" style={{ ...btnGhost, opacity: importing ? 0.5 : 1, cursor: importing ? 'not-allowed' : 'pointer' }}>
            {importing ? '导入中...' : <><IconSync size={14} /> 从 WorkBuddy 导入</>}
          </button>
          <button onClick={startNewSkill} className="mc-float" style={btnPrimary}><IconPlus size={14} /> 新建技能</button>
        </div>
      </div>

      {/* 使用教学：如何把 WorkBuddy 的 skills 加载进来 */}
      <SetupGuide steps={skillGuideSteps} done={skills.some((s: any) => s.source === 'workbuddy')} />

      {/* 新建 / 编辑面板 */}
      {skillEdit && (
        <div style={{ ...cardStyle, borderColor: 'var(--accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, color: 'var(--text)', fontWeight: 600 }}>{skillEdit === 'new' ? '新建技能' : '编辑技能'}</h3>
            <button onClick={() => setSkillEdit(null)} className="mc-float" style={{ ...btnGhost, padding: '4px 10px' }}><IconX size={14} /> 取消</button>
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
            <button onClick={saveSkill} disabled={skillBusy} className="mc-float" style={{ ...btnPrimary, opacity: skillBusy ? 0.5 : 1, cursor: skillBusy ? 'not-allowed' : 'pointer' }}>
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
            <button onClick={() => startEditSkill(s)} className="mc-float" style={{ ...btnGhost, padding: '4px 10px' }}><IconEdit size={13} /> 编辑</button>
            <button onClick={() => exportSkill(s.id)} className="mc-float" style={{ ...btnGhost, padding: '4px 10px' }} title="导出到 WorkBuddy"><IconExternalLink size={13} /></button>
            <button onClick={() => deleteSkill(s.id)} className="mc-float" style={{ ...btnDanger, padding: '4px 10px', fontSize: 11 }}><IconTrash size={13} /></button>
          </div>
        </div>
      ))}
    </>
  );
}
