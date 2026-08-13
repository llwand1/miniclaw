import { useState } from 'react';
import { IconCaret } from './chatIcons';
import { formatAttrs } from './chatUtils';

// ─── 简易 Trace 瀑布：把一次请求的 Span 树画成时间条（失败段标红，行可点击展开详情）──
export function TraceWaterfall({ trace }: { trace: any }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  if (!trace || !Array.isArray(trace.spans) || trace.spans.length === 0) {
    return (
      <div style={{ borderBottom: '1px solid var(--mc-hair)', background: 'var(--mc-glass)', padding: '12px 16px', color: 'var(--mc-muted2)', fontSize: 12 }}>
        暂无 Trace 数据。发送一条消息后，这里会实时显示本次请求的调用瀑布（根请求 → LLM 调用 / 工具 / 流式耗时，点击任意行可展开参数与耗时，失败段标红）。
      </div>
    );
  }
  const starts = trace.spans.map((s: any) => s.startedAt);
  const ends = trace.spans.map((s: any) => s.endedAt ?? s.startedAt);
  const t0 = Math.min(trace.startedAt, ...starts);
  const t1 = Math.max(trace.endedAt ?? t0, ...ends);
  const total = Math.max(1, t1 - t0);
  const byId = new Map(trace.spans.map((s: any) => [s.spanId, s]));
  const depthOf = (s: any) => {
    let d = 0; let cur: any = s;
    while (cur && cur.parentSpanId) { const p = byId.get(cur.parentSpanId); if (!p || p === cur || d > 20) break; cur = p; d++; }
    return d;
  };
  const kindColor: Record<string, string> = { root: 'var(--mc-accent)', llm: '#BF5AF2', tool: 'var(--mc-pin)', db: '#34C759', stream: '#5AC8FA' };
  const live = !trace.endedAt;
  return (
    <div className="mc-scroll" style={{ borderBottom: '1px solid var(--mc-hair)', background: 'var(--mc-glass)', padding: '10px 14px', maxHeight: 240, overflowY: 'auto', flexShrink: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--mc-text)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          本次请求 Trace
          {live && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#34C759', display: 'inline-block', animation: 'mcDotPulse 1.2s infinite' }} title="进行中" />}
        </span>
        <span style={{ fontSize: 11, color: trace.status === 'error' ? 'var(--mc-danger)' : 'var(--mc-muted)' }}>
          {(total / 1000).toFixed(2)}s · {trace.spans.length} spans{live ? ' · 进行中' : ''}
        </span>
      </div>
      <div style={{ fontFamily: 'ui-monospace,Menlo,Consolas,monospace', fontSize: 11.5 }}>
        {trace.spans.map((s: any) => {
          const d = depthOf(s);
          const start = (s.startedAt - t0) / total;
          const durMs = (s.endedAt ?? s.startedAt) - s.startedAt;
          const dur = Math.max(0.02, durMs / total);
          const color = s.status === 'error' ? 'var(--mc-danger)' : (kindColor[s.kind] || '#8E8E93');
          const tok = (s.attrs && s.attrs.promptTokens != null) ? ` (${s.attrs.promptTokens}+${s.attrs.completionTokens} tok)` : '';
          const label = (s.attrs && s.attrs.model ? `${s.name} · ${s.attrs.model}` : s.name) + tok;
          const isOpen = open.has(s.spanId);
          return (
            <div key={s.spanId}>
              <div onClick={() => toggle(s.spanId)} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '3px 0', cursor: 'pointer', padding: '1px 4px', borderRadius: 6 }}>
                <span style={{ width: 14 * d, flexShrink: 0 }} />
                <span title={label} style={{ width: 150, flexShrink: 0, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
                <div style={{ flex: 1, position: 'relative', height: 12, background: 'var(--mc-seg)', borderRadius: 3 }}>
                  <div style={{ position: 'absolute', left: `${start * 100}%`, width: `${dur * 100}%`, top: 1, height: 10, background: color, borderRadius: 3, opacity: s.status === 'error' ? 0.95 : 0.8 }} />
                </div>
                <span style={{ width: 52, flexShrink: 0, textAlign: 'right', color: 'var(--mc-muted)', fontVariantNumeric: 'tabular-nums' }}>{(durMs / 1000).toFixed(2)}s</span>
                <span style={{ width: 12, flexShrink: 0, color: 'var(--mc-muted2)', transform: isOpen ? 'rotate(-90deg)' : 'none', transition: 'transform .15s', display: 'inline-flex' }}><IconCaret /></span>
              </div>
              {isOpen && (
                <div style={{ marginLeft: 14 * d + 162, marginRight: 16, marginBottom: 6, padding: '7px 10px', background: 'var(--mc-seg)', border: '1px solid var(--mc-hair)', borderRadius: 8, fontSize: 11, lineHeight: 1.5 }}>
                  <div style={{ color: 'var(--mc-text)', marginBottom: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <span>状态：<b style={{ color: s.status === 'error' ? 'var(--mc-danger)' : 'var(--mc-accent)' }}>{s.status === 'error' ? '失败' : '成功'}</b></span>
                    <span>耗时：<b>{durMs}ms</b>{s.endedAt == null ? '（进行中）' : ''}</span>
                    <span>类型：<b>{s.kind}</b></span>
                  </div>
                  <div style={{ color: 'var(--mc-muted2)', marginBottom: 2 }}>属性：</div>
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace,Menlo,Consolas,monospace', fontSize: 10.5, color: 'var(--mc-text)' }}>{formatAttrs(s.attrs)}</pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
