import { useState, type ReactNode } from 'react';
import { IconCaret, IconChat, IconCheck, IconStop, IconThink, IconTool } from './chatIcons';
import { TodoList } from './TaskComponents';
import { ToolCallStream } from './ToolCallStream';
import { ReasoningBlock, StageIndicator } from './StatusIndicators';

// ─── 「查看 AI 在干什么」过程面板 ────────────────────────────────────
// 生成过程中的集中过程入口：头部实时显示 AI 当前在做什么
// （正在调用工具：xxx / 正在思考 / 正在撰写回答 / 已完成），
// 点击「查看过程 / 收起过程」展开/收起下方详细过程
// （阶段条 + 任务清单 + 工具调用流式卡片 + 思考过程）。
// 过程式而非动画式：所有信息都是真实的过程数据（reasoning / step / todos）。
export function ProcessPanel({ busy, justDone, stopped, stage, reasoning, steps, todos, elapsed }: {
  busy: boolean; justDone: boolean; stopped: boolean;
  stage: 'thinking' | 'tooling' | 'writing';
  reasoning: string; steps: any[]; todos: any[]; elapsed: number;
}) {
  const [open, setOpen] = useState(true);
  const hasContent = reasoning.length > 0 || steps.length > 0 || todos.length > 0;
  const active = busy || justDone || stopped;
  // 纯文本对话（无思考/无工具/无任务清单）时完全隐藏，不打扰
  if (!active && !hasContent) return null;

  const runningStep = steps.find((s: any) => s.status === 'running');
  let title: ReactNode;
  let icon: ReactNode;
  let color = 'var(--mc-accent)';
  if (stopped) {
    icon = <IconStop />; color = 'var(--mc-pin)';
    title = <>已停止生成{elapsed > 0 ? ` · 用时 ${elapsed}s` : ''}</>;
  } else if (justDone) {
    icon = <IconCheck />; color = '#34C759';
    title = <>已完成{elapsed > 0 ? ` · 用时 ${elapsed}s` : ''}</>;
  } else if (runningStep) {
    icon = <IconTool />;
    title = <>正在调用工具：{runningStep.name}</>;
  } else if (reasoning) {
    icon = <IconThink />;
    title = <>正在思考…</>;
  } else if (stage === 'writing') {
    icon = <IconChat />;
    title = <>正在撰写回答…</>;
  } else {
    icon = <IconThink />;
    title = <>正在处理…</>;
  }

  const doneCount = steps.filter((s: any) => s.status !== 'running').length;
  return (
    <div style={{ margin: '0 0 10px', border: '1px solid var(--mc-hair)', borderRadius: 12, background: 'var(--mc-glass)', overflow: 'hidden', boxShadow: 'var(--mc-shadow-sm)' }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px', cursor: 'pointer', userSelect: 'none' }}>
        <span style={{ color, display: 'inline-flex' }}>{icon}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--mc-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
        <span style={{ fontSize: 11, color: 'var(--mc-muted2)', fontWeight: 400, flexShrink: 0 }}>{open ? '收起过程' : '查看过程'}</span>
        <span style={{ color: 'var(--mc-muted2)', display: 'inline-flex', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}><IconCaret /></span>
      </div>
      {open && (
        <div className="mc-rot-in" style={{ padding: '0 10px 10px' }}>
          {(busy || justDone) && !stopped && (
            <StageIndicator stage={stage} hasTool={steps.length > 0} toolCount={steps.length} done={justDone} />
          )}
          {todos.length > 0 && <TodoList todos={todos} doneCount={doneCount} stopped={stopped} />}
          {steps.length > 0 && <ToolCallStream steps={steps} />}
          {reasoning.length > 0 && <ReasoningBlock text={reasoning} />}
        </div>
      )}
    </div>
  );
}
