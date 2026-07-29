import { useEffect, useState, useRef } from 'react';

const LEVELS = [
  { name: '极简', temp: 0.30, tokens: 512 },
  { name: '简洁', temp: 0.50, tokens: 1024 },
  { name: '均衡', temp: 0.70, tokens: 2048 },
  { name: '深入', temp: 0.40, tokens: 4096 },
  { name: '深度', temp: 0.25, tokens: 8192 },
];

export default function ChatPage() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [sid, setSid] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasProvider, setHasProvider] = useState<boolean | null>(null);
  const [searchOn, setSearchOn] = useState(false);
  const [thinkLevel, setThinkLevel] = useState(() => {
    const saved = localStorage.getItem('thinkLevel');
    return saved !== null ? Math.max(0, Math.min(4, parseInt(saved, 10))) : 2;
  });
  const [thinkTemp, setThinkTemp] = useState(() => LEVELS[(() => {
    const saved = localStorage.getItem('thinkLevel');
    return saved !== null ? Math.max(0, Math.min(4, parseInt(saved, 10))) : 2;
  })()].temp);
  const [showThink, setShowThink] = useState(false);
  const [thinkDragging, setThinkDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 稳定 clientId：挂载即建立带 sessionId 的 SSE，首轮用它作为新会话 id（修复 P1-1/P1-2）
  const clientIdRef = useRef<string>('');
  if (!clientIdRef.current) {
    clientIdRef.current =
      (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  }
  const streamKey = sid || clientIdRef.current;

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  // 检查是否有配置 + 加载搜索设置
  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(d => {
      setHasProvider(d.hasProviders);
      if (d.hasProviders) {
        fetch('/api/sessions').then(r => r.json()).then(list => {
          setSessions(list);
          if (list.length > 0) loadSession(list[0].id);
        });
      }
    });
    fetch('/api/search-config').then(r => r.json()).then(cfg => {
      if (cfg && cfg.enabled) setSearchOn(true);
    }).catch(() => {});
  }, []);

  // SSE（按 sessionId 过滤避免串台；streamKey 变化即重连）
  useEffect(() => {
    const es = new EventSource(`/api/stream?sessionId=${encodeURIComponent(streamKey)}`);
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

  function loadSession(id: string) {
    setSid(id);
    setBusy(false);
    fetch(`/api/sessions/${id}`).then(r => r.json()).then(data => {
      if (data?.messages) setMsgs(data.messages.map((m: any) => ({ role: m.role, content: m.content })));
    });
  }

  async function handleSend() {
    if (!input.trim() || busy) return;
    const text = input;
    setInput('');
    setMsgs(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    setBusy(true);

    try {
      const res = await (await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, sessionId: sid || undefined, temperature: thinkTemp }),
      })).json();

      if (res.sessionId) {
        setSid(res.sessionId);
        fetch('/api/sessions').then(r => r.json()).then(setSessions);
      }
      if (res.error) {
        setMsgs(prev => { const c = prev.slice(); if (c.length > 0) c[c.length - 1].content = res.error; return c; });
        setBusy(false);
      }
    } catch (err: any) {
      setMsgs(prev => { const c = prev.slice(); if (c.length > 0) c[c.length - 1].content = `请求失败: ${err.message}`; return c; });
      setBusy(false);
    }
  }

  function setLevel(v: number) {
    const l = Math.max(0, Math.min(4, Math.round(v)));
    setThinkLevel(l);
    setThinkTemp(LEVELS[l].temp);
    localStorage.setItem('thinkLevel', String(l));
  }

  // 未配置时显示引导
  if (hasProvider === false) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 16, color: '#666' }}>请先在设置页添加 API 服务商</div>
        <div style={{ fontSize: 13, color: '#999' }}>点击上方「设置」标签，填写 OpenAI 或 Anthropic 的 API Key</div>
      </div>
    );
  }

  if (hasProvider === null) {
    return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 14 }}>加载中...</div>;
  }

  return (
    <div style={{ height: '100%', display: 'flex' }}>
      <div style={{ width: 180, borderRight: '1px solid #e0e0e0', background: '#fafafa', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 10, borderBottom: '1px solid #e0e0e0' }}>
          <button onClick={() => { setSid(null); setMsgs([]); setBusy(false); }}
            style={{ width: '100%', padding: 6, background: '#007aff', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>+ 新对话</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {sessions.map(s => (
            <div key={s.id} onClick={() => loadSession(s.id)}
              style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #eee', background: s.id === sid ? '#e8f0fe' : '' }}>
              {s.title || '新对话'}
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, background: '#fff' }}>
          {msgs.length === 0 && <div style={{ textAlign: 'center', color: '#999', marginTop: 80, fontSize: 14 }}>开始新对话</div>}
          {msgs.map((m, i) => (
            <div key={i} style={{ marginBottom: 10, textAlign: m.role === 'user' ? 'right' : 'left' }}>
              <div style={{ display: 'inline-block', padding: '8px 14px', borderRadius: 12, background: m.role === 'user' ? '#007aff' : '#e8e8e8', color: m.role === 'user' ? '#fff' : '#000', maxWidth: '80%', whiteSpace: 'pre-wrap' }}>
                {m.content || (m.role === 'assistant' && busy ? '...' : '')}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div style={{ padding: '8px 10px', borderTop: '1px solid #e0e0e0', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 4 }}>
            {/* 联网搜索 */}
            <button onClick={() => {
              const next = !searchOn;
              setSearchOn(next);
              fetch('/api/search-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: next, provider: 'duckduckgo' }) }).catch(() => {});
            }}
              style={{ padding: '4px 12px', borderRadius: 20, border: 'none', fontSize: 12, cursor: 'pointer', background: searchOn ? '#007aff' : '#f0f0f0', color: searchOn ? '#fff' : '#888', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>🌐</span>
              <span>联网搜索</span>
            </button>
            {/* 思考强度 */}
            <button onClick={() => setShowThink(!showThink)}
              style={{ padding: '4px 12px', borderRadius: 20, border: 'none', fontSize: 12, cursor: 'pointer', background: showThink ? '#e8f0fe' : '#f0f0f0', color: '#555', display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
              <span>{LEVELS[thinkLevel].name}</span>
            </button>
          </div>
          {/* 思考强度滑块（展开） */}
          {showThink && (
            <div style={{ padding: '8px 12px 6px', background: '#f8f9fb', borderRadius: 8, userSelect: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 11, color: '#999', minWidth: 36, textAlign: 'right' }}>{LEVELS[thinkLevel].name}</div>
                <div ref={trackRef}
                  onMouseDown={(e) => {
                    setThinkDragging(true);
                    const rect = trackRef.current!.getBoundingClientRect();
                    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    setLevel(pct * 4);
                  }}
                  style={{ flex: 1, height: 16, display: 'flex', alignItems: 'center', cursor: 'pointer', position: 'relative' }}>
                  <div style={{ width: '100%', height: 3, background: '#e5e7eb', borderRadius: 2, position: 'relative' }}>
                    <div style={{ width: `${(thinkLevel / 4) * 100}%`, height: '100%', borderRadius: 2, background: 'linear-gradient(90deg, #dbeafe, #3b82f6, #1e40af)', transition: thinkDragging ? 'none' : 'width 0.2s' }} />
                  </div>
                  <div style={{ position: 'absolute', left: `calc(${(thinkLevel / 4) * 100}% - 6px)`, top: '50%', width: 12, height: 12, background: '#fff', border: '2px solid #3b82f6', borderRadius: '50%', transform: 'translateY(-50%)', boxShadow: thinkDragging ? '0 0 0 4px rgba(59,130,246,0.12)' : '0 1px 3px rgba(59,130,246,0.2)', transition: thinkDragging ? 'none' : 'left 0.2s', zIndex: 2 }} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0 0', marginLeft: 44 }}>
                {LEVELS.map((l, i) => (
                  <span key={i} onClick={() => setLevel(i)}
                    style={{ fontSize: 9, color: i === thinkLevel ? '#3b82f6' : '#bbb', cursor: 'pointer', fontWeight: i === thinkLevel ? 600 : 400, padding: '1px 0' }}>
                    {l.name}
                  </span>
                ))}
              </div>
              {/* 鼠标拖拽事件（全局） */}
              {thinkDragging && (
                <div
                  onMouseMove={(e) => {
                    if (!trackRef.current) return;
                    const rect = trackRef.current.getBoundingClientRect();
                    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    setLevel(pct * 4);
                  }}
                  onMouseUp={() => setThinkDragging(false)}
                  onMouseLeave={() => setThinkDragging(false)}
                  style={{ position: 'fixed', inset: 0, zIndex: 999, cursor: 'grabbing' }} />
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
              placeholder="输入消息..." disabled={busy}
              style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #ccc', fontSize: 14 }} />
            <button onClick={handleSend} disabled={busy || !input.trim()}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: busy ? '#ccc' : '#007aff', color: '#fff', cursor: busy ? 'not-allowed' : 'pointer' }}>发送</button>
          </div>
        </div>
      </div>
    </div>
  );
}
