import { useMemo, useState } from 'react';
import { IconCaret } from './chatIcons';
import { formatAttrs } from './chatUtils';

// ─── 流程图式 Trace：把一次请求的 Span 树画成「节点 + 连线」的流程图
//   根 chat → 子节点(llm/tool/db/stream)按父子关系纵向展开,自绘 SVG 折线连接;
//   节点按 kind 着色,失败红色,进行中(endedAt=null)脉冲;点击展开 attrs 详情。
const NODE_W = 176;
const NODE_H = 54;
const V_GAP = 52;   // 父子纵向间距(含连线高度)
const H_GAP = 22;   // 兄弟横向间距
const PAD = 20;     // 画布外边距

interface Pos { x: number; y: number }

export function TraceFlow({ trace }: { trace: any }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const layout = useMemo(() => buildLayout(trace), [trace]);

  if (!trace || !Array.isArray(trace.spans) || trace.spans.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--mc-muted2)', fontSize: 12.5, lineHeight: 1.8, textAlign: 'center', padding: 20 }}>
        <div>
          暂无 Trace 数据。<br />
          发送一条消息后,这里会以「流程图」展示本次请求的调用链:
          <br />根请求 → LLM 调用 / 工具 / 流式,节点间连线表示调用关系,失败节点标红。
        </div>
      </div>
    );
  }

  if (!layout) return null;
  const { root, positions, edges, totalW, totalH, maxDepth } = layout;
  const live = !trace.endedAt;
  const t0 = Math.min(trace.startedAt, ...trace.spans.map((s: any) => s.startedAt));
  const t1 = Math.max(trace.endedAt ?? t0, ...trace.spans.map((s: any) => s.endedAt ?? s.startedAt));
  const totalMs = Math.max(0, t1 - t0);

  return (
    <div className="mc-scroll" style={{ flex: 1, overflow: 'auto', minHeight: 0, background: 'var(--mc-glass)', padding: 12 }}>
      {/* 头部汇总 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 12, fontWeight: 600, color: 'var(--mc-text)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          调用链 Trace
          {live && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#34C759', display: 'inline-block', animation: 'mcDotPulse 1.2s infinite' }} title="进行中" />}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 400, color: trace.status === 'error' ? 'var(--mc-danger)' : 'var(--mc-muted)' }}>
          {(totalMs / 1000).toFixed(2)}s · {trace.spans.length} spans · {maxDepth + 1} 层{live ? ' · 进行中' : ''}
        </span>
      </div>
      {/* 图例 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 10, fontSize: 10.5, color: 'var(--mc-muted)', flexWrap: 'wrap' }}>
        {([['root', '请求'], ['llm', 'LLM'], ['tool', '工具'], ['db', '数据库'], ['stream', '流式']] as const).map(([k, label]) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: kindColor[k] || '#8E8E93', display: 'inline-block' }} />
            {label}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--mc-danger)', display: 'inline-block' }} />失败
        </span>
      </div>
      {/* 流程图画布 */}
      <div style={{ width: '100%', overflowX: 'auto', paddingBottom: 8 }}>
        <div style={{ position: 'relative', width: totalW + PAD * 2, height: totalH + PAD * 2 }}>
          {/* SVG 连线层 */}
          <svg style={{ position: 'absolute', inset: 0, width: totalW + PAD * 2, height: totalH + PAD * 2, pointerEvents: 'none' }}>
            {edges.map((e, i) => (
              <path key={i} d={edgePath(e, positions)} fill="none" stroke="var(--mc-hair)" strokeWidth={1.6} />
            ))}
          </svg>
          {/* 节点层(HTML,支持点击展开) */}
          {trace.spans.map((s: any) => {
            const p = positions.get(s.spanId);
            if (!p) return null;
            const isOpen = open.has(s.spanId);
            const color = s.status === 'error' ? 'var(--mc-danger)' : (kindColor[s.kind] || '#8E8E93');
            const durMs = (s.endedAt ?? s.startedAt) - s.startedAt;
            const tok = (s.attrs && s.attrs.promptTokens != null) ? `${s.attrs.promptTokens}+${s.attrs.completionTokens} tok` : '';
            const label = s.attrs?.model ? `${s.name} · ${s.attrs.model}` : s.name;
            return (
              <div key={s.spanId} style={{ position: 'absolute', left: p.x - NODE_W / 2, top: p.y, width: NODE_W, boxSizing: 'border-box' }}>
                <div
                  onClick={() => toggle(s.spanId)}
                  style={{
                    border: `1.5px solid ${color}`, background: 'var(--mc-glass-strong)', borderRadius: 10,
                    padding: '7px 10px', cursor: 'pointer', boxShadow: 'var(--mc-shadow-sm)',
                    opacity: s.status === 'error' ? 1 : 0.96,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: .4, color: color, padding: '1px 6px', borderRadius: 5, background: color + '1f', textTransform: 'uppercase' }}>{s.kind}</span>
                    {s.status === 'error' && <span style={{ color: 'var(--mc-danger)', fontSize: 12 }} title="失败">✕</span>}
                    {s.endedAt == null && <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, animation: 'mcDotPulse 1s infinite', marginLeft: 'auto' }} title="进行中" />}
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--mc-muted)', fontVariantNumeric: 'tabular-nums' }}>{(durMs / 1000).toFixed(2)}s</span>
                    <span style={{ color: 'var(--mc-muted2)', transform: isOpen ? 'rotate(-90deg)' : 'none', transition: 'transform .15s', display: 'inline-flex', fontSize: 10 }}><IconCaret /></span>
                  </div>
                  <div style={{ marginTop: 3, fontSize: 11.5, fontWeight: 500, color: 'var(--mc-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={label}>{label}</div>
                  {tok && <div style={{ fontSize: 9.5, color: 'var(--mc-muted2)' }}>{tok}</div>}
                </div>
                {isOpen && (
                  <div style={{ marginTop: 4, padding: '7px 10px', background: 'var(--mc-seg)', border: '1px solid var(--mc-hair)', borderRadius: 8, fontSize: 10.5, lineHeight: 1.5 }}>
                    <div style={{ color: 'var(--mc-text)', marginBottom: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span>状态：<b style={{ color: s.status === 'error' ? 'var(--mc-danger)' : 'var(--mc-accent)' }}>{s.status === 'error' ? '失败' : '成功'}</b></span>
                      <span>耗时：<b>{durMs}ms</b>{s.endedAt == null ? '（进行中）' : ''}</span>
                      <span>类型：<b>{s.kind}</b></span>
                    </div>
                    <div style={{ color: 'var(--mc-muted2)', marginBottom: 2 }}>属性：</div>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace,Menlo,Consolas,monospace', fontSize: 10, color: 'var(--mc-text)' }}>{formatAttrs(s.attrs)}</pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── kind → 颜色(与旧瀑布一致) ───────────────────────────────
const kindColor: Record<string, string> = {
  root: 'var(--mc-accent)',
  llm: '#BF5AF2',
  tool: 'var(--mc-pin)',
  db: '#34C759',
  stream: '#5AC8FA',
};

// ─── 树布局:建 children 索引 → 计算宽度 → 逐层定位 ─────────────
interface LayoutResult {
  root: any;
  positions: Map<string, Pos>;
  edges: { from: string; to: string }[];
  totalW: number;
  totalH: number;
  maxDepth: number;
}

function buildLayout(trace: any): LayoutResult | null {
  if (!trace || !Array.isArray(trace.spans) || trace.spans.length === 0) return null;
  const spans = trace.spans as any[];
  const byId = new Map(spans.map(s => [s.spanId, s]));

  // 根:kind=root 或没有父节点的 span
  let root: any = spans.find(s => s.kind === 'root') || spans.find(s => !s.parentSpanId || !byId.has(s.parentSpanId)) || spans[0];

  // 建 children 索引(跳过指向自己的环)
  const children = new Map<string, any[]>();
  for (const s of spans) {
    if (s.spanId === root.spanId) continue;
    const pid = s.parentSpanId && byId.has(s.parentSpanId) ? s.parentSpanId : root.spanId;
    if (pid === s.spanId) continue;
    if (!children.has(pid)) children.set(pid, []);
    children.get(pid)!.push(s);
  }

  // 计算子树宽度
  const widthOf = (node: any): number => {
    const kids = children.get(node.spanId) || [];
    if (kids.length === 0) return NODE_W;
    const sum = kids.reduce((acc, k) => acc + widthOf(k), 0) + (kids.length - 1) * H_GAP;
    return Math.max(NODE_W, sum);
  };

  // 递归定位(子节点居中对齐父节点)
  const positions = new Map<string, Pos>();
  const edges: { from: string; to: string }[] = [];
  let maxDepth = 0;

  const place = (node: any, xLeft: number, depth: number) => {
    const kids = children.get(node.spanId) || [];
    const totalW = widthOf(node);
    const x = xLeft + totalW / 2;
    const y = depth * (NODE_H + V_GAP);
    positions.set(node.spanId, { x, y });
    maxDepth = Math.max(maxDepth, depth);

    let cx = xLeft;
    for (const k of kids) {
      const kw = widthOf(k);
      edges.push({ from: node.spanId, to: k.spanId });
      place(k, cx, depth + 1);
      cx += kw + H_GAP;
    }
  };
  place(root, 0, 0);

  const totalW = widthOf(root);
  const totalH = (maxDepth + 1) * (NODE_H + V_GAP) - V_GAP;
  return { root, positions, edges, totalW, totalH, maxDepth };
}

// ─── 父子连线:父底 → 子顶,三段折线 ────────────────────────────
function edgePath(e: { from: string; to: string }, pos: Map<string, Pos>): string {
  const p = pos.get(e.from);
  const c = pos.get(e.to);
  if (!p || !c) return '';
  const x1 = p.x, y1 = p.y + NODE_H;
  const x2 = c.x, y2 = c.y;
  const midY = y1 + (y2 - y1) * 0.5;
  // 先垂直向下,再水平,再垂直向下(箭头由描边末端自带圆头,简洁即可)
  return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
}
