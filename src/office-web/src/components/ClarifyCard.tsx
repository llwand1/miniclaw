// ClarifyCard —— 需求澄清卡片（grill-me 风格，主窗 ChatPage 使用）。
//
// 模型在规划阶段输出 [ASK:{json}] 后，服务端挂起生成并通过 SSE 下发 clarify 事件；
// 前端渲染本卡片，用户点选选项（或输入自定义答案）后提交到 /api/chat/clarify，
// 服务端把答案回灌历史并恢复完整生成流程。
// 样式统一用固定色值，与 QuizCard 同风格，保证两个窗口渲染一致。
import { useState } from 'react';

export interface ClarifyData {
  sessionId: string;
  question: string;
  options: string[];
  allowCustom: boolean;
}

const C = {
  accent: '#6366f1',
  text: '#1f2430',
  muted: '#8a8f9c',
  hair: 'rgba(0,0,0,.08)',
  glass: 'rgba(255,255,255,.7)',
};

export function ClarifyCard({ data, answered, onSubmit }: {
  data: ClarifyData;
  answered?: string | null;
  onSubmit: (answer: string) => void;
}) {
  const [custom, setCustom] = useState('');
  const done = !!answered;
  return (
    <div style={{ border: '1px solid ' + C.hair, background: C.glass, borderRadius: 12, padding: '10px 12px', margin: '0 0 10px', fontSize: 13, boxShadow: '0 1px 6px rgba(0,0,0,.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 8 }}>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke={C.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        需求确认
      </div>
      <div style={{ fontWeight: 600, marginBottom: 8, color: C.text }}>{data.question}</div>
      {!done ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {data.options.map((opt, i) => (
              <button key={i} onClick={() => onSubmit(opt)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, border: '1px solid ' + C.hair, background: 'transparent', color: C.text, cursor: 'pointer', fontSize: 12.5, textAlign: 'left' }}>
                <span style={{ fontWeight: 700, color: C.accent, flexShrink: 0 }}>{String.fromCharCode(65 + i)}.</span>
                <span style={{ flex: 1 }}>{opt}</span>
              </button>
            ))}
          </div>
          {data.allowCustom && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input value={custom} onChange={e => setCustom(e.target.value)} placeholder="自定义答案…"
                onKeyDown={e => { if (e.key === 'Enter' && custom.trim()) onSubmit(custom.trim()); }}
                style={{ flex: 1, padding: '6px 10px', borderRadius: 8, border: '1px solid ' + C.hair, fontSize: 12.5, outline: 'none', background: '#fff', color: C.text }} />
              <button onClick={() => custom.trim() && onSubmit(custom.trim())} disabled={!custom.trim()}
                style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: custom.trim() ? C.accent : C.hair, color: custom.trim() ? '#fff' : C.muted, cursor: custom.trim() ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 600 }}>
                提交
              </button>
            </div>
          )}
        </>
      ) : (
        <div style={{ padding: '6px 10px', borderRadius: 8, background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.3)', color: C.text, fontSize: 12 }}>
          已选择：<strong>{answered}</strong>，正在继续处理…
        </div>
      )}
    </div>
  );
}
