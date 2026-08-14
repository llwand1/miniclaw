import { useEffect, useState } from 'react';
import { IconCheck, IconCode, IconMessageSquare, IconRefresh } from '../Icons';
import { btnGhost, btnPrimary, cardStyle, inputStyle } from './styles';

/** 系统提示词 Tab。从 SettingsPage 拆出。 */
export function PromptTab({ onMsg }: { onMsg: (msg: string) => void }) {
  const [prompt, setPrompt] = useState('');
  const [promptDefault, setPromptDefault] = useState('');
  const [promptPreview, setPromptPreview] = useState('');
  const [promptDirty, setPromptDirty] = useState(false);
  const [promptBusy, setPromptBusy] = useState(false);

  async function loadSystemPrompt() {
    try {
      const d = await (await fetch('/api/system-prompt')).json();
      if (d) { setPrompt(d.custom || ''); setPromptDefault(d.default || ''); setPromptPreview(d.preview || ''); }
    } catch { /* ignore */ }
  }
  useEffect(() => { loadSystemPrompt(); }, []);

  async function saveSystemPrompt() {
    setPromptBusy(true); onMsg('');
    try {
      const res = await fetch('/api/system-prompt', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: prompt }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || '保存失败');
      setPromptPreview(d.preview || '');
      setPromptDirty(false);
      onMsg('系统提示词已保存');
    } catch (err: any) { onMsg(err.message); } finally { setPromptBusy(false); }
  }

  return (
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
            className="mc-float" style={{ ...btnPrimary, opacity: promptBusy || !promptDirty ? 0.5 : 1, cursor: promptBusy || !promptDirty ? 'not-allowed' : 'pointer' }}>
            {promptBusy ? '保存中...' : <><IconCheck size={14} /> 保存</>}
          </button>
          <button onClick={() => loadSystemPrompt()} className="mc-float" style={btnGhost}><IconRefresh size={14} /> 撤销修改</button>
        </div>
      </div>

      <div style={{ ...cardStyle, background: 'var(--bg-inset)' }}>
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-3)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 8, transition: 'background .15s, color .15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-muted)'; e.currentTarget.style.color = 'var(--text)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; }}>
            <IconCode size={14} /> 最终发给模型的系统提示词（含自动注入的工具说明与记忆）
          </summary>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, color: 'var(--text-2)', marginTop: 10, lineHeight: 1.7, maxHeight: 340, overflowY: 'auto', background: '#fff', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--border)', fontFamily: 'Menlo, Consolas, monospace' }}>
            {promptPreview || '（暂无预览，保存后刷新）'}
          </pre>
        </details>
      </div>
    </>
  );
}
