/**
 * 会话实时状态快照（SessionLiveState）。
 *
 * 架构加强：每个会话的实时 UI 状态（阶段/工具步骤/任务清单/思考过程/Trace/错误）在服务端
 * 有独立、权威的快照，前端只是它的投影。切回会话时直接拉快照恢复，不依赖脆弱的 SSE 事件
 * 流回放；双 Pane / 多会话并行时各会话状态互不串扰。
 *
 * 写入时机：office-server/index.ts 的 gateway.on(...) 事件监听器统一同步（覆盖所有 emit 点）。
 * 清理策略：会话结束(done/error)后保留一段供回看，超时 TTL 清理；stop() 时清空。
 */
import type { RunningTaskPhase } from './run-state';

/** 单条工具步骤（与前端 SSE step 事件结构一致）。 */
export interface LiveStep {
  stepId: string;
  name: string;
  tool: string;
  status: 'running' | 'done' | 'error';
  args?: any[];
  result?: string;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

/** 任务清单条目。 */
export interface LiveTodo {
  id: string;
  content: string;
  status: 'pending' | 'running' | 'done';
}

/** 会话实时状态快照（前端 /api/sessions/:id/live 直接消费）。 */
export interface SessionLiveState {
  sessionId: string;
  phase: RunningTaskPhase;
  /** 工具调用步骤（实时累积）。 */
  steps: LiveStep[];
  /** 任务规划清单。 */
  todos: LiveTodo[];
  /** 思考/推理内容（增量拼接）。 */
  reasoning: string;
  startedAt: number;
  endedAt: number | null;
  error: string | null;
}

export class SessionStateStore {
  private states = new Map<string, SessionLiveState>();

  private ensure(sessionId: string): SessionLiveState {
    let s = this.states.get(sessionId);
    if (!s) {
      s = {
        sessionId,
        phase: 'thinking',
        steps: [],
        todos: [],
        reasoning: '',
        startedAt: Date.now(),
        endedAt: null,
        error: null,
      };
      this.states.set(sessionId, s);
    }
    return s;
  }

  /** 会话开始/阶段推进（对应 startRunning / tickRunning）。 */
  setPhase(sessionId: string, phase: RunningTaskPhase): void {
    const s = this.ensure(sessionId);
    s.phase = phase;
  }

  /** 会话开始（重置上一轮残留，保证新会话从干净快照起步）。 */
  start(sessionId: string): void {
    this.states.delete(sessionId);
    this.ensure(sessionId);
  }

  /** 合并/追加一条工具步骤（按 stepId upsert，running→done/error）。 */
  upsertStep(sessionId: string, step: LiveStep): void {
    const s = this.ensure(sessionId);
    const idx = s.steps.findIndex(x => x.stepId === step.stepId);
    if (idx >= 0) s.steps[idx] = { ...s.steps[idx], ...step };
    else s.steps.push(step);
  }

  /** 替换任务清单（规划阶段一次性下发）。 */
  setTodos(sessionId: string, todos: LiveTodo[]): void {
    const s = this.ensure(sessionId);
    s.todos = todos;
  }

  /** 追加思考/推理内容。 */
  appendReasoning(sessionId: string, content: string): void {
    if (!content) return;
    const s = this.ensure(sessionId);
    s.reasoning += content;
  }

  /** 会话结束（done/error）。 */
  finish(sessionId: string, done: boolean, error?: string): void {
    const s = this.states.get(sessionId);
    if (!s) return;
    s.endedAt = Date.now();
    if (!done && error) s.error = error;
    // 若尚未推进到终态，补写阶段
    s.phase = done ? 'done' : 'error';
  }

  /** 读取快照（不存在返回 null）。 */
  get(sessionId: string): SessionLiveState | null {
    return this.states.get(sessionId) ?? null;
  }

  /** 删除单会话快照（会话删除等）。 */
  clear(sessionId: string): void {
    this.states.delete(sessionId);
  }

  /** 清理已结束超过 TTL 的会话快照（防止内存泄漏）。 */
  prune(ttlMs: number): void {
    const now = Date.now();
    for (const [sid, s] of this.states) {
      if (s.endedAt && now - s.endedAt > ttlMs) this.states.delete(sid);
    }
  }

  clearAll(): void {
    this.states.clear();
  }
}
