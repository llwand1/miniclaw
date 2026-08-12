// UsageDashboard —— cc-switch 风格深色数据看板
// 详见 AGENTS.md「功能索引表」。
// 设计稿复刻要求：
//  1. 深色暗黑底色 + 圆角卡片 + 品牌蓝主高亮
//  2. 顶部：返回箭头 + 「设置」标题 + 横向标签栏（使用统计高亮）
//  3. 上层指标概览：总消耗 Tokens 大卡 + 总请求/总成本小卡 + 五张并列数据卡（含缓存命中率绿条）
//  4. 下半区「使用趋势」双 Y 轴多系列面积折线图（输入/输出/缓存创建/缓存命中/成本）
//  5. Tooltip 悬浮交互；数据上下逻辑互相对应（缓存创建=0、总成本=$0.00000）

import { useEffect, useMemo, useRef, useState } from 'react';

// ── 配色（深色 cc-switch 风）────────────────────────────────
const C = {
  bg: '#0f1115',          // 页面深底
  card: '#161a21',        // 卡片底
  cardBdr: '#222834',     // 卡片边
  text: '#b39ddb',        // 主文字-紫
  text3: '#9575cd',       // 次级文字-浅紫
  text4: '#7e57c2',       // 弱文字-暗紫
  accent: '#3b82f6',      // 品牌蓝
  input: '#3b82f6',       // 输入-蓝
  output: '#22c55e',      // 输出-绿
  cacheCreate: '#f59e0b', // 缓存创建-橙
  cacheHit: '#a855f7',    // 缓存命中-紫
  cost: '#ef4444',        // 成本-红
  grid: '#1f2530',        // 图表网格线
};

type Series = 'input' | 'output' | 'cacheCreate' | 'cacheHit' | 'cost';

const SERIES_META: Record<Series, { color: string; label: string; axis: 'L' | 'R' }> = {
  input: { color: C.input, label: '输入', axis: 'L' },
  output: { color: C.output, label: '输出', axis: 'L' },
  cacheCreate: { color: C.cacheCreate, label: '缓存创建', axis: 'L' },
  cacheHit: { color: C.cacheHit, label: '缓存命中', axis: 'L' },
  cost: { color: C.cost, label: '成本', axis: 'R' },
};

// ── 数据构造 ────────────────────────────────────────────────
// 设计稿要求：
//  - 01:00–09:00 全部贴近 0 刻度
//  - 10–13 点第一波流量峰值（紫色缓存命中峰值最高，蓝色输入同步抬升）
//  - 15–19 点第二波更高流量高峰
//  - 橙色缓存创建、红色成本全程贴近基线几乎无波动
//  - 缓存创建全天为 0、总成本为 0 美元
function buildSeries() {
  const hours: string[] = [];
  for (let h = 1; h <= 19; h++) hours.push(`08/10 ${String(h).padStart(2, '0')}:00`);

  const input = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1200, 2800, 3500, 2200, 800, 1500, 4200, 3800, 2400, 1200];
  const output = [0, 0, 0, 0, 0, 0, 0, 0, 0, 180, 420, 560, 340, 120, 220, 640, 580, 360, 180];
  // 缓存创建全天为 0（设计稿要求）
  const cacheCreate = new Array(19).fill(0);
  // 紫色缓存命中峰值最高
  const cacheHit = [0, 0, 0, 0, 0, 0, 0, 0, 0, 4200, 8800, 11200, 6800, 2400, 4600, 12800, 11600, 7200, 3600];
  // 成本全天为 0（设计稿要求）
  const cost = new Array(19).fill(0);

  return { hours, input, output, cacheCreate, cacheHit, cost };
}

// ── 数字格式化 ──────────────────────────────────────────────
function fmtInt(n: number): string {
  return Math.round(n).toLocaleString();
}
function fmtWan(n: number): string {
  return (n / 10000).toFixed(2).replace(/\.00$/, '') + '万';
}

// ── 卡片基础样式 ─────────────────────────────────────────────
const cardBase: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.cardBdr}`,
  borderRadius: 12,
  padding: 16,
  color: C.text,
};

// ── 概览卡片 ──────────────────────────────────────────────
function MetricCard({
  label,
  value,
  sub,
  accentColor,
  children,
}: {
  label: string;
  value: string;
  sub?: string;
  accentColor?: string;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ ...cardBase, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12, color: C.text3 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: accentColor || C.text }}>{value}</span>
        {sub && <span style={{ fontSize: 11, color: C.text4 }}>{sub}</span>}
      </div>
      {children}
    </div>
  );
}

// ── 面积折线图（纯 SVG，无依赖）────────────────────────────
function TrendChart({ data }: { data: ReturnType<typeof buildSeries> }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(880);
  const [hover, setHover] = useState<number | null>(null);
  const H = 320;
  const padL = 56, padR = 56, padT = 16, padB = 36;
  const iw = w - padL - padR;
  const ih = H - padT - padB;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 880));
    ro.observe(el);
    setW(el.clientWidth || 880);
    return () => ro.disconnect();
  }, []);

  const n = data.hours.length;
  const xAt = (i: number) => padL + (i / (n - 1)) * iw;

  // 左 Y 轴：token 数量（k）；右 Y 轴：美元 $
  const leftMax = useMemo(() => {
    const all = [...data.input, ...data.output, ...data.cacheHit];
    const m = Math.max(...all, 1000);
    return Math.ceil(m / 5000) * 5000; // 向上取整到 5k
  }, [data]);
  const rightMax = useMemo(() => {
    const m = Math.max(...data.cost, 1);
    return Math.ceil(m);
  }, [data]);

  const yL = (v: number) => padT + ih - (v / leftMax) * ih;
  const yR = (v: number) => padT + ih - (v / rightMax) * ih;

  // 构造路径
  const linePath = (arr: number[], yFn: (v: number) => number) =>
    arr.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yFn(v).toFixed(1)}`).join(' ');
  const areaPath = (arr: number[], yFn: (v: number) => number) =>
    `${linePath(arr, yFn)} L ${xAt(n - 1).toFixed(1)} ${yL(0).toFixed(1)} L ${xAt(0).toFixed(1)} ${yL(0).toFixed(1)} Z`;

  const seriesList: { key: Series; arr: number[]; yFn: (v: number) => number }[] = [
    { key: 'cacheHit', arr: data.cacheHit, yFn: yL },
    { key: 'input', arr: data.input, yFn: yL },
    { key: 'output', arr: data.output, yFn: yL },
    { key: 'cacheCreate', arr: data.cacheCreate, yFn: yL },
    { key: 'cost', arr: data.cost, yFn: yR },
  ];

  // Y 轴刻度
  const leftTicks = [0, 0.25, 0.5, 0.75, 1].map((r) => ({ v: r * leftMax, y: yL(r * leftMax) }));
  const rightTicks = [0, 0.5, 1].map((r) => ({ v: r * rightMax, y: yR(r * rightMax) }));

  // X 轴标签（每 3 小时一个，避免过密）
  const xLabels = data.hours
    .map((h, i) => ({ h, i }))
    .filter((x) => x.i % 3 === 0 || x.i === n - 1);

  // Tooltip 数据
  const tip = hover != null ? {
    x: xAt(hover),
    time: data.hours[hover],
    input: data.input[hover],
    output: data.output[hover],
    cacheCreate: data.cacheCreate[hover],
    cacheHit: data.cacheHit[hover],
    cost: data.cost[hover],
  } : null;

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      {/* 图例 */}
      <div style={{ display: 'flex', gap: 18, marginBottom: 10, flexWrap: 'wrap' }}>
        {(Object.keys(SERIES_META) as Series[]).map((k) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.text3 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: SERIES_META[k].color, display: 'inline-block' }} />
            {SERIES_META[k].label}
          </span>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: C.text4 }}>当天</span>
      </div>

      <svg width={w} height={H} style={{ display: 'block', userSelect: 'none' }}>
        {/* 网格线 */}
        {leftTicks.map((t, i) => (
          <line key={`g${i}`} x1={padL} y1={t.y} x2={w - padR} y2={t.y} stroke={C.grid} strokeWidth={1} />
        ))}
        {/* 左 Y 轴刻度文字 (k) */}
        {leftTicks.map((t, i) => (
          <text key={`lt${i}`} x={padL - 8} y={t.y + 4} textAnchor="end" fontSize={10} fill={C.text4}>{Math.round(t.v / 1000)}</text>
        ))}
        {/* 左 Y 轴单位 */}
        <text x={padL - 8} y={padT - 4} textAnchor="end" fontSize={10} fill={C.text4}>k</text>
        {/* 右 Y 轴刻度文字 ($) */}
        {rightTicks.map((t, i) => (
          <text key={`rt${i}`} x={w - padR + 8} y={t.y + 4} textAnchor="start" fontSize={10} fill={C.text4}>${t.v.toFixed(1)}</text>
        ))}
        <text x={w - padR + 8} y={padT - 4} textAnchor="start" fontSize={10} fill={C.text4}>$</text>

        {/* X 轴标签 */}
        {xLabels.map((x, i) => (
          <text key={`xl${i}`} x={xAt(x.i)} y={H - 12} textAnchor="middle" fontSize={10} fill={C.text4}>{x.h.replace('08/10 ', '')}</text>
        ))}
        <text x={xAt(n - 1) + 4} y={H - 12} fontSize={10} fill={C.text4}> </text>

        {/* 面积 + 折线（成本贴近基线，缓存创建=0 贴基线）*/}
        {seriesList.map((s) => {
          const meta = SERIES_META[s.key];
          return (
            <g key={s.key}>
              <path d={areaPath(s.arr, s.yFn)} fill={meta.color} fillOpacity={0.18} />
              <path d={linePath(s.arr, s.yFn)} fill="none" stroke={meta.color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}

        {/* 悬浮指示线 + 数据点 */}
        {tip && (
          <>
            <line x1={tip.x} y1={padT} x2={tip.x} y2={padT + ih} stroke={C.text4} strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
            {seriesList.map((s) => (
              <circle key={s.key} cx={tip.x} cy={s.yFn(s.arr[hover!])} r={3.5} fill={SERIES_META[s.key].color} stroke={C.bg} strokeWidth={1.5} />
            ))}
          </>
        )}

        {/* 透明 hover 捕获区 */}
        {data.hours.map((_, i) => (
          <rect key={`h${i}`} x={xAt(i) - iw / (2 * (n - 1))} y={padT} width={iw / (n - 1)} height={ih} fill="transparent"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>

      {/* Tooltip 悬浮框 */}
      {tip && (
        <div style={{
          position: 'absolute',
          left: Math.min(tip.x + 12, w - 200),
          top: padT + 8,
          background: '#fff',
          color: '#1f2937',
          borderRadius: 8,
          padding: '10px 12px',
          fontSize: 12,
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          pointerEvents: 'none',
          minWidth: 160,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6, color: '#111827' }}>{tip.time}</div>
          {(Object.keys(SERIES_META) as Series[]).map((k) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, lineHeight: 1.7 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: SERIES_META[k].color }} />
                {SERIES_META[k].label}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {k === 'cost' ? `$${tip[k].toFixed(5)}` : fmtInt(tip[k])}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 主看板组件 ──────────────────────────────────────────────
export function UsageDashboard({
  ownStats,
  ccStats,
}: {
  ownStats: any;
  ccStats: any;
}) {
  const data = useMemo(buildSeries, []);

  // 卡片数值（取后端真实数据；MiniClaw 未单独追踪缓存，缺失即 0，不显示设计稿占位值）
  const t = ownStats?.totals || {};
  const totalTokens = t.totalTokens || 0;
  const totalRequests = t.requests || (ccStats?.totals?.requests || 0);
  const totalCost = t.costUsd || 0;
  const inputTokens = t.promptTokens || 0;
  const outputTokens = t.completionTokens || 0;
  const cacheCreateTokens = 0; // MiniClaw 未单独追踪缓存创建
  const cacheHitTokens = 0;    // MiniClaw 未单独追踪缓存命中
  const cacheHitRate = 0;      // MiniClaw 未单独追踪缓存命中率

  return (
    <div style={{ background: C.bg, minHeight: '100%', padding: 20, fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif' }}>
      {/* 上层指标概览卡片区 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
        {/* 首卡：真实消耗 Tokens */}
        <div style={{ ...cardBase }}>
          <div style={{ fontSize: 12, color: C.text3, marginBottom: 8 }}>真实消耗 Tokens</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 30, fontWeight: 800, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{fmtInt(totalTokens)}</span>
            <span style={{ fontSize: 12, color: C.text4 }}>≈{fmtWan(totalTokens)}</span>
          </div>
        </div>
        {/* 总请求数 */}
        <MetricCard label="总请求数" value={fmtInt(totalRequests)} />
        {/* 总成本 */}
        <MetricCard label="总成本" value={`$${totalCost.toFixed(5)}`} accentColor={C.cost} />
      </div>

      {/* 横向并列五张数据卡片 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 20 }}>
        <MetricCard label="输入" value={fmtWan(inputTokens)} accentColor={C.input} />
        <MetricCard label="输出" value={fmtWan(outputTokens)} accentColor={C.output} />
        <MetricCard label="缓存创建" value={fmtWan(cacheCreateTokens)} accentColor={C.cacheCreate} />
        <MetricCard label="缓存命中" value={fmtWan(cacheHitTokens)} accentColor={C.cacheHit} />
        {/* 缓存命中率 + 绿色进度条 */}
        <div style={{ ...cardBase }}>
          <div style={{ fontSize: 12, color: C.text3, marginBottom: 6 }}>缓存命中率</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.output, fontVariantNumeric: 'tabular-nums', marginBottom: 8 }}>{cacheHitRate}%</div>
          <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${cacheHitRate}%`, background: C.output, borderRadius: 3, transition: 'width .4s ease' }} />
          </div>
        </div>
      </div>

      {/* 下半区「使用趋势」图表 */}
      <div style={{ ...cardBase, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>使用趋势</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: C.text4 }}>当天</span>
        </div>
        <TrendChart data={data} />
      </div>
    </div>
  );
}

export default UsageDashboard;
