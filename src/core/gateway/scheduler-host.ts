/**
 * 定时任务调度器（从 gateway/index.ts 拆出）。
 * 负责轮询 scheduled_tasks 表、触发到期任务、推进下次触发时间。
 * 通过 runTask 回调把「执行任务」委托回 Gateway（避免循环依赖）。
 */
import { getDb } from './db';
import { createLogger } from '../logger';
import { nextRunAt } from './scheduler';

const log = createLogger('gateway:scheduler-host');

/** 调度器需要的 Gateway 能力（由 Gateway 实例满足）。 */
export interface SchedulerHostDeps {
  /** 触发一个定时任务的对话（source=main）。 */
  runTask(input: { source: 'main'; sessionId: string; text: string; providerId?: string; model?: string }): Promise<string>;
}

export class SchedulerHost {
  private timer: ReturnType<typeof setInterval> | null = null;
  private doingTasks = new Set<string>();

  constructor(private deps: SchedulerHostDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { this.checkDue().catch(() => {}); }, 20_000);
    log.info('Scheduled task scheduler started (every 20s)');
  }

  /** 轮询：扫描到期任务，逐个触发（doingTasks 防同任务重叠） */
  private async checkDue(): Promise<void> {
    const db = getDb();
    const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const due = db.prepare('SELECT * FROM scheduled_tasks WHERE enabled=1 AND next_run_at <= ? ORDER BY next_run_at ASC').all(nowStr) as any[];
    for (const t of due) {
      if (this.doingTasks.has(t.id)) continue;
      this.doingTasks.add(t.id);
      db.prepare("UPDATE scheduled_tasks SET last_status='running', updated_at=datetime('now') WHERE id=?").run(t.id);
      try {
        await this.deps.runTask({
          source: 'main', sessionId: t.session_id, text: t.prompt,
          providerId: t.provider_id || undefined, model: t.model || undefined,
        });
        db.prepare("UPDATE scheduled_tasks SET last_status='ok', last_run_at=?, updated_at=datetime('now') WHERE id=?").run(nowStr, t.id);
      } catch (err: any) {
        db.prepare("UPDATE scheduled_tasks SET last_status='error', last_run_at=?, updated_at=datetime('now') WHERE id=?").run(nowStr, t.id);
        log.warn({ taskId: t.id, error: err.message }, 'Scheduled task run failed');
      } finally {
        this.doingTasks.delete(t.id);
      }
      // 推进下一次触发时间；once 任务执行后自动停用
      const nxt = nextRunAt(t);
      if (nxt) {
        db.prepare('UPDATE scheduled_tasks SET next_run_at=? WHERE id=?').run(nxt, t.id);
      } else {
        db.prepare("UPDATE scheduled_tasks SET enabled=0, updated_at=datetime('now') WHERE id=?").run(t.id);
      }
    }
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
