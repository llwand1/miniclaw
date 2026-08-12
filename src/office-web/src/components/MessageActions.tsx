import { useState, ReactNode } from 'react';
import { useMessageActions, ShareResult } from '../lib/messageActions';

// ── 自绘线条 SVG 图标（不用 emoji，currentColor 继承文字色）──────────────
const svg = (size: number, children: ReactNode, sw = 1.8) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IconCopy = () => svg(14, <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>);
const IconCheck = () => svg(14, <polyline points="20 6 9 17 4 12" />);
const IconSpeak = () => svg(14, <><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19 5a9 9 0 0 1 0 14" /></>);
const IconStop = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>;
const IconShare = () => svg(14, <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" /></>);

interface Props {
  text: string;
  title?: string;
  iconColor?: string;
  hoverBg?: string;
  /** 复制/分享结果回调，供父组件弹 toast */
  onResult?: (r: ShareResult | 'copied') => void;
  style?: React.CSSProperties;
}

export default function MessageActions({ text, title, iconColor = 'currentColor', hoverBg = 'rgba(0,0,0,.06)', onResult, style }: Props) {
  const { speaking, shareState, copyText, speak, share } = useMessageActions();
  const [copied, setCopied] = useState(false);

  const btnBase: React.CSSProperties = {
    width: 26, height: 26, border: 'none', background: 'transparent', borderRadius: 7,
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    color: iconColor, transition: 'background .12s, color .12s', padding: 0,
  };

  async function handleCopy() {
    const ok = await copyText(text);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); onResult?.('copied'); }
    else onResult?.('failed' as any);
  }

  async function handleShare() {
    const r = await share(text, title);
    if (r === 'copied') { setCopied(true); setTimeout(() => setCopied(false), 1500); }
    onResult?.(r);
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, ...style }}>
      <button title="复制" style={btnBase} onClick={handleCopy}
        onMouseEnter={e => (e.currentTarget.style.background = hoverBg)}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
        {copied ? <IconCheck /> : <IconCopy />}
      </button>
      <button title={speaking ? '停止朗读' : '朗读'} style={btnBase} onClick={() => speak(text)}
        onMouseEnter={e => (e.currentTarget.style.background = hoverBg)}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
        {speaking ? <IconStop /> : <IconSpeak />}
      </button>
      <button title="分享" style={btnBase} onClick={handleShare}
        onMouseEnter={e => (e.currentTarget.style.background = hoverBg)}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
        <IconShare />
      </button>
    </div>
  );
}
