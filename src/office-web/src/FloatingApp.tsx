import { useState, useRef, useEffect, useCallback } from 'react';

export default function FloatingApp() {
  const [expanded, setExpanded] = useState(false);
  const [msgs, setMsgs] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pos, setPos] = useState({ x: window.innerWidth - 80, y: Math.floor(window.innerHeight / 2) });
  const [sid, setSid] = useState<string | null>(null);
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
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.done) { setBusy(false); return; }
        if (d.content) {
          setMsgs(prev => {
            const copy = prev.slice();
            const last = copy[copy.length - 1];
            if (last?.role === 'assistant') last.content += d.content;
            return copy;
          });
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [streamKey]);

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

  async function handleSend() {
    if (!input.trim() || busy) return;
    const text = input;
    setInput('');
    setMsgs(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    setBusy(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, source: 'floating', sessionId: sid || undefined }),
      });
      const data = await res.json();
      if (data.sessionId) setSid(data.sessionId);
      if (data.error) {
        setMsgs(prev => { const c = prev.slice(); if (c.length > 0) c[c.length - 1].content = data.error; return c; });
        setBusy(false);
      }
    } catch (err: any) {
      setMsgs(prev => { const c = prev.slice(); if (c.length > 0) c[c.length - 1].content = `错误: ${err.message}`; return c; });
      setBusy(false);
    }
  }

  if (!expanded) {
    return (
      <div onMouseDown={onMouseDown}
        style={{ position: 'fixed', left: pos.x, top: pos.y, width: 48, height: 48, borderRadius: '50%', background: 'linear-gradient(135deg, #007aff, #00c6ff)', cursor: 'grab', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 12px rgba(0,0,0,0.3)', zIndex: 9999, userSelect: 'none' }}
        onClick={() => { if (!dragging) setExpanded(true); }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', left: Math.min(pos.x, window.innerWidth - 380), top: Math.min(pos.y, window.innerHeight - 520), width: 360, height: 500, background: '#fff', borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 9999 }}>
      <div onMouseDown={onMouseDown} style={{ padding: '10px 16px', background: '#007aff', color: '#fff', cursor: 'grab', display: 'flex', justifyContent: 'space-between', alignItems: 'center', userSelect: 'none' }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>MiniClaw</span>
        <button onClick={() => setExpanded(false)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 18 }}>_</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, background: '#f5f5f5' }}>
        {msgs.length === 0 && <p style={{ color: '#aaa', textAlign: 'center', marginTop: 60, fontSize: 13 }}>输入消息开始对话</p>}
        {msgs.map((m, i) => (
          <div key={i} style={{ marginBottom: 8, textAlign: m.role === 'user' ? 'right' : 'left' }}>
            <div style={{ display: 'inline-block', padding: '6px 12px', borderRadius: 10, fontSize: 13, background: m.role === 'user' ? '#007aff' : '#e8e8e8', color: m.role === 'user' ? '#fff' : '#000', maxWidth: '85%', whiteSpace: 'pre-wrap' }}>
              {m.content || (m.role === 'assistant' && busy ? '...' : '')}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding: 8, borderTop: '1px solid #e0e0e0', display: 'flex', gap: 6 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSend(); }} placeholder="输入..." disabled={busy}
          style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 13 }} />
        <button onClick={handleSend} disabled={busy || !input.trim()}
          style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: busy ? '#ccc' : '#007aff', color: '#fff', cursor: busy ? 'not-allowed' : 'pointer', fontSize: 12 }}>
          发送
        </button>
      </div>
    </div>
  );
}
