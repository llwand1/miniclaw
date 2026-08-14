// AdviceRequestCard —— AI 建议请求卡片（强交互：出题/讲解后 AI 主动请求给建议）。
//
// 触发场景：
//  1) AI 出一组题（QuizCard 渲染完成）后；
//  2) AI 讲解（详细题解 / 单题解析）展示后。
// 交互流程：
//  - 卡片展示「AI 想给你一些学习建议」→ 用户点「好的，给我建议」；
//  - 组件 fork 当前会话为子对话（POST /api/sessions/:id/fork），
//    在子对话中发消息让 AI 给出：学习建议 + 学习资料链接 + 视频链接；
//  - 通过 onSessionCreated 通知父组件刷新会话树并打开子对话，用户可继续追问。
// 无 sessionId（如题库页独立练习）时不 fork，仅展示静态提示。
// 样式统一用固定色值（与 QuizCard 同风格），保证两个窗口渲染一致。
import { useState } from 'react';

const C = {
  accent: '#00B96B',
  muted: '#8a8f9c',
  hair: 'rgba(0,0,0,.08)',
  glass: 'rgba(255,255,255,.7)',
};

export function AdviceRequestCard({ sessionId, onSessionCreated, contextTitle, contextBody, streaming }: {
  /** 当前会话 id（对话页传入）；为空时降级为静态提示 */
  sessionId?: string | null;
  /** fork 出子会话后的回调（父组件负责刷新会话树并打开子会话） */
  onSessionCreated?: (childId: string) => void;
  /** 建议上下文标题（如题目组标题 / 「本次讲解」） */
  contextTitle?: string;
  /** 建议上下文正文（题目组 JSON / 讲解文本），发给 AI 作为依据 */
  contextBody?: string;
  /** 流式期间不展示（等出题/讲解生成完毕再请求） */
  streaming?: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [forking, setForking] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  if (streaming || dismissed) return null;

  // 用户许可 → fork 子会话 → 子对话中请求 AI 给建议（含学习资料与视频链接）
  async function acceptAdvice() {
    if (forking || !sessionId || done) return;
    setForking(true);
    setError('');
    try {
      const resp = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'AI 学习建议' }),
      });
      const d = await resp.json().catch(() => null);
      if (!resp.ok || !d || !d.id) throw new Error((d && d.error) || '派生子对话失败');
      // 在子对话中发消息：让 AI 给出学习建议 + 资料链接 + 视频链接（网关异步执行，失败不阻断打开子对话）
      const titleLine = contextTitle ? `主题：${contextTitle}\n` : '';
      const bodyLine = contextBody ? `相关上下文：\n${contextBody.slice(0, 8000)}\n` : '';
      const text = `请针对我本次的学习情况，给我一些学习建议。要求：\n` +
        `1. 简短评价我本次练习/讲解中暴露出的掌握情况；\n` +
        `2. 给出 2-4 条具体、可执行的学习建议（分点列出）；\n` +
        `3. 推荐相关的学习资料与链接（文章/文档/网站），并尽量给出可直接访问的 URL；\n` +
        `4. 推荐 1-2 个学习视频链接（B站/公开课等，给出可直接访问的 URL，若不确定链接则给出搜索关键词）。\n` +
        `5. 语气鼓励、结构清晰，用 Markdown 组织。\n\n` +
        `${titleLine}${bodyLine}`;
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, sessionId: d.id }),
      }).catch(() => { /* 子对话建议由网关异步执行，失败不阻断打开子对话 */ });
      setDone(true);
      onSessionCreated?.(d.id);
    } catch (err: any) {
      setError(err.message || '请求建议失败');
    } finally {
      setForking(false);
    }
  }

  if (done) {
    return (
      <div style={{ marginTop: 10, padding: '9px 12px', borderRadius: 10, background: 'rgba(52,199,89,.08)', border: '1px solid rgba(52,199,89,.4)', fontSize: 12, color: '#1a7f37' }}>
        💬 已为你开启「AI 学习建议」子对话，建议与学习资料、视频链接正在生成中…
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div style={{ marginTop: 10, padding: '9px 12px', borderRadius: 10, background: 'rgba(99,102,241,.05)', border: '1px solid ' + C.hair, fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
        💡 在对话页做完题 / 查看讲解后，可让 AI 给你学习建议（含学习资料与视频链接）。
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: 'rgba(99,102,241,.06)', border: '1px solid rgba(99,102,241,.35)', fontSize: 12, color: '#1f2430', lineHeight: 1.6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#4f46e5', marginBottom: 4 }}>
        💡 AI 想给你一次建议的机会
      </div>
      <div style={{ color: '#1f2430', opacity: .85 }}>
        基于{contextTitle ? `「${contextTitle}」` : '本次练习/讲解'}，我可以给你学习建议，并附上相关学习资料与视频链接。允许我开一个新对话来提供吗？
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button onClick={acceptAdvice} disabled={forking}
          style={{ padding: '5px 14px', borderRadius: 8, border: 'none', background: C.accent, color: '#fff', cursor: forking ? 'default' : 'pointer', fontSize: 12, fontWeight: 600, opacity: forking ? 0.6 : 1 }}>
          {forking ? '⏳ 正在开启建议对话…' : '✅ 好的，给我建议'}
        </button>
        <button onClick={() => setDismissed(true)}
          style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid ' + C.hair, background: 'transparent', color: C.muted, cursor: 'pointer', fontSize: 12 }}>
          暂不需要
        </button>
        {error && <span style={{ fontSize: 11.5, color: '#ef4444' }}>{error}</span>}
      </div>
    </div>
  );
}
