import { getDb } from './db';
import { getSelectedModel, getProviderById, getDefaultProvider } from './providers';
import { createLogger } from '../logger';
import { v4 as uuidv4 } from 'uuid';

const log = createLogger('gateway:scheduler');

/** 计算任务的下一步触发时间（SQLite 时间串），null 表示不再触发 */
export function nextRunAt(t: any): string | null {
  if (t.mode === 'interval' && t.interval_minutes > 0) {
    const base = new Date();
    base.setMinutes(base.getMinutes() + t.interval_minutes);
    return base.toISOString().slice(0, 19).replace('T', ' ');
  }
  return null; // once：执行一次后停用
}

/** 校验 providerId/model：显式指定 > 已选模型 > 默认服务商 */
export function resolveTaskModel(providerId?: string, model?: string): { providerId: string; model: string } {
  const selected = getSelectedModel();
  const p = (providerId ? getProviderById(providerId) : null)
    || (selected ? getProviderById(selected.providerId) : null)
    || getDefaultProvider();
  const m = model || selected?.model || p?.defaultModel || '';
  return { providerId: p?.id || '', model: m };
}

/** 任务列表（含归属会话标题，供前端直接展示/跳转） */
export function listScheduledTasks(): any[] {
  const db = getDb();
  return db.prepare(`
    SELECT t.*, COALESCE(s.title, '') AS session_title
    FROM scheduled_tasks t
    LEFT JOIN sessions s ON s.id = t.session_id
    ORDER BY t.created_at ASC
  `).all() as any[];
}

/** 新建定时任务：mode=once 用 at（ISO 时间），mode=interval 用 intervalMinutes（自 now 起） */
export function createScheduledTask(input: {
  name: string; prompt: string; mode: 'once' | 'interval';
  at?: string; intervalMinutes?: number; providerId?: string; model?: string;
}): any {
  const db = getDb();
  if (!input.name?.trim()) throw new Error('任务名称不能为空');
  if (!input.prompt?.trim()) throw new Error('任务内容不能为空');
  if (input.mode === 'interval' && (!input.intervalMinutes || input.intervalMinutes <= 0)) throw new Error('间隔需为正数（分钟）');
  const id = uuidv4();
  const sessionId = uuidv4();
  const { providerId, model } = resolveTaskModel(input.providerId, input.model);
  const toSql = (d: Date | string) => new Date(d).toISOString().slice(0, 19).replace('T', ' ');
  let nextRun: string;
  if (input.mode === 'once') {
    if (!input.at) throw new Error('一次性任务需指定执行时间');
    nextRun = toSql(input.at);
  } else {
    nextRun = toSql(new Date(Date.now() + input.intervalMinutes! * 60_000));
  }
  db.prepare('INSERT INTO sessions (id,agent_id,source,title) VALUES (?,?,?,?)')
    .run(sessionId, 'default', 'main', `【定时】${input.name.trim()}`);
  db.prepare(`
    INSERT INTO scheduled_tasks (id,name,prompt,mode,next_run_at,interval_minutes,session_id,provider_id,model,enabled)
    VALUES (?,?,?,?,?,?,?,?,?,1)
  `).run(id, input.name.trim(), input.prompt.trim(), input.mode, nextRun, input.intervalMinutes || 0, sessionId, providerId, model);
  log.info({ taskId: id, mode: input.mode, nextRunAt: nextRun }, 'Scheduled task created');
  return listScheduledTasks().find(t => t.id === id) || null;
}

/** 更新任务（名称/内容/启停/time/间隔） */
export function updateScheduledTask(id: string, patch: {
  name?: string; prompt?: string; enabled?: boolean; at?: string; intervalMinutes?: number;
}): any {
  const db = getDb();
  const t = db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(id) as any;
  if (!t) return null;
  if (patch.name !== undefined && patch.name.trim()) {
    db.prepare("UPDATE scheduled_tasks SET name=?, updated_at=datetime('now') WHERE id=?").run(patch.name.trim(), id);
    db.prepare('UPDATE sessions SET title=? WHERE id=?').run(`【定时】${patch.name.trim()}`, t.session_id);
  }
  if (patch.prompt !== undefined && patch.prompt.trim()) {
    db.prepare("UPDATE scheduled_tasks SET prompt=?, updated_at=datetime('now') WHERE id=?").run(patch.prompt.trim(), id);
  }
  if (patch.enabled !== undefined) {
    db.prepare("UPDATE scheduled_tasks SET enabled=?, updated_at=datetime('now') WHERE id=?").run(patch.enabled ? 1 : 0, id);
  }
  if (patch.at) {
    db.prepare("UPDATE scheduled_tasks SET next_run_at=?, mode='once', updated_at=datetime('now') WHERE id=?")
      .run(new Date(patch.at).toISOString().slice(0, 19).replace('T', ' '), id);
  }
  if (patch.intervalMinutes !== undefined && patch.intervalMinutes > 0) {
    const nxt = new Date(Date.now() + patch.intervalMinutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
    db.prepare("UPDATE scheduled_tasks SET interval_minutes=?, mode='interval', next_run_at=?, updated_at=datetime('now') WHERE id=?")
      .run(patch.intervalMinutes, nxt, id);
  }
  return listScheduledTasks().find(x => x.id === id) || null;
}

/** 删除任务：同时软删除归属会话（保留历史，不物理删） */
export function deleteScheduledTask(id: string): boolean {
  const db = getDb();
  const t = db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(id) as any;
  if (!t) return false;
  db.prepare("UPDATE sessions SET updated_at=datetime('now') WHERE id=?").run(t.session_id);
  db.prepare('DELETE FROM scheduled_tasks WHERE id=?').run(id);
  log.info({ taskId: id }, 'Scheduled task deleted');
  return true;
}