// QuizCard —— quiz-generator 技能的选择题卡片（主窗 ChatPage 使用）。
//
// 解析 assistant 文本里的 [QUIZ]...[/QUIZ] JSON，渲染为可交互选择题卡片：
// 题干 + A/B/C/D 选项（单选/多选点选）→「查看答案」→ 对错判定 + 答案解析。
// 样式统一用固定色值（不依赖 --mc-*/--bg 等窗口级 CSS 变量），保证两个窗口渲染一致。
import { useEffect, useState } from 'react';

export interface QuizOption { A: string; B: string; C: string; D?: string; }
export interface QuizQuestion { type?: string; question: string; options: QuizOption; answer?: string[]; explanation?: string; solution?: string; }
export interface QuizData { title?: string; questions: QuizQuestion[]; }

/** 从 assistant 文本里提取 [QUIZ] JSON；解析失败返回 null（流式期间退回 Markdown）。
 *  容错：兼容三种常见结构——
 *  1) 标准：{ title?, questions: [...] }
 *  2) 单题直接输出：{ question, options, answer, explanation }（无 questions 外层）
 *  3) options 为数组：["A. 文本","B. 文本"] 或 ["文本1","文本2"]（按 A/B/C/D 序号归位）
 *  额外容错（对齐「一键出题」稳定性）：
 *  - [QUIZ] 标记大小写不敏感；[/QUIZ] 未闭合时解析到文本末尾（流式中尽早成卡）
 *  - 允许被 Markdown 代码块围栏 ```json ... ``` 包裹
 *  - JSON 尾逗号清理；无 [QUIZ] 标记但整段即 QuizData JSON 时兜底解析
 *  - answer 为字符串（如 "A"）时归一化为数组 ["A"]
 */
export function parseQuiz(text: string): QuizData | null {
  if (!text) return null;
  // 1) 优先提取 [QUIZ]...[/QUIZ] 块（未闭合时匹配到文本末尾，兼容流式）
  const m = text.match(/\[QUIZ\]\s*([\s\S]*?)(?:\s*\[\/QUIZ\]|$)/i);
  let raw: string | null = m && m[1] ? m[1] : null;
  // 2) 无 [QUIZ] 标记：整段本身就是 QuizData JSON（或被围栏直接包裹）时兜底
  if (!raw || !raw.trim()) {
    const stripped = stripCodeFence(text.trim());
    if (/^[\[{]/.test(stripped)) raw = stripped;
  }
  if (!raw) return null;
  const d = parseLenientJson(stripCodeFence(raw.trim()));
  if (!d) return null;
  let qs: any[] | null = null;
  let title = '';
  if (Array.isArray(d.questions) && d.questions.length > 0) {
    qs = d.questions;
    title = typeof d.title === 'string' ? d.title : '';
  } else if (d.question && d.options) {
    // 单题直接输出：包一层 questions
    qs = [d];
  } else if (Array.isArray(d) && d.length > 0) {
    qs = d;
  }
  if (!qs) return null;
  // 归一化每题：options 数组 → 对象 {A,B,C,D}；answer 字符串 → 数组
  const norm = qs.map((q) => {
    if (!q || typeof q !== 'object') return null;
    let options: Record<string, string> = {};
    if (q.options && !Array.isArray(q.options) && typeof q.options === 'object') {
      options = q.options;
    } else if (Array.isArray(q.options)) {
      const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
      (q.options as string[]).forEach((opt, i) => {
        if (typeof opt !== 'string') return;
        const m2 = opt.match(/^([A-F])[.、:：]\s*(.+)$/);
        if (m2) options[m2[1]] = m2[2].trim();
        else if (letters[i]) options[letters[i]] = opt.trim();
      });
    }
    const answer = typeof q.answer === 'string' && q.answer
      ? [q.answer]
      : (Array.isArray(q.answer) ? q.answer.filter(Boolean) : []);
    return { ...q, options, answer };
  });
  if (!norm.every(Boolean)) return null;
  const out: QuizData = { questions: norm as QuizQuestion[] };
  if (title) out.title = title;
  return out;
}

/** 剥掉 Markdown 代码块围栏（```json ... ``` / ``` ... ```），支持包在 [QUIZ] 外或直接包 JSON */
function stripCodeFence(s: string): string {
  return s.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '');
}

/** 宽容 JSON 解析：先标准 parse，失败则清理尾逗号后再试 */
function parseLenientJson(s: string): any {
  try { return JSON.parse(s); } catch { /* 尾逗号容错 */ }
  try { return JSON.parse(s.replace(/,\s*([}\]])/g, '$1')); } catch { /* ignore */ }
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

export function QuizCard({ data, streaming, sessionId, onSessionCreated, quizId: quizIdProp }: {
  data: QuizData;
  streaming?: boolean;
  /** 当前会话 id（对话页传入）：用于 fork 子对话（一键分析继续出题 / 单题解析） */
  sessionId?: string | null;
  /** fork 出子会话后的回调（父组件负责刷新会话树并打开子会话） */
  onSessionCreated?: (childId: string) => void;
  /** 已收藏题库 id（题库页传入）：用于做题统计；对话内收藏后由组件内部记录 */
  quizId?: string | null;
}) {
  const [sel, setSel] = useState<Record<number, string[]>>({});
  const [reveal, setReveal] = useState<Record<number, boolean>>({});
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  // 做题统计：bankId = 收藏后的题库 id（prop 优先，收藏后本地记录）；stats[i] = 第 i 题统计
  const [bankId, setBankId] = useState<string | null>(quizIdProp || null);
  const effectiveQuizId = quizIdProp || bankId;
  const [statsMap, setStatsMap] = useState<Record<number, { attempts: number; correct: number; accuracy: number; streak: number; best_streak: number }>>({});
  const [statsLoaded, setStatsLoaded] = useState(false);
  // 一键分析（做完所有题后）：analyze = { summary, weak_points[], strong_points[] }
  const [analyzing, setAnalyzing] = useState(false);
  const [analyze, setAnalyze] = useState<{ summary: string; weak_points: any[]; strong_points: string[] } | null>(null);
  const [analyzeError, setAnalyzeError] = useState('');
  // 基于薄弱点继续出题（fork 子对话）状态
  const [forking, setForking] = useState(false);
  // 单题一键解析（fork 子对话）：oneSol[qi] = 该题解析文本；oneSolLoading = 正在解析的题号
  const [oneSol, setOneSol] = useState<Record<number, string>>({});
  const [oneSolLoading, setOneSolLoading] = useState<number | null>(null);
  const [oneSolError, setOneSolError] = useState('');
  // 单题一键解析：调 /api/quiz/solution/one（后端会 fork 子对话并把「请求+解析」写入子会话消息流）
  async function solveOne(qi: number) {
    if (oneSolLoading !== null || oneSol[qi]) return;
    setOneSolLoading(qi);
    setOneSolError('');
    try {
      const resp = await fetch('/api/quiz/solution/one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, questionIndex: qi, parentSessionId: sessionId || undefined }),
      });
      const d = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error((d && d.error) || `解析失败（${resp.status}）`);
      if (!d || typeof d.solution !== 'string') throw new Error('解析失败：返回格式异常');
      setOneSol(prev => ({ ...prev, [qi]: d.solution }));
      // 后端已 fork 出子对话（含解析消息）→ 通知父组件刷新树并打开子对话，用户可继续追问
      if (d.sessionId) onSessionCreated?.(d.sessionId);
    } catch (err: any) {
      setOneSolError(err.message || '解析失败');
    } finally {
      setOneSolLoading(null);
    }
  }
  async function saveToBank() {
    if (saving || saved) return;
    setSaving(true);
    try {
      const resp = await fetch('/api/quiz-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, source: 'ai' }),
      });
      if (resp.ok) {
        const d = await resp.json().catch(() => null);
        if (d && d.id) { setBankId(d.id); setSaved(true); }
        else setSaved(true);
      }
    } catch { /* ignore */ }
    setSaving(false);
  }
  // 做题统计：已收藏（有 quizId）→ 加载历史统计（次数 / 准确率 / 连对）
  useEffect(() => {
    if (!effectiveQuizId || statsLoaded) return;
    setStatsLoaded(true);
    fetch('/api/quiz/stats?quizId=' + encodeURIComponent(effectiveQuizId))
      .then(r => r.json()).then((d: any) => {
        if (d && Array.isArray(d.stats)) {
          const map: Record<number, { attempts: number; correct: number; accuracy: number; streak: number; best_streak: number }> = {};
          for (const s of d.stats) map[s.question_index] = s;
          setStatsMap(map);
        }
      }).catch(() => {});
  }, [effectiveQuizId, statsLoaded]);
  // 作答后上报统计：reveal（查看答案）时把本题结果提交给后端，并本地乐观更新显示
  async function reportAnswer(qi: number) {
    if (!effectiveQuizId) return;
    const mySel = sel[qi] || [];
    const answer = Array.isArray(data.questions[qi]?.answer) ? (data.questions[qi]!.answer as string[]) : [];
    const correct = answer.length > 0 && answer.every(a => mySel.includes(a)) && mySel.length === answer.length;
    fetch('/api/quiz/stats/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quizId: effectiveQuizId, results: [{ question_index: qi, correct }] }),
    }).catch(() => {});
    // 乐观更新：attempts+1；correct 记 1/0；streak 答对 +1、答错归零；accuracy 重算
    setStatsMap(prev => {
      const cur = prev[qi] || { attempts: 0, correct: 0, accuracy: 0, streak: 0, best_streak: 0 };
      const streak = correct ? cur.streak + 1 : 0;
      const attempts = cur.attempts + 1;
      const correctCnt = cur.correct + (correct ? 1 : 0);
      return { ...prev, [qi]: { attempts, correct: correctCnt, accuracy: Math.round((correctCnt / attempts) * 100), streak, best_streak: Math.max(cur.best_streak, streak) } };
    });
  }
  // 详细题解（做完题后可选环节）：solTexts[i] = 第 i 题详细讲解；null 表示尚未生成。
  // 优先用题目自带 solution 字段；否则调 /api/quiz/solution 让 AI 生成（结合用户作答讲错因）。
  const [solTexts, setSolTexts] = useState<(string | null)[] | null>(null);
  const [solLoading, setSolLoading] = useState(false);
  const [solError, setSolError] = useState('');
  const embeddedSolutions = data.questions.every(q => typeof q.solution === 'string' && q.solution.trim().length > 0);
  async function loadSolutions() {
    if (solLoading || solTexts) return;
    setSolLoading(true);
    setSolError('');
    try {
      if (embeddedSolutions) {
        // 内嵌题解：直接取每题的 solution 字段，零成本秒开
        setSolTexts(data.questions.map(q => (q.solution || '').trim() || null));
        return;
      }
      const resp = await fetch('/api/quiz/solution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, answers: sel }),
      });
      const d = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error((d && d.error) || `题解生成失败（${resp.status}）`);
      if (!d || !Array.isArray(d.solutions)) throw new Error('题解生成失败：返回格式异常');
      // 对齐题目数：不足则补空，多余截断
      const list: (string | null)[] = data.questions.map((_, i) => (typeof d.solutions[i] === 'string' && d.solutions[i].trim() ? d.solutions[i] : null));
      setSolTexts(list);
    } catch (err: any) {
      setSolError(err.message || '题解生成失败');
    } finally {
      setSolLoading(false);
    }
  }
  // 已作答（至少一题点了选项）即可解锁详细题解入口
  const hasAnswered = Object.keys(sel).some(k => (sel[Number(k)] || []).length > 0);
  // 全部题目都已作答 → 解锁「一键分析」入口
  const allAnswered = data.questions.length > 0 && data.questions.every((_, i) => (sel[i] || []).length > 0);
  async function loadAnalysis() {
    if (analyzing || analyze) return;
    setAnalyzing(true);
    setAnalyzeError('');
    try {
      const resp = await fetch('/api/quiz/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, answers: sel }),
      });
      const d = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error((d && d.error) || `分析失败（${resp.status}）`);
      setAnalyze({
        summary: (d && d.summary) || '',
        weak_points: (d && Array.isArray(d.weak_points)) ? d.weak_points : [],
        strong_points: (d && Array.isArray(d.strong_points)) ? d.strong_points : [],
      });
    } catch (err: any) {
      setAnalyzeError(err.message || '分析失败');
    } finally {
      setAnalyzing(false);
    }
  }
  // 基于薄弱点继续出题：fork 当前会话为子对话，并让 AI 针对薄弱点再出一组题
  async function forkQuizOnWeakPoints() {
    if (forking || !sessionId) return;
    setForking(true);
    setAnalyzeError('');
    try {
      const resp = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '薄弱点巩固 · 继续出题' }),
      });
      const d = await resp.json().catch(() => null);
      if (!resp.ok || !d || !d.id) throw new Error((d && d.error) || '派生子对话失败');
      // 在子对话中发消息：让 AI 针对薄弱点再出 4 道题（强制注入 quiz-generator 技能）
      const weakTxt = (analyze && analyze.weak_points && analyze.weak_points.length > 0)
        ? analyze.weak_points.map((w: any, i: number) => `${i + 1}. ${w.topic || ''}${w.reason ? '（' + w.reason + '）' : ''}`).join('\n')
        : '本次作答暴露出的薄弱知识点';
      const text = `请针对我以下知识薄弱点，再出 4 道选择题（含正确答案与解析），严格使用 [QUIZ] JSON 格式输出，不要输出多余文字。\n薄弱点：\n${weakTxt}`;
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, sessionId: d.id, skillNames: ['quiz-generator'] }),
      }).catch(() => { /* 子对话出题由网关异步执行，失败不阻断打开子对话 */ });
      onSessionCreated?.(d.id);
    } catch (err: any) {
      setAnalyzeError(err.message || '继续出题失败');
    } finally {
      setForking(false);
    }
  }
  return (
    <div style={{ border: '1px solid ' + C.hair, background: C.glass, borderRadius: 12, padding: '10px 12px', margin: '0 0 10px', fontSize: 13, boxShadow: '0 1px 6px rgba(0,0,0,.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 8 }}>
        <Check size={12} color={C.accent} /> {data.title || '选择题'}
        {streaming && <span style={{ display: 'inline-block', width: 7, height: 14, marginLeft: 4, background: C.accent, animation: 'qcCaret 1s step-end infinite' }} />}
        <span style={{ flex: 1 }} />
        {/* 收藏到题库：把 AI 出的这套题存入题库，供反复练习 */}
        <button
          onClick={saveToBank}
          disabled={saving || saved || streaming}
          title={saved ? '已收藏到题库' : '收藏到题库（可反复练习）'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '3px 10px', borderRadius: 7, border: 'none',
            background: saved ? 'rgba(52,199,89,.14)' : 'rgba(99,102,241,.12)',
            color: saved ? '#1a7f37' : C.accent,
            cursor: saving || saved || streaming ? 'default' : 'pointer',
            fontSize: 11, fontWeight: 600, opacity: streaming ? 0.5 : 1,
          }}>
          {saved ? '✓ 已收藏' : saving ? '保存中…' : '☆ 收藏到题库'}
        </button>
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
            {effectiveQuizId && statsMap[qi] && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.muted, marginBottom: 6, flexWrap: 'wrap' }}>
                <span>📊 已做 <strong style={{ color: C.text }}>{statsMap[qi].attempts}</strong> 次</span>
                <span>· 正确率 <strong style={{ color: statsMap[qi].accuracy >= 80 ? C.green : statsMap[qi].accuracy >= 50 ? C.accent : C.red }}>{statsMap[qi].accuracy}%</strong></span>
                {statsMap[qi].streak >= 2 && (
                  <span style={{ color: C.red, fontWeight: 700, animation: 'qcStreak 0.6s ease' }}>🔥 连对 {statsMap[qi].streak}</span>
                )}
              </div>
            )}
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
                    onMouseEnter={e => { if (!isRevealed && !picked) { e.currentTarget.style.background = 'rgba(99,102,241,.06)'; } }}
                    onMouseLeave={e => { if (!isRevealed && !picked) { e.currentTarget.style.background = 'transparent'; } }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, border: '1px solid ' + (picked || (isRevealed && answer.includes(k)) ? 'currentColor' : C.hair), background: picked ? 'rgba(99,102,241,.08)' : 'transparent', color: optColor, cursor: isRevealed ? 'default' : 'pointer', fontSize: 12.5, textAlign: 'left', transition: 'background .1s' }}>
                    <span style={{ fontWeight: 700, flexShrink: 0 }}>{k}.</span>
                    <span style={{ flex: 1 }}>{v}</span>
                    {isRevealed && answer.includes(k) && <Check />}
                    {isRevealed && picked && !answer.includes(k) && <Cross />}
                  </button>
                );
              })}
            </div>
            {!isRevealed ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => { setReveal(prev => ({ ...prev, [qi]: true })); reportAnswer(qi); }}
                  style={{ marginTop: 6, padding: '5px 14px', borderRadius: 8, border: 'none', background: C.accent, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  查看答案
                </button>
                <button onClick={() => solveOne(qi)} disabled={oneSolLoading !== null}
                  title="调 AI 详细解析本题（在新子对话中继续追问）"
                  style={{
                    marginTop: 6, padding: '5px 12px', borderRadius: 8, border: '1px solid ' + C.accent,
                    background: 'transparent', color: C.accent, cursor: oneSolLoading !== null ? 'default' : 'pointer',
                    fontSize: 12, fontWeight: 600, opacity: oneSolLoading !== null ? 0.6 : 1,
                  }}>
                  {oneSolLoading === qi ? '⏳ 解析中…' : '🔍 一键解析'}
                </button>
              </div>
            ) : (
              <div style={{
                marginTop: 6, padding: '7px 10px', borderRadius: 8,
                background: correct ? 'rgba(52,199,89,.1)' : C.seg,
                border: '1px solid ' + (correct ? 'rgba(52,199,89,.5)' : wrong ? 'rgba(239,68,68,.4)' : C.hair),
                fontSize: 12, color: correct ? '#1a7f37' : wrong ? C.red : C.text,
                animation: correct ? 'qcCorrect .5s ease' : wrong ? 'qcWrong .5s ease' : undefined,
              }}>
                <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
                  {correct ? '✅ 回答正确' : wrong ? '❌ 回答错误' : ''}
                  {correct && effectiveQuizId && (statsMap[qi]?.streak || 0) >= 2 && (
                    <span style={{ color: C.red, animation: 'qcStreak .6s ease' }}>🔥 连对 {statsMap[qi]!.streak} 次</span>
                  )}
                </div>
                {answer.length > 0 && <div style={{ marginTop: 3 }}>正确答案：<strong>{answer.join('、')}</strong></div>}
                {q.explanation && <div style={{ marginTop: 3, color: C.muted }}>解析：{q.explanation}</div>}
                {!oneSol[qi] && (
                  <button onClick={() => solveOne(qi)} disabled={oneSolLoading !== null}
                    style={{
                      marginTop: 6, padding: '4px 10px', borderRadius: 7, border: '1px solid ' + C.accent,
                      background: 'transparent', color: C.accent, cursor: oneSolLoading !== null ? 'default' : 'pointer',
                      fontSize: 11.5, fontWeight: 600, opacity: oneSolLoading !== null ? 0.6 : 1,
                    }}>
                    {oneSolLoading === qi ? '⏳ 生成详细解析…' : '🔍 一键解析（新子对话）'}
                  </button>
                )}
              </div>
            )}
            {oneSol[qi] && (
              <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(99,102,241,.05)', border: '1px solid ' + C.hair, fontSize: 12, color: C.text, lineHeight: 1.75, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                <div style={{ fontWeight: 700, color: C.accent, marginBottom: 4, fontSize: 11.5 }}>📖 本题详细解析</div>
                {oneSol[qi]}
              </div>
            )}
          </div>
        );
      })}
      {/* 详细题解（做完题后可选环节）：已作答即解锁入口；点击后逐题展开详细讲解 */}
      {hasAnswered && !streaming && (
        <div style={{ marginTop: 4 }}>
          {!solTexts ? (
            <button onClick={loadSolutions} disabled={solLoading}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                marginTop: 6, padding: '6px 14px', borderRadius: 8, border: '1px solid ' + C.accent,
                background: 'transparent', color: C.accent, cursor: solLoading ? 'default' : 'pointer',
                fontSize: 12, fontWeight: 600, opacity: solLoading ? 0.6 : 1,
              }}>
              {solLoading ? '⏳ 正在生成详细题解…' : '📖 查看详细题解'}
            </button>
          ) : (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid ' + C.hair }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: C.accent, marginBottom: 6 }}>
                <span>📖 详细题解</span>
                <span style={{ flex: 1 }} />
                <button onClick={() => setSolTexts(null)} title="收起题解"
                  style={{ border: 'none', background: 'transparent', color: C.muted, cursor: 'pointer', fontSize: 11, padding: '2px 6px', borderRadius: 6 }}>
                  收起
                </button>
              </div>
              {data.questions.map((q, qi) => {
                const txt = solTexts[qi];
                if (!txt) return null;
                const mySel2 = sel[qi] || [];
                const ans2 = Array.isArray(q.answer) ? q.answer : [];
                const isRight = ans2.length > 0 && ans2.every(a => mySel2.includes(a)) && mySel2.length === ans2.length;
                const isRevealed2 = !!reveal[qi];
                return (
                  <div key={qi} style={{ marginBottom: 12, paddingBottom: 8, borderBottom: qi < data.questions.length - 1 ? '1px solid ' + C.hair : 'none' }}>
                    <div style={{ fontWeight: 600, marginBottom: 4, color: C.text, fontSize: 12.5 }}>
                      {qi + 1}. {q.question}
                      {isRevealed2 && <span style={{ color: isRight ? C.green : C.red, marginLeft: 6 }}>{isRight ? '✅ 答对' : '❌ 答错'}</span>}
                    </div>
                    <div style={{ fontSize: 12, color: C.text, lineHeight: 1.75, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{txt}</div>
                  </div>
                );
              })}
            </div>
          )}
          {solError && <div style={{ marginTop: 6, fontSize: 12, color: C.red }}>{solError}</div>}
        </div>
      )}
      {/* 一键分析（做完所有题后可选环节）：诊断知识薄弱点 → 报告 → 薄弱点继续出题 */}
      {allAnswered && !streaming && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid ' + C.hair }}>
          {!analyze ? (
            <button onClick={loadAnalysis} disabled={analyzing}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                marginTop: 4, padding: '6px 14px', borderRadius: 8, border: 'none',
                background: C.accent, color: '#fff', cursor: analyzing ? 'default' : 'pointer',
                fontSize: 12, fontWeight: 600, opacity: analyzing ? 0.6 : 1,
              }}>
              {analyzing ? '⏳ 正在分析知识薄弱点…' : '🔍 一键分析：诊断知识薄弱点'}
            </button>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: C.accent, marginBottom: 6 }}>
                <span>📊 学习分析报告</span>
                <span style={{ flex: 1 }} />
                <button onClick={() => setAnalyze(null)} title="收起分析"
                  style={{ border: 'none', background: 'transparent', color: C.muted, cursor: 'pointer', fontSize: 11, padding: '2px 6px', borderRadius: 6 }}>
                  收起
                </button>
              </div>
              {analyze.summary && <div style={{ fontSize: 12, color: C.text, lineHeight: 1.7, marginBottom: 8 }}>{analyze.summary}</div>}
              {analyze.weak_points.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: C.red, marginBottom: 4 }}>⚠️ 知识薄弱点</div>
                  {analyze.weak_points.map((w: any, i: number) => (
                    <div key={i} style={{ fontSize: 12, color: C.text, lineHeight: 1.6, padding: '4px 0', borderBottom: i < analyze.weak_points.length - 1 ? '1px solid ' + C.hair : 'none' }}>
                      <strong>{w.topic || '薄弱点'}</strong>
                      {Array.isArray(w.question_indexes) && w.question_indexes.length > 0 && (
                        <span style={{ color: C.muted, marginLeft: 6 }}>（题 {w.question_indexes.join('、')}）</span>
                      )}
                      {w.reason && <div style={{ color: C.muted, marginTop: 2 }}>原因：{w.reason}</div>}
                      {w.suggestion && <div style={{ marginTop: 2 }}>建议：{w.suggestion}</div>}
                    </div>
                  ))}
                </div>
              )}
              {analyze.strong_points.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: C.green, marginBottom: 4 }}>✅ 掌握较好</div>
                  <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>{analyze.strong_points.join('、')}</div>
                </div>
              )}
              {sessionId ? (
                <button onClick={forkQuizOnWeakPoints} disabled={forking}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    marginTop: 4, padding: '6px 14px', borderRadius: 8, border: '1px solid ' + C.accent,
                    background: 'transparent', color: C.accent, cursor: forking ? 'default' : 'pointer',
                    fontSize: 12, fontWeight: 600, opacity: forking ? 0.6 : 1,
                  }}>
                  {forking ? '⏳ 正在派生巩固练习…' : '🎯 针对薄弱点继续出题（新子对话）'}
                </button>
              ) : (
                <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>在对话中做题后可针对薄弱点继续出题（派生子对话）</div>
              )}
            </div>
          )}
          {analyzeError && <div style={{ marginTop: 6, fontSize: 12, color: C.red }}>{analyzeError}</div>}
        </div>
      )}
    </div>
  );
}
