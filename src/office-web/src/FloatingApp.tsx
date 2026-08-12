import { useState, useRef, useEffect, useCallback } from 'react';
import MessageActions from './components/MessageActions';
import { parseQuiz, QuizCard } from './components/QuizCard';
import { IconSend, IconRefreshCw, IconX, IconAlertCircle, IconCheck, IconSearch } from './components/Icons';

// ─── 工具步骤合并（与主窗 ChatPage 同逻辑）：按 stepId upsert，running→done/error 实时累积 ───
function mergeStep(steps: any[], step: any): any[] {
  if (!step || !step.stepId) return steps || [];
  const arr = Array.isArray(steps) ? steps.slice() : [];
  const idx = arr.findIndex((s: any) => s.stepId === step.stepId);
  if (idx >= 0) arr[idx] = { ...arr[idx], ...step };
  else arr.push(step);
  return arr;
}

// ─── 阶段文案映射（WorkBuddy 风格阶段指示：思考中 → 调用工具 → 撰写回答）───
function flowPhaseLabel(p: string): string {
  switch (p) {
    case 'searching': return '联网搜索中';
    case 'fetching': return '抓取页面中';
    case 'writing': return '撰写回答中';
    case 'done': return '已完成';
    case 'error': return '出错';
    default: return '思考中';
  }
}

export default function FloatingApp() {
  const [expanded, setExpanded] = useState(false);
  const [msgs, setMsgs] = useState<{ role: string; content: string; error?: boolean }[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pos, setPos] = useState({ x: window.innerWidth - 80, y: Math.floor(window.innerHeight / 2) });
  const [sid, setSid] = useState<string | null>(null);
  const [conn, setConn] = useState<'connecting' | 'open' | 'reconnecting'>('connecting');
  const [stalled, setStalled] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // 流程展示（WorkBuddy 风格）：当前阶段 + 工具调用步骤（悬浮窗可见的实时进度）
  const [phase, setPhase] = useState<string>('thinking');
  const [steps, setSteps] = useState<any[]>([]);
  // 任务规划清单（WorkBuddy 式）：规划阶段 [TODO:...] 步骤，随步骤完成逐个打勾
  const [todos, setTodos] = useState<{ id: string; content: string }[]>([]);
  const lastTokenRef = useRef<number>(Date.now());
  const dragRef = useRef({ sx: 0, sy: 0, ox: 0, oy: 0 });
  const bottomRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);
  const msgsRef = useRef(msgs);
  msgsRef.current = msgs;
  const posRef = useRef(pos);
  posRef.current = pos;

  // 稳定 clientId：挂载即建立带 sessionId 的 SSE，首轮用它作为新会话 id（修复 P1-2）
  const clientIdRef = useRef<string>('');
  if (!clientIdRef.current) {
    clientIdRef.current =
      (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  }
  const streamKey = sid || clientIdRef.current;

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  // 还原悬浮窗位置（修复 P1-3）
  useEffect(() => {
    fetch('/api/window-state/floating').then(r => r.json()).then(d => {
      if (d && typeof d.x === 'number' && typeof d.y === 'number') {
        setPos({ x: d.x, y: d.y });
      }
    }).catch(() => {});
  }, []);

  // SSE（按 sessionId 过滤避免串台；streamKey 变化即重连）
  useEffect(() => {
    const es = new EventSource(`/api/stream?sessionId=${encodeURIComponent(streamKey)}`);
    sseRef.current = es;
    setConn('connecting');
    es.onopen = () => setConn('open');
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === 'ping' || d.type === 'artifact') return;
        // 流程展示：阶段推进（思考中→搜索→抓取→撰写→完成）
        if (d.type === 'run-state') {
          if (d.task?.phase) setPhase(d.task.phase);
          if (d.done) setPhase('done');
          if (d.error) setPhase('error');
          return;
        }
        // 流程展示：工具调用步骤（running→done/error 实时累积）
        if (d.type === 'step') { setSteps(prev => mergeStep(prev, d.step)); return; }
        // 任务规划清单：规划阶段 [TODO:...] 步骤清单，悬浮窗实时展示
        if (d.type === 'todos') {
          setTodos(Array.isArray(d.todos) ? d.todos.map((t: any) => ({ id: t.id, content: t.content })) : []);
          return;
        }
        // 失败事件：明确反馈而非一直转圈
        if (d.type === 'chat-error') {
          setPhase('error');
          setMsgs(prev => {
            const c = prev.slice();
            if (c.length && c[c.length - 1].role === 'assistant') c[c.length - 1] = { role: 'assistant', content: `请求失败：${d.error}`, error: true };
            return c;
          });
          setBusy(false); setConn('open'); setStalled(false);
          return;
        }
        // token：即使 done 也先拼接内容，避免丢最后一包
        if (d.content) {
          lastTokenRef.current = Date.now();
          setMsgs(prev => {
            const copy = prev.slice();
            const last = copy[copy.length - 1];
            if (last?.role === 'assistant') last.content += d.content;
            return copy;
          });
        }
        if (d.done) { setBusy(false); setStalled(false); }
      } catch { /* ignore */ }
    };
    es.onerror = () => setConn('reconnecting');
    return () => es.close();
  }, [streamKey]);

  // 看门狗：生成中超过 45s 无新令牌，判定连接可能已断开
  useEffect(() => {
    if (!busy) { setStalled(false); return; }
    lastTokenRef.current = Date.now();
    const t = setInterval(() => {
      if (busy && Date.now() - lastTokenRef.current > 45000) setStalled(true);
    }, 5000);
    return () => clearInterval(t);
  }, [busy]);

  // toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    setDragging(true);
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
  }, [pos]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => setPos({ x: dragRef.current.ox + (e.clientX - dragRef.current.sx), y: dragRef.current.oy + (e.clientY - dragRef.current.sy) });
    const onUp = () => {
      setDragging(false);
      // 持久化位置（修复 P1-3）
      const p = posRef.current;
      fetch('/api/window-state/floating', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: Math.round(p.x), y: Math.round(p.y) }),
      }).catch(() => {});
    };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging]);

  // 以服务端最终存储内容回填，确保流式丢包时不丢字
  async function backfill(sid: string) {
    try {
      const d = await (await fetch(`/api/sessions/${sid}`)).json();
      if (d && Array.isArray(d.messages)) setMsgs(d.messages.map((m: any) => ({ role: m.role, content: m.content })));
    } catch { /* ignore */ }
  }

  async function doSend(text: string, forceSid?: string, resend = false) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setStalled(false);
    if (!resend) {
      setInput('');
      setMsgs(prev => [...prev, { role: 'user', content: trimmed }, { role: 'assistant', content: '' }]);
    } else {
      setMsgs(prev => [...prev, { role: 'assistant', content: '' }]);
    }
    setBusy(true);
    // 新请求开始：重置流程展示（阶段回到思考中，清空上一轮步骤）
    setPhase('thinking');
    setSteps([]);
    // 新会话：客户端先生成 sessionId，使 SSE 与服务端实际 id 一致；后端还会缓冲本轮
    // 令牌，连上即回放，双保险避免首条回复串台/丢包。
    const targetSid = forceSid || sid || (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    if (!sid) setSid(targetSid);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed, source: 'floating', sessionId: targetSid, resend }),
      });
      const data = await res.json();
      if (data.sessionId) setSid(data.sessionId);
      if (data.error) {
        setMsgs(prev => { const c = prev.slice(); if (c.length > 0) c[c.length - 1] = { role: 'assistant', content: `请求失败：${data.error}`, error: true }; return c; });
        setBusy(false);
        setToast('回复失败：' + data.error);
      } else {
        await backfill(targetSid);
      }
    } catch (err: any) {
      setMsgs(prev => { const c = prev.slice(); if (c.length > 0) c[c.length - 1] = { role: 'assistant', content: `错误: ${err.message}`, error: true }; return c; });
      setBusy(false);
      setToast('连接异常：' + err.message);
    }
  }

  function handleSend() {
    doSend(input);
  }

  // 重试最后一条失败回复（复用既有用户消息，标记 resend 避免重复入库）
  function retryLast() {
    const lastUser = [...msgs].reverse().find(m => m.role === 'user');
    if (!lastUser) return;
    setMsgs(prev => {
      const c = prev.slice();
      while (c.length && c[c.length - 1].role === 'assistant' && c[c.length - 1].error) c.pop();
      return c;
    });
    doSend(lastUser.content, sid || undefined, true);
  }

  if (!expanded) {
    return (
      <div onMouseDown={onMouseDown}
        style={{ position: 'fixed', left: pos.x, top: pos.y, width: 52, height: 52, borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)', cursor: 'grab', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(99,102,241,0.4)', zIndex: 9999, userSelect: 'none', transition: 'box-shadow 0.2s' }}
        onClick={() => { if (!dragging) setExpanded(true); }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', left: Math.min(pos.x, window.innerWidth - 380), top: Math.min(pos.y, window.innerHeight - 520), width: 360, height: 500, background: 'var(--bg-surface)', borderRadius: 14, boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 9999, border: '1px solid var(--border)', transition: 'background 0.25s, border-color 0.25s' }}>
      <style>{`
        .fl-msg{position:relative;}
        .fl-actions{position:absolute;top:-11px;left:0;display:flex;align-items:center;gap:1px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:2px;box-shadow:var(--shadow);opacity:0;transition:opacity .12s;z-index:5;}
        .fl-msg:hover .fl-actions{opacity:1;}
        .fl-spin{animation:flSpin 1s linear infinite;}
        @keyframes flSpin{to{transform:rotate(360deg)}}
      `}</style>
      <div onMouseDown={onMouseDown} style={{ padding: '11px 16px', background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)', color: '#fff', cursor: 'grab', display: 'flex', justifyContent: 'space-between', alignItems: 'center', userSelect: 'none' }}>
        <span style={{ fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a7 7 0 0 0-7 7c0 2.5 1.3 4.7 3.2 6 .5.3.8.9.8 1.5V18a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-1.5c0-.6.3-1.2.8-1.5A7 7 0 0 0 19 9a7 7 0 0 0-7-7z" />
            <path d="M10 22v-4M14 22v-4" />
          </svg>
          MiniClaw
          <span title={conn === 'open' ? '已连接' : conn === 'reconnecting' ? '连接中断，正在重连…' : '连接中…'}
            style={{ width: 8, height: 8, borderRadius: '50%', background: conn === 'open' ? '#34d399' : conn === 'reconnecting' ? '#fbbf24' : 'var(--text-5)', boxShadow: conn === 'open' ? '0 0 6px rgba(52,211,153,0.5)' : 'none' }} />
        </span>
        <button onClick={() => setExpanded(false)} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', cursor: 'pointer', width: 26, height: 26, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, transition: 'background 0.12s' }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.25)'} onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}>_</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, background: 'var(--bg)', transition: 'background 0.25s' }}>
        {stalled && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', padding: '8px 12px', marginBottom: 10, borderRadius: 10, background: 'var(--danger-bg)', border: '1px solid var(--danger-bdr)', color: 'var(--danger)', fontSize: 12 }}>
            <IconAlertCircle size={15} />
            <span>响应超时，可能连接已断开。</span>
            <button onClick={retryLast} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'var(--danger)', color: '#fff', padding: '4px 12px', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'background 0.12s' }}><IconRefreshCw size={12} /> 重试</button>
          </div>
        )}
        {msgs.length === 0 && (
          <div style={{ color: 'var(--text-4)', textAlign: 'center', marginTop: 60, fontSize: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3, color: 'var(--accent)' }}>
              <path d="M12 2a7 7 0 0 0-7 7c0 2.5 1.3 4.7 3.2 6 .5.3.8.9.8 1.5V18a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-1.5c0-.6.3-1.2.8-1.5A7 7 0 0 0 19 9a7 7 0 0 0-7-7z" />
              <path d="M10 22v-4M14 22v-4" />
            </svg>
            <span>输入消息开始对话</span>
          </div>
        )}
        {msgs.map((m, i) => {
          const isAssistant = m.role === 'assistant';
          const showThinking = isAssistant && busy && i === msgs.length - 1 && !m.content && !m.error;
          // 选择题卡片：assistant 消息含完整 [QUIZ] JSON 时优先渲染卡片
          const quiz = isAssistant ? parseQuiz(m.content) : null;
          return (
            <div key={i} className="fl-msg" style={{ marginBottom: 10, textAlign: isAssistant ? 'left' : 'right' }}>
              {quiz ? (
                <QuizCard data={quiz} />
              ) : (
                <div style={{ display: 'inline-block', padding: '8px 14px', borderRadius: isAssistant ? '4px 12px 12px 12px' : '12px 4px 12px 12px', fontSize: 13, background: m.error ? 'var(--danger-bg)' : isAssistant ? 'var(--bg-surface)' : 'var(--accent)', color: m.error ? 'var(--danger)' : isAssistant ? 'var(--text)' : 'var(--accent-text)', maxWidth: '85%', whiteSpace: 'pre-wrap', border: m.error ? '1px solid var(--danger-bdr)' : isAssistant ? '1px solid var(--border)' : 'none', boxShadow: isAssistant ? 'var(--shadow-sm)' : 'none' }}>
                  {showThinking ? '...' : m.content}
                </div>
              )}
              {isAssistant && (m.content || m.error) && (
                <div className="fl-actions">
                  <MessageActions text={m.content} title="MiniClaw 回复" iconColor="#555" hoverBg="rgba(0,0,0,.06)"
                    onResult={(r) => { if (r === 'copied') setToast('已复制'); else if (r === 'shared') setToast('已分享'); else if (r === 'failed') setToast('复制失败'); }} />
                  {m.error && (
                    <button onClick={retryLast} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, border: 'none', background: 'transparent', color: '#6366f1', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '0 6px' }}><IconRefreshCw size={12} /> 重试</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {/* 任务规划清单（WorkBuddy 式）：规划阶段 [TODO:...] 步骤，随步骤完成逐个打勾 */}
        {todos.length > 0 && (
          <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-surface)', fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, color: 'var(--text-4)', fontWeight: 600, fontSize: 11 }}>
              <IconCheck size={12} /> 任务清单
              <span style={{ marginLeft: 'auto', fontWeight: 400 }}>{Math.min(steps.filter((s: any) => s.status !== 'running').length, todos.length)}/{todos.length} 完成</span>
            </div>
            {todos.map((t, i) => {
              const done = i < steps.filter((s: any) => s.status !== 'running').length;
              const running = i === steps.filter((s: any) => s.status !== 'running').length;
              const color = done ? '#34C759' : running ? 'var(--accent)' : 'var(--text-4)';
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
                  <span style={{ color, display: 'inline-flex', flexShrink: 0, width: 14, justifyContent: 'center' }}>
                    {done ? <IconCheck size={12} /> : running ? <span className="fl-spin" style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid ' + color, borderTopColor: 'transparent' }} /> : <span style={{ fontSize: 10, opacity: 0.7 }}>{i + 1}</span>}
                  </span>
                  <span style={{ flex: 1, color: done ? 'var(--text-4)' : 'var(--text)', textDecoration: done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.content}</span>
                </div>
              );
            })}
          </div>
        )}
        {/* 流程展示（WorkBuddy 风格）：阶段指示 + 工具步骤卡片，悬浮窗内实时可见 */}
        {(busy || steps.length > 0) && (
          <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-surface)', fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: steps.length > 0 ? 6 : 0 }}>
              {busy && phase !== 'done' && phase !== 'error' ? (
                <span style={{ display: 'inline-flex', color: 'var(--accent)' }}><span className="fl-spin" style={{ width: 11, height: 11, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent' }} /></span>
              ) : (
                <span style={{ display: 'inline-flex', color: phase === 'error' ? 'var(--danger)' : '#34C759' }}><IconCheck size={13} /></span>
              )}
              <span style={{ fontWeight: 600, color: phase === 'error' ? 'var(--danger)' : 'var(--text)' }}>{flowPhaseLabel(phase)}</span>
              {steps.length > 0 && (
                <span style={{ marginLeft: 'auto', color: 'var(--text-4)' }}>
                  {steps.filter((s: any) => s.status !== 'running').length}/{steps.length} 完成
                </span>
              )}
            </div>
            {steps.map((s: any) => {
              const accent = s.status === 'error' ? 'var(--danger)' : s.status === 'done' ? '#34C759' : 'var(--accent)';
              return (
                <div key={s.stepId} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
                  <span style={{ display: 'inline-flex', color: accent, flexShrink: 0 }}><IconSearch size={12} /></span>
                  <span style={{ flex: 1, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                  {s.status === 'running' && <span className="fl-spin" style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid ' + accent, borderTopColor: 'transparent', flexShrink: 0 }} />}
                  {s.status === 'done' && <span style={{ display: 'inline-flex', color: accent, flexShrink: 0 }}><IconCheck size={12} /></span>}
                  {s.status === 'error' && <span style={{ display: 'inline-flex', color: accent, flexShrink: 0 }}><IconX size={12} /></span>}
                </div>
              );
            })}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, background: 'var(--bg-surface)', transition: 'background 0.25s, border-color 0.25s' }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSend(); }} placeholder="输入消息…" disabled={busy}
          style={{ flex: 1, padding: '8px 14px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, outline: 'none', background: 'var(--bg)', color: 'var(--text)', transition: 'border-color 0.15s, background 0.25s, color 0.25s' }} />
        <button onClick={handleSend} disabled={busy || !input.trim()}
          style={{ padding: '8px 14px', borderRadius: 10, border: 'none', background: busy || !input.trim() ? 'var(--bg-muted)' : 'var(--accent)', color: busy || !input.trim() ? 'var(--text-4)' : 'var(--accent-text)', cursor: busy || !input.trim() ? 'not-allowed' : 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 5, fontWeight: 500, transition: 'all 0.15s' }}>
          <IconSend size={14} /> 发送
        </button>
      </div>
      {toast && (
        <div style={{ position: 'absolute', left: '50%', bottom: 64, transform: 'translateX(-50%)', background: 'rgba(0,0,0,.82)', color: '#fff', padding: '7px 14px', borderRadius: 10, fontSize: 12.5, zIndex: 99999, whiteSpace: 'nowrap' }}>
          {toast}
        </div>
      )}
    </div>
  );
}
