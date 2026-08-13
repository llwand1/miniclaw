import { useEffect, useState } from 'react';
import type { RunningTaskFront } from '../../preview/PreviewClient';
import { IconCaret, IconChat, IconCheck, IconCross, IconFile, IconGlobe, IconSearch, IconThink, IconTool } from './chatIcons';
import { TEXT_FOLD_CHARS } from './chatStyles';

// ─── 后台任务阶段标签 / 图标（底部任务栏 + 侧边栏徽章共用）─────────────────
export function taskPhaseInfo(p: string) {
  switch (p) {
    case 'searching': return { label: '联网搜索', icon: <IconSearch />, color: 'var(--mc-accent)' };
    case 'fetching': return { label: '抓取页面', icon: <IconGlobe />, color: 'var(--mc-accent)' };
    case 'writing': return { label: '撰写回答', icon: <IconChat />, color: 'var(--mc-accent)' };
    case 'done': return { label: '已完成', icon: <IconCheck />, color: '#34C759' };
    case 'error': return { label: '出错', icon: <IconCross />, color: 'var(--mc-danger)' };
    default: return { label: '思考中', icon: <IconThink />, color: 'var(--mc-accent)' };
  }
}

// ─── 底部任务栏单个任务芯片：标题 + 阶段 + 已用时（每 10s 校准）────────────
export function TaskChip({ task, onClick }: { task: RunningTaskFront; onClick: () => void }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (task.done || task.error) return;
    const t = setInterval(() => force(x => x + 1), 1000);
    return () => clearInterval(t);
  }, [task.sessionId, task.done, task.error]);
  const info = taskPhaseInfo(task.phase);
  const secs = Math.max(0, Math.floor((Date.now() - task.startedAt) / 1000));
  const mm = Math.floor(secs / 60), ss = secs % 60;
  const still = !task.done && task.phase !== 'error';
  return (
    <button onClick={onClick} title={`${task.title}\n${info.label} · ${mm}:${String(ss).padStart(2, '0')}`}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 12, border: '1px solid var(--mc-hair)', background: 'var(--mc-glass-strong)', backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)', boxShadow: 'var(--mc-shadow-md)', cursor: 'pointer', color: 'var(--mc-text)', fontSize: 12.5, whiteSpace: 'nowrap', transition: 'transform .12s, background .12s' }}
      onMouseDown={e => e.stopPropagation()}>
      {still ? (
        <span style={{ color: info.color, display: 'flex', flexShrink: 0 }}><span className="mc-spin" style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid ' + info.color, borderTopColor: 'transparent' }} /></span>
      ) : (
        <span style={{ color: info.color, display: 'flex', flexShrink: 0 }}>{info.icon}</span>
      )}
      <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 }}>{task.title}</span>
      <span style={{ color: 'var(--mc-muted2)', display: 'inline-flex', alignItems: 'center', gap: 5, fontVariantNumeric: 'tabular-nums' }}>
        {info.label} · {mm}:{String(ss).padStart(2, '0')}
      </span>
    </button>
  );
}

// ─── 任务规划清单（WorkBuddy 式）：规划阶段 [TODO:...] 步骤，随工具步骤完成逐个打勾 ──
export function TodoList({ todos, doneCount }: { todos: { id: string; content: string; status: 'pending' | 'running' | 'done' }[]; doneCount: number }) {
  if (!todos || todos.length === 0) return null;
  return (
    <div className="mc-scroll" style={{ border: '1px solid var(--mc-hair)', background: 'var(--mc-glass)', borderRadius: 12, padding: '8px 10px', margin: '0 0 10px', fontSize: 12.5, boxShadow: 'var(--mc-shadow-sm)' }}>
      <div style={{ fontSize: 11, color: 'var(--mc-muted)', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
        <IconCheck /> 任务清单
        <span style={{ marginLeft: 'auto', fontWeight: 400, color: 'var(--mc-muted2)' }}>{Math.min(doneCount, todos.length)}/{todos.length} 完成</span>
      </div>
      {todos.map((t, i) => {
        const st = i < doneCount ? 'done' : i === doneCount ? 'running' : 'pending';
        const color = st === 'done' ? '#34C759' : st === 'running' ? 'var(--mc-accent)' : 'var(--mc-muted2)';
        return (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 8 }}>
            <span style={{ color, display: 'inline-flex', flexShrink: 0, width: 16, justifyContent: 'center' }}>
              {st === 'done' ? <IconCheck /> : st === 'running' ? (
                <span className="mc-spin" style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid ' + color, borderTopColor: 'transparent' }} />
              ) : (
                <span style={{ fontSize: 11, opacity: 0.6 }}>{i + 1}</span>
              )}
            </span>
            <span style={{ flex: 1, color: st === 'pending' ? 'var(--mc-muted)' : 'var(--mc-text)', textDecoration: st === 'done' ? 'line-through' : 'none' }}>{t.content}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── 通用长文本折叠组件：超长内容默认收起（「N 行 · M 字符 · 点击展开」），支持一键复制
export function FoldText({ text, foldChars = TEXT_FOLD_CHARS }: { text: string; foldChars?: number }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const isLong = (text?.length || 0) > foldChars;
  const lines = (text || '').split('\n').length;
  if (!isLong) {
    return <div style={{ color: 'var(--mc-text)', wordBreak: 'break-word' }}>{text}</div>;
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };
  return (
    <div style={{ border: '1px solid var(--mc-hair)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--mc-seg)', fontSize: 11, color: 'var(--mc-muted2)' }}>
        <button onClick={() => setOpen(o => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'transparent', color: 'var(--mc-accent)', cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: 0 }}>
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform .15s', transform: open ? 'rotate(90deg)' : 'none' }}><polyline points="9 18 15 12 9 6" /></svg>
          {open ? '收起' : `展开全部 ${lines} 行 · ${text.length.toLocaleString()} 字符`}
        </button>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <button onClick={copy} style={{ border: 'none', background: 'transparent', color: copied ? '#34C759' : 'var(--mc-muted2)', cursor: 'pointer', fontSize: 11, padding: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {copied ? '✓ 已复制' : '复制'}
          </button>
        </span>
      </div>
      {open && (
        <div style={{ maxHeight: 260, overflowY: 'auto', padding: '6px 10px', color: 'var(--mc-text)', wordBreak: 'break-word', fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{text}</div>
      )}
    </div>
  );
}

// ─── 工具调用提示卡片：对话流内实时展示「正在调用工具」（对标 WorkBuddy 中间步骤）──
// 原生 function calling 下 step.name 已是中文标签（联网搜索/抓取网页/读取文件…），
// 这里补：JSON 参数格式化、单步耗时、完成柔光（mc-step-done）、展开淡入。
function formatToolArg(a: any): string {
  if (typeof a !== 'string') return JSON.stringify(a, null, 2);
  const t = a.trim();
  if ((t.startsWith('{') || t.startsWith('[')) && (t.endsWith('}') || t.endsWith(']'))) {
    try { return JSON.stringify(JSON.parse(t), null, 2); } catch { /* 非合法 JSON，原样 */ }
  }
  return a;
}
function toolDuration(s: any): string {
  if (!s.endedAt || !s.startedAt) return '';
  const d = Math.max(0, s.endedAt - s.startedAt);
  return d >= 1000 ? (d / 1000).toFixed(1) + 's' : d + 'ms';
}

export function ToolSteps({ steps }: { steps: any[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  if (!steps || steps.length === 0) return null;
  const doneCount = steps.filter((s: any) => s.status !== 'running').length;
  return (
    <div className="mc-scroll" style={{ border: '1px solid var(--mc-hair)', background: 'var(--mc-glass)', borderRadius: 12, padding: '8px 10px', margin: '0 0 10px', fontSize: 12.5, boxShadow: 'var(--mc-shadow-sm)' }}>
      <div style={{ fontSize: 11, color: 'var(--mc-muted)', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
        <IconTool /> 工具调用
        <span style={{ marginLeft: 'auto', fontWeight: 400, color: 'var(--mc-muted2)' }}>{doneCount}/{steps.length} 完成</span>
      </div>
      {steps.map((s: any) => {
        const isOpen = open.has(s.stepId);
        const accent = s.status === 'error' ? 'var(--mc-danger)' : s.status === 'done' ? '#34C759' : 'var(--mc-accent)';
        const dur = toolDuration(s);
        return (
          <div key={s.stepId}>
            <div onClick={() => toggle(s.stepId)}
              className={s.status === 'done' ? 'mc-step-done' : ''}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 8, cursor: 'pointer', transition: 'background .15s' }}>
              <span style={{ color: accent, display: 'flex', flexShrink: 0 }}>{s.tool === 'fetch' ? <IconGlobe /> : s.tool === 'fs' ? <IconFile /> : <IconSearch />}</span>
              <span style={{ flex: 1, color: 'var(--mc-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
              {dur && s.status !== 'running' && <span style={{ color: 'var(--mc-muted2)', fontVariantNumeric: 'tabular-nums', fontSize: 10.5, flexShrink: 0 }}>{dur}</span>}
              {s.status === 'running' && <span className="mc-spin" style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid ' + accent, borderTopColor: 'transparent', flexShrink: 0 }} />}
              {s.status === 'done' && <span style={{ color: accent, display: 'flex', flexShrink: 0 }}><IconCheck /></span>}
              {s.status === 'error' && <span style={{ color: accent, display: 'flex', flexShrink: 0 }}><IconCross /></span>}
              <span style={{ color: 'var(--mc-muted2)', transform: isOpen ? 'rotate(-90deg)' : 'none', transition: 'transform .15s', display: 'flex', flexShrink: 0 }}><IconCaret /></span>
            </div>
            {isOpen && (
              <div key="exp" className="mc-rot-in" style={{ margin: '0 6px 6px 28px', padding: '6px 8px', background: 'var(--mc-seg)', border: '1px solid var(--mc-hair)', borderRadius: 8, fontSize: 11, lineHeight: 1.5 }}>
                {Array.isArray(s.args) && s.args.length > 0 && (
                  <div style={{ marginBottom: 4 }}>
                    <div style={{ color: 'var(--mc-muted2)', marginBottom: 2 }}>输入</div>
                    {s.args.map((a: any, i: number) => (
                      <pre key={i} style={{ margin: '2px 0', padding: '5px 7px', background: 'var(--mc-glass)', border: '1px solid var(--mc-hair)', borderRadius: 6, color: 'var(--mc-text)', fontFamily: 'ui-monospace,monospace', fontSize: 10.5, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 220, overflowY: 'auto' }}>{formatToolArg(a)}</pre>
                    ))}
                  </div>
                )}
                {s.result && (<div style={{ marginBottom: 4 }}><div style={{ color: 'var(--mc-muted2)', marginBottom: 2 }}>结果</div><FoldText text={String(s.result)} /></div>)}
                {s.error && (<div style={{ color: 'var(--mc-danger)' }}>{s.error}</div>)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
