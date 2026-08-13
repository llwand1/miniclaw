import { useEffect, useState } from 'react';
import { ReactNode } from 'react';
import { IconCaret, IconChat, IconCheck, IconFiles, IconStop, IconThink, IconTool } from './chatIcons';
import { THINK_PHRASES } from './chatStyles';

// ─── 阶段进度指示：思考中 → 调用工具 → 撰写回答 → 完成（实时推进，对标 WorkBuddy 阶段条 / OpenCode 状态栏）──
export function StageIndicator({ stage, hasTool, toolCount = 0, done = false }: { stage: 'thinking' | 'tooling' | 'writing'; hasTool: boolean; toolCount?: number; done?: boolean }) {
  const order = ['thinking', 'tooling', 'writing'] as const;
  const labels: Record<string, string> = { thinking: '思考中', tooling: '调用工具', writing: '撰写回答' };
  const icons: Record<string, ReactNode> = { thinking: <IconThink />, tooling: <IconTool />, writing: <IconChat /> };
  // done 时整条视为已完成；否则按当前 stage 推进
  const ci = done ? order.length : order.indexOf(stage);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 2px 2px', marginBottom: 8, fontSize: 12, flexWrap: 'wrap' }}>
      {order.map((name, ni) => {
        let st: 'done' | 'active' | 'todo' | 'skip' = 'todo';
        if (ni < ci) st = 'done';
        else if (ni === ci) st = 'active';
        else if (name === 'tooling' && !hasTool) st = 'skip';
        const color = st === 'done' ? '#34C759' : st === 'active' ? 'var(--mc-accent)' : st === 'skip' ? 'var(--mc-muted2)' : 'var(--mc-muted2)';
        // 工具阶段：用过工具则显示计数，未用则标注「未使用工具」
        const label = name === 'tooling'
          ? (hasTool ? `调用工具${toolCount > 0 ? ` (${toolCount})` : ''}` : '未使用工具')
          : labels[name];
        return (
          <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color, fontWeight: st === 'active' ? 600 : 400, transition: 'color .25s' }}>
            <span style={{ display: 'inline-flex', flexShrink: 0, opacity: st === 'todo' ? 0.5 : 1, transition: 'opacity .25s' }}>
              {st === 'active' ? <span className="mc-spin" style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid ' + color, borderTopColor: 'transparent' }} />
                : st === 'done' ? <IconCheck /> : icons[name]}
            </span>
            <span>{label}</span>
            {ni < order.length - 1 && <span style={{ color: 'var(--mc-muted2)', margin: '0 2px' }}>·</span>}
          </span>
        );
      })}
      {done && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#34C759', fontWeight: 600, marginLeft: 2, animation: 'mcRotIn .4s ease both' }}>
          <IconCheck /> 完成
        </span>
      )}
    </div>
  );
}

// ─── 已停止指示：用户主动中止后展示明确的「已停止生成」反馈（替代静默收尾）──
// 与 StageIndicator 互斥：停止时不显示绿色「完成」，而是琥珀色「已停止」，
// 并提示本轮过程信息（步骤 / 任务 / 思考 / 部分回复）已保留在下方供查看。
export function StoppedIndicator({ elapsed }: { elapsed?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 2px 2px', marginBottom: 8, fontSize: 12, flexWrap: 'wrap', animation: 'mcRotIn .3s ease both' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--mc-pin)', fontWeight: 600 }}>
        <IconStop />
        已停止生成
      </span>
      {typeof elapsed === 'number' && (
        <span style={{ color: 'var(--mc-muted2)' }}>· 用时 {elapsed}s</span>
      )}
      <span style={{ color: 'var(--mc-muted2)' }}>· 已保留本轮过程信息（步骤 / 任务 / 思考）</span>
    </div>
  );
}

// ─── 多文案轮播加载提示：等待期切换不同提示语（想法沉淀/整理论据/检索记忆等）──
// 思考态文案池：随思考强度档位选不同语系；每 3.6s 淡入淡出切下一句。
export function StatusTextRotation({ level, elapsed }: { level: 0 | 1 | 2; elapsed: number }) {
  const pool = level === 0 ? THINK_PHRASES.low : level === 1 ? THINK_PHRASES.mid : THINK_PHRASES.high;
  // 每 3.6s（与 mcRotFade 一个周期对齐）推进下标
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (pool.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % pool.length), 3600);
    return () => clearInterval(t);
  }, [pool.length]);
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', minWidth: 60 }}>
      <span style={{ animation: 'mcDotPulse 1.2s infinite', display: 'inline-block' }}>●</span>
      <span style={{ animation: 'mcDotPulse 1.2s infinite .2s', display: 'inline-block' }}>●</span>
      <span style={{ animation: 'mcDotPulse 1.2s infinite .4s', display: 'inline-block' }}>●</span>
      <span key={idx} className="mc-rot-in" style={{ marginLeft: 6, fontSize: 12, color: 'var(--mc-muted)' }}>{pool[idx]}</span>
      <span style={{ fontSize: 11, color: 'var(--mc-muted2)', marginLeft: 4 }}>{elapsed}s</span>
    </span>
  );
}

// ─── 等待徽章：图标呼吸微动 + 状态轮播文案（正文尚未到达的等待期）──
// 覆盖「工具调用中 / 文件读取中 / 网络等待」等场景，避免单一静态文案。
// hasTool=true → 文件读取态（文件夹图标呼吸 + 读取系文案）；否则通用等待态。
export function WaitingIndicator({ hasTool }: { hasTool: boolean }) {
  const phrases = hasTool
    ? ['正在读取文件', '检索工作区内容', '解析上下文', '整理素材']
    : ['正在组织语言', '检索上下文', '准备回复', '稍等片刻'];
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (phrases.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % phrases.length), 3200);
    return () => clearInterval(t);
  }, [phrases.length]);
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', color: 'var(--mc-muted)', fontSize: 13 }}>
      {/* 呼吸徽章：文件读取态用文件夹图标，通用态用对话泡图标，均走 mcBreath 呼吸 */}
      <span className="mc-breath" style={{ display: 'inline-flex', color: 'var(--mc-accent)' }}>
        {hasTool ? <IconFiles /> : <IconChat />}
      </span>
      {/* 轮播文案：按键淡入切换（不再闪回） */}
      <span key={idx} className="mc-rot-in" style={{ color: 'var(--mc-muted)' }}>{phrases[idx]}</span>
      {/* 备用：保留一个慢转 spinner 作为兜底动感（不抢主视觉） */}
      <span className="mc-spin" style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid var(--mc-hair)', borderTopColor: 'var(--mc-accent)', opacity: 0.5 }} />
    </span>
  );
}

// ─── 思考/推理块：可折叠，随 reasoning 流式增长实时渲染（对标 OpenCode --thinking / WorkBuddy 思考块）──
export function ReasoningBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(true);
  if (!text) return null;
  return (
    <div style={{ border: '1px solid var(--mc-hair)', background: 'var(--mc-glass)', borderRadius: 12, padding: '8px 10px', margin: '0 0 10px', fontSize: 12.5 }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--mc-muted)', fontWeight: 600 }}>
        <span style={{ color: 'var(--mc-accent)', display: 'inline-flex' }}><IconThink /></span>
        思考过程
        <span style={{ marginLeft: 'auto', color: 'var(--mc-muted2)', display: 'inline-flex', transform: open ? 'rotate(-90deg)' : 'none', transition: 'transform .15s' }}><IconCaret /></span>
      </div>
      {open && (
        <div style={{ marginTop: 6, padding: '6px 8px', background: 'var(--mc-seg)', border: '1px solid var(--mc-hair)', borderRadius: 8, color: 'var(--mc-muted)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflowY: 'auto' }}>
          {text}
        </div>
      )}
    </div>
  );
}
