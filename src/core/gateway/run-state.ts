/**
 * 后台任务运行状态管理（运行任务表 + 阶段推进 + run-state 事件广播）。
 * 从 gateway/index.ts 拆出，保持 Gateway 类职责聚焦于对话编排。
 */
import { EventEmitter } from 'node:events';

/** 后台任务阶段：思考中 → 联网搜索 / 抓取页面 / 文件工具 → 撰写回答 → 完成/出错/已停止 */
export type RunningTaskPhase = 'thinking' | 'searching' | 'fetching' | 'writing' | 'done' | 'error' | 'aborted';

/** 单个后台任务（sessionId -> 进行中任务，前端任务栏实时刷新） */
export interface RunningTask {
  sessionId: string;
  title: string;
  providerId: string;
  model: string;
  phase: RunningTaskPhase;
  startedAt: number;
  chars: number;
}

/**
 * 运行任务状态跟踪器：管理 runningTasks 表并通过 emit 回调广播 run-state 事件。
 * 由 Gateway 组合持有（Gateway extends EventEmitter，这里直接复用它的 emit）。
 */
export class RunStateTracker {
  private runningTasks = new Map<string, RunningTask>();

  constructor(private emitter: EventEmitter) {}

  /** 启动一个后台任务，并立即广播阶段 */
  start(sessionId: string, title: string, providerId: string, model: string): void {
    const task: RunningTask = { sessionId, title, providerId, model, phase: 'thinking', startedAt: Date.now(), chars: 0 };
    this.runningTasks.set(sessionId, task);
    this.emitRunState(sessionId);
  }

  /** 更新任务阶段/字数并广播（done/error 用 finished 语义，失联客户端重连后回放） */
  tick(sessionId: string, phase: RunningTaskPhase, chars?: number): void {
    const t = this.runningTasks.get(sessionId);
    if (!t) return;
    t.phase = phase;
    if (typeof chars === 'number') t.chars = chars;
    this.emitRunState(sessionId);
  }

  /** 结束任务：广播 done/error/aborted 后移除（done/aborted 保留 8s，error 保留 60s+供点掉） */
  finish(sessionId: string, done: boolean, error?: string, aborted?: boolean): void {
    const t = this.runningTasks.get(sessionId);
    if (!t) return;
    t.phase = aborted ? 'aborted' : done ? 'done' : 'error';
    const data: any = { sessionId, task: { ...t }, done: done || !!aborted, aborted: !!aborted };
    if (error) data.error = error;
    this.emitter.emit('run-state', data);
    setTimeout(() => this.remove(sessionId), aborted ? 8000 : done ? 8000 : 60_000);
  }

  remove(sessionId: string): void {
    if (this.runningTasks.delete(sessionId)) this.emitter.emit('run-state', { sessionId, done: true, removed: true });
  }

  private emitRunState(sessionId: string): void {
    const t = this.runningTasks.get(sessionId);
    if (!t) return;
    this.emitter.emit('run-state', { sessionId, task: { ...t } });
  }

  /** 当前全部进行中任务快照（供前端刷新/重连时对齐） */
  getAll(): RunningTask[] {
    return [...this.runningTasks.values()];
  }
}
