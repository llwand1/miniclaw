// 设置页（SettingsPage）共享样式常量

export const inputStyle: React.CSSProperties = {
  padding: '9px 14px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13,
  background: 'var(--bg-surface)', color: 'var(--text)', outline: 'none', transition: 'border-color 0.15s, background 0.25s, color 0.25s',
};
export const codeStyle: React.CSSProperties = {
  background: '#f0f0f0', padding: '2px 6px', borderRadius: 5, fontSize: 12, fontFamily: 'Menlo, Consolas, monospace',
};
export const cardStyle: React.CSSProperties = {
  padding: '14px 18px', border: '1px solid var(--border)', borderRadius: 10,
  marginBottom: 10, background: 'var(--bg-surface)', transition: 'box-shadow 0.15s, background 0.25s, border-color 0.25s',
};
export const btnBase: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '6px 14px', border: 'none', borderRadius: 7, cursor: 'pointer',
  fontSize: 12.5, fontWeight: 500, transition: 'all 0.15s',
};
export const btnPrimary: React.CSSProperties = { ...btnBase, background: 'var(--accent)', color: '#fff' };
export const btnDanger: React.CSSProperties = { ...btnBase, background: 'var(--danger)', color: '#fff' };
export const btnGhost: React.CSSProperties = { ...btnBase, background: 'var(--bg-muted)', color: 'var(--text-2)', border: '1px solid var(--border)' };
export const th: any = { padding: '8px 12px', textAlign: 'left' as const, fontWeight: 600, fontSize: 12, color: 'var(--text-3)', borderBottom: '2px solid var(--border)' };
export const td: any = { padding: '8px 12px', textAlign: 'left' as const, fontSize: 12.5 };
