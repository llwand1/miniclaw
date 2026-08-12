// QuizCard —— quiz-generator 技能的选择题卡片（主窗 ChatPage 与悬浮窗 FloatingApp 共用）。
//
// 解析 assistant 文本里的 [QUIZ]...[/QUIZ] JSON，渲染为可交互选择题卡片：
// 题干 + A/B/C/D 选项（单选/多选点选）→「查看答案」→ 对错判定 + 答案解析。
// 样式统一用固定色值（不依赖 --mc-*/--bg 等窗口级 CSS 变量），保证两个窗口渲染一致。
import { useState } from 'react';

export interface QuizOption { A: string; B: string; C: string; D?: string; }
export interface QuizQuestion { type?: string; question: string; options: QuizOption; answer?: string[]; explanation?: string; }
export interface QuizData { title?: string; questions: QuizQuestion[]; }

/** 从 assistant 文本里提取 [QUIZ] JSON；未闭合/解析失败返回 null（流式期间退回 Markdown） */
export function parseQuiz(text: string): QuizData | null {
  if (!text) return null;
  const m = text.match(/\[QUIZ\]([\s\S]*?)\[\/QUIZ\]/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[1].trim());
    if (d && Array.isArray(d.questions) && d.questions.length > 0) return d as QuizData;
  } catch { /* ignore */ }
  return null;
}

const C = {
  accent: '#6366f1',
  green: '#34C759',
  red: '#ef4444',
  text: '#1f2430',
  muted: '#8a8f9c',
  hair: 'rgba(0,0,0,.08)',
  glass: 'rgba(255,255,255,.7)',
  seg: 'rgba(0,0,0,.03)',
};

function Check({ size = 13, color = C.green }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function Cross({ size = 13, color = C.red }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function QuizCard({ data, streaming }: { data: QuizData; streaming?: boolean }) {
  const [sel, setSel] = useState<Record<number, string[]>>({});
  const [reveal, setReveal] = useState<Record<number, boolean>>({});
  return (
    <div style={{ border: '1px solid ' + C.hair, background: C.glass, borderRadius: 12, padding: '10px 12px', margin: '0 0 10px', fontSize: 13, boxShadow: '0 1px 6px rgba(0,0,0,.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 8 }}>
        <Check size={12} color={C.accent} /> {data.title || '选择题'}
        {streaming && <span style={{ display: 'inline-block', width: 7, height: 14, marginLeft: 4, background: C.accent, animation: 'qcCaret 1s step-end infinite' }} />}
      </div>
      {data.questions.map((q, qi) => {
        const mySel = sel[qi] || [];
        const isRevealed = !!reveal[qi];
        const answer = Array.isArray(q.answer) ? q.answer : [];
        const correct = isRevealed && answer.length > 0 && answer.every(a => mySel.includes(a)) && mySel.length === answer.length;
        const wrong = isRevealed && !correct;
        return (
          <div key={qi} style={{ marginBottom: 12, paddingBottom: 10, borderBottom: qi < data.questions.length - 1 ? '1px solid ' + C.hair : 'none' }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: C.text }}>{qi + 1}. {q.question}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {Object.entries(q.options).map(([k, v]) => {
                const picked = mySel.includes(k);
                const optColor = isRevealed
                  ? (answer.includes(k) ? C.green : picked ? C.red : C.text)
                  : picked ? C.accent : C.text;
                return (
                  <button key={k} disabled={isRevealed} onClick={() => {
                    setSel(prev => {
                      const cur = prev[qi] || [];
                      const isMulti = q.type === 'multiple';
                      const next = isMulti
                        ? (cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k])
                        : (cur.includes(k) ? [] : [k]);
                      return { ...prev, [qi]: next };
                    });
                  }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, border: '1px solid ' + (picked || (isRevealed && answer.includes(k)) ? 'currentColor' : C.hair), background: picked ? 'rgba(99,102,241,.08)' : 'transparent', color: optColor, cursor: isRevealed ? 'default' : 'pointer', fontSize: 12.5, textAlign: 'left' }}>
                    <span style={{ fontWeight: 700, flexShrink: 0 }}>{k}.</span>
                    <span style={{ flex: 1 }}>{v}</span>
                    {isRevealed && answer.includes(k) && <Check />}
                    {isRevealed && picked && !answer.includes(k) && <Cross />}
                  </button>
                );
              })}
            </div>
            {!isRevealed ? (
              <button onClick={() => setReveal(prev => ({ ...prev, [qi]: true }))}
                style={{ marginTop: 6, padding: '5px 14px', borderRadius: 8, border: 'none', background: C.accent, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                查看答案
              </button>
            ) : (
              <div style={{ marginTop: 6, padding: '6px 10px', borderRadius: 8, background: correct ? 'rgba(52,199,89,.08)' : C.seg, border: '1px solid ' + (correct ? 'rgba(52,199,89,.4)' : wrong ? 'rgba(239,68,68,.3)' : C.hair), fontSize: 12, color: correct ? '#1a7f37' : wrong ? C.red : C.text }}>
                {correct ? '✅ 回答正确' : wrong ? '❌ 回答错误' : ''}
                {answer.length > 0 && <div style={{ marginTop: 3 }}>正确答案：<strong>{answer.join('、')}</strong></div>}
                {q.explanation && <div style={{ marginTop: 3, color: C.muted }}>解析：{q.explanation}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
