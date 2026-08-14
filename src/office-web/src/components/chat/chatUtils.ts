import { CTX_LIMIT_FALLBACK } from './chatStyles';
import type { ServerCtx } from './chatTypes';

/** 把一次 SSE 增量 step（running→done/error）合并进当前 steps 列表（实时累积） */
export function mergeStep(steps: any[], step: any): any[] {
  if (!step || !step.stepId) return steps || [];
  const arr = Array.isArray(steps) ? steps.slice() : [];
  const idx = arr.findIndex((s: any) => s.stepId === step.stepId);
  if (idx >= 0) arr[idx] = { ...arr[idx], ...step };
  else arr.push(step);
  return arr;
}

/** 把消息时间戳格式化为「年-月-日 时:分」（支持 Date/epoch 数值，以及 SQLite 的 UTC 字符串） */
export function fmtMsgTime(ts?: number | string): string {
  if (ts === undefined || ts === null || ts === '') return '';
  let d: Date;
  if (typeof ts === 'number') d = new Date(ts);
  else {
    const s = String(ts);
    d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  }
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${da} ${hh}:${mm}`;
}

/** 上下文用量计算（真实数据：优先服务端权威值，缺失时本地估算兜底） */
export function computeCtx(msgs: { role: string; content: string; tokens?: number }[], server?: ServerCtx | null) {
  // 服务端权威值：模型真实 context window + 系统提示/历史/工具/文件分项估算
  if (server && server.limit > 0) {
    return {
      used: server.used || 0,
      limit: server.limit,
      cats: [
        { key: 'sys', label: '系统提示', color: '#0A84FF', value: server.sys || 0 },
        { key: 'history', label: '对话历史', color: '#34C759', value: server.hist || 0 },
        { key: 'tools', label: '工具', color: '#FF9F0A', value: server.tools || 0 },
        { key: 'files', label: '文件', color: '#BF5AF2', value: server.files || 0 },
      ],
    };
  }
  // 本地兜底估算（接口不可用/会话为空时）
  let sys = 0, hist = 0;
  for (const m of msgs) {
    const t = (m.tokens && m.tokens > 0) ? m.tokens : Math.ceil((m.content?.length || 0) / 4);
    if (m.role === 'system') sys += t; else hist += t;
  }
  const used = sys + hist;
  return {
    used, limit: CTX_LIMIT_FALLBACK,
    cats: [
      { key: 'sys', label: '系统提示', color: '#0A84FF', value: sys },
      { key: 'history', label: '对话历史', color: '#34C759', value: hist },
      { key: 'tools', label: '工具', color: '#FF9F0A', value: 0 },
      { key: 'files', label: '文件', color: '#BF5AF2', value: 0 },
    ],
  };
}

/** 行级 LCS diff：返回 ctx/del/add 序列，驱动变更卡片的「前后对比」。 */
export function lcsLineDiff(oldText: string, newText: string) {
  const a = (oldText || '').split('\n');
  const b = (newText || '').split('\n');
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { t: 'ctx' | 'del' | 'add'; s: string }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: 'ctx', s: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: 'del', s: a[i] }); i++; }
    else { out.push({ t: 'add', s: b[j] }); j++; }
  }
  while (i < n) { out.push({ t: 'del', s: a[i] }); i++; }
  while (j < m) { out.push({ t: 'add', s: b[j] }); j++; }
  return out;
}
