import { useEffect, useState } from 'react';
import { IconCaret, IconCheck, IconCross, IconFile, IconGlobe, IconSearch, IconStop, IconTool } from './chatIcons';
import { FoldText } from './TaskComponents';

// ─── ChatGPT 式流式工具调用卡片（过程式）─────────────────────────────
// 每个工具调用独立一行卡片，随 SSE step 事件实时出现（mcToolIn 滑入动画）。
// 关键：过程可见——运行中展示「具体在干什么」（解析 args 为友好动作行，
// 多个关键词/URL 逐项打勾 + 进度条），done 带完整结果（展开可看全文），
// 不再只是动画点装饰。
// args 兼容两种形态：原生工具 JSON 字符串（{"queries":[...]} / {"path":"..."}）
// 与文本标记路径的纯字符串数组（关键词 / URL / path）。

function parseArgs(s: any): { label: string; items: string[] } | null {
  const raw = Array.isArray(s.args) && s.args.length > 0 ? s.args[0] : '';
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        const obj = JSON.parse(t);
        if (Array.isArray(obj.queries)) return { label: '搜索', items: obj.queries.map(String) };
        if (Array.isArray(obj.urls)) return { label: '抓取', items: obj.urls.map(String) };
        if (obj.path) return { label: '文件', items: [String(obj.path)] };
        if (obj.pattern) return { label: '搜索', items: [String(obj.pattern)] };
        if (Array.isArray(obj)) return { label: '参数', items: obj.map(String) };
      } catch { /* 非合法 JSON，原样 */ }
    }
    return { label: s.tool === 'search' ? '搜索' : s.tool === 'fetch' ? '抓取' : '文件', items: [raw] };
  }
  const items = (Array.isArray(s.args) ? s.args : []).map(String).filter(Boolean);
  if (items.length === 0) return null;
  const label = s.tool === 'search' ? '搜索' : s.tool === 'fetch' ? '抓取' : '文件';
  return { label, items };
}

function fmtArg(a: any): string {
  if (typeof a !== 'string') return JSON.stringify(a, null, 2);
  const t = a.trim();
  if ((t.startsWith('{') || t.startsWith('[')) && (t.endsWith('}') || t.endsWith(']'))) {
    try { return JSON.stringify(JSON.parse(t), null, 2); } catch { /* 非合法 JSON，原样 */ }
  }
  return a;
}
function stepDur(s: any): string {
  if (!s.endedAt || !s.startedAt) return '';
  const d = Math.max(0, s.endedAt - s.startedAt);
  return d >= 1000 ? (d / 1000).toFixed(1) + 's' : d + 'ms';
}

// 运行中状态：动画点 + 实时已用时（每秒跳动）
function RunningStatus({ startedAt }: { startedAt?: number }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setSecs(Math.max(0, Math.floor((Date.now() - (startedAt || Date.now())) / 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--mc-muted)', fontSize: 11.5, flexShrink: 0 }}>
      <span className="mc-dots"><i /><i /><i /></span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{secs}s</span>
    </span>
  );
}

export function ToolCallStream({ steps }: { steps: any[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  if (!steps || steps.length === 0) return null;
  const running = steps.some((s: any) => s.status === 'running');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '0 0 10px' }}>
      {running && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--mc-muted)', fontWeight: 600, padding: '0 2px' }}>
          <IconTool />
          正在调用工具
          <span className="mc-dots"><i /><i /><i /></span>
        </div>
      )}
      {steps.map((s: any) => (
        <ToolStepCard key={s.stepId} s={s} open={open.has(s.stepId)} onToggle={() => toggle(s.stepId)} />
      ))}
    </div>
  );
}

function ToolStepCard({ s, open, onToggle }: { s: any; open: boolean; onToggle: () => void }) {
  const running = s.status === 'running';
  const accent = s.status === 'error' ? 'var(--mc-danger)' : s.status === 'done' ? '#34C759' : s.status === 'stopped' ? 'var(--mc-pin)' : 'var(--mc-accent)';
  const Icon = s.tool === 'fetch' ? IconGlobe : s.tool === 'fs' ? IconFile : IconSearch;
  const parsed = parseArgs(s);
  const prog = s.progress as { done: number; total: number; item: string; ok: boolean; summary: string } | undefined;
  const pct = prog && prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0;
  const dur = stepDur(s);
  return (
    <div className="mc-toolstep" style={{ border: '1px solid var(--mc-hair)', background: 'var(--mc-glass)', borderRadius: 10, overflow: 'hidden', animation: 'mcToolIn .25s ease both' }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 11px', cursor: 'pointer' }}>
        <span style={{ width: 22, height: 22, borderRadius: 7, background: running ? 'var(--mc-accent-soft)' : 'var(--mc-seg)', color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon />
        </span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500, color: 'var(--mc-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
        {running ? <RunningStatus startedAt={s.startedAt} /> : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            {s.status === 'done' && (
              <><span style={{ color: '#34C759', display: 'inline-flex' }}><IconCheck /></span><span style={{ color: 'var(--mc-muted2)', fontSize: 10.5, fontVariantNumeric: 'tabular-nums' }}>{dur}</span></>
            )}
            {s.status === 'stopped' && (
              <><span style={{ color: 'var(--mc-pin)', display: 'inline-flex' }}><IconStop /></span><span style={{ color: 'var(--mc-muted2)', fontSize: 10.5 }}>{dur}</span></>
            )}
            {s.status === 'error' && (
              <><span style={{ color: 'var(--mc-danger)', display: 'inline-flex' }}><IconCross /></span><span style={{ color: 'var(--mc-muted2)', fontSize: 10.5 }}>{dur}</span></>
            )}
            <span style={{ color: 'var(--mc-muted2)', display: 'inline-flex', transform: open ? 'rotate(-90deg)' : 'none', transition: 'transform .15s' }}><IconCaret /></span>
          </span>
        )}
      </div>
      {/* 过程明细：运行中逐项打勾 + 进度条；完成后单行摘要 */}
      {parsed && (
        <div style={{ padding: '0 11px 9px 42px', fontSize: 11, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {running ? (
            <>
              {parsed.items.map((it, i) => {
                const isDone = prog ? i < prog.done : i === 0;
                const isCurrent = prog ? i === prog.done : i === 0;
                return (
                  <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, color: isDone ? 'var(--mc-muted)' : isCurrent ? 'var(--mc-text)' : 'var(--mc-muted2)' }}>
                    {isDone ? (
                      <span style={{ color: '#34C759', display: 'inline-flex', flexShrink: 0 }}><IconCheck /></span>
                    ) : isCurrent ? (
                      <span className="mc-dots" style={{ flexShrink: 0 }}><i /><i /><i /></span>
                    ) : (
                      <span style={{ color: 'var(--mc-muted2)', flexShrink: 0 }}>·</span>
                    )}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it}</span>
                    {isDone && prog && prog.item === it && prog.summary && (
                      <span style={{ color: 'var(--mc-muted2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1 }}>{prog.summary}</span>
                    )}
                  </span>
                );
              })}
              {prog && parsed.items.length > 1 && (
                <div style={{ height: 3, borderRadius: 2, background: 'var(--mc-seg)', overflow: 'hidden', marginTop: 2 }}>
                  <div style={{ height: '100%', width: pct + '%', background: 'var(--mc-accent)', borderRadius: 2, transition: 'width .3s' }} />
                </div>
              )}
            </>
          ) : (
            <div style={{ color: 'var(--mc-muted2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ color: accent, fontWeight: 600 }}>{parsed.label}：</span>{parsed.items.join('、')}
            </div>
          )}
        </div>
      )}
      {open && (
        <div className="mc-rot-in" style={{ margin: '0 10px 9px 42px', padding: '6px 8px', background: 'var(--mc-seg)', border: '1px solid var(--mc-hair)', borderRadius: 8, fontSize: 11, lineHeight: 1.5 }}>
          {Array.isArray(s.args) && s.args.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ color: 'var(--mc-muted2)', marginBottom: 2 }}>参数</div>
              {s.args.map((a: any, i: number) => (
                <pre key={i} style={{ margin: '2px 0', padding: '5px 7px', background: 'var(--mc-glass)', border: '1px solid var(--mc-hair)', borderRadius: 6, color: 'var(--mc-text)', fontFamily: 'ui-monospace,monospace', fontSize: 10.5, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 220, overflowY: 'auto' }}>{fmtArg(a)}</pre>
              ))}
            </div>
          )}
          {s.result && (
            <div>
              <div style={{ color: 'var(--mc-muted2)', marginBottom: 2 }}>结果</div>
              <FoldText text={String(s.result)} />
            </div>
          )}
          {s.error && <div style={{ color: 'var(--mc-danger)' }}>{s.error}</div>}
        </div>
      )}
    </div>
  );
}
