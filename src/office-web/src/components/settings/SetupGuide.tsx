import { useState } from 'react';
import { IconCheck, IconChevronRight, IconCopy, IconInfo } from '../Icons';
import { codeStyle } from './styles';

// =========================================================================
// SetupGuide —— 分步教学引导面板
// =========================================================================
export type GuideStep = {
  title: string;
  body: React.ReactNode;
};

export function CopyChip({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 6 }}>
      <code style={{ background: '#f0f0f0', padding: '3px 8px', borderRadius: 5, fontSize: 12, fontFamily: 'Menlo, Consolas, monospace' }}>{value}</code>
      <button
        onClick={() => {
          try { navigator.clipboard?.writeText(value); } catch { /* ignore */ }
          setCopied(true); setTimeout(() => setCopied(false), 1200);
        }}
        className="mc-float"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid #e0e0e0', background: '#fff', borderRadius: 5, padding: '3px 10px', fontSize: 11, cursor: 'pointer', color: '#555', transition: 'all 0.15s' }}
      >
        {copied ? <><IconCheck size={12} /> 已复制</> : <><IconCopy size={12} /> {label || '复制'}</>}
      </button>
    </span>
  );
}

export function SetupGuide({
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
        className="mc-float"
        style={{ width: '100%', textAlign: 'left', padding: '12px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: '#874d00', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, transition: 'background 0.15s, color 0.15s, transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,180,80,.16)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
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

export { codeStyle };
