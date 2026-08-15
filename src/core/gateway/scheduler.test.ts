import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// vi.hoisted 保证在静态 import 之前设置 DATA_DIR(独立临时库,避免连到真实库)
vi.hoisted(() => {
  const fs = require('node:fs') as typeof import('node:fs');
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'studentbuddy-test-sched-'));
  process.env.DATA_DIR = TMP;
});

import { getDb, closeDb } from './db';
import {
  nextRunAt, resolveTaskModel, listScheduledTasks,
  createScheduledTask, updateScheduledTask, deleteScheduledTask,
} from './scheduler';
import { setSelectedModel } from './providers';

/** SQLite 时间串格式:YYYY-MM-DD HH:MM:SS(UTC,秒级精度) */
const SQL_DT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** 把 SQLite 时间串转回 epoch 毫秒,便于做差值断言 */
function sqlToEpoch(sqlDt: string): number {
  return new Date(sqlDt.replace(' ', 'T') + 'Z').getTime();
}

describe('gateway/scheduler(定时任务日期逻辑)', () => {
  beforeAll(() => {
    getDb();
    // 造一个启用中的服务商,让 resolveTaskModel 能解析出 providerId/model
    getDb().prepare(`
      INSERT INTO providers (id,type,name,base_url,api_key,default_model,enabled)
      VALUES ('p-sched','openai','Scheduler Provider','https://api.example.com/v1','sk-sched-key-2026','sched-model-1',1)
      ON CONFLICT(id) DO NOTHING
    `).run();
    setSelectedModel('p-sched', 'sched-model-1');
  });

  afterAll(() => { closeDb(); });

  it('SCH-01 nextRunAt:interval 模式返回 now+interval 分钟的 SQLite 时间串', () => {
    const base = new Date('2026-08-14T08:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(base);
    try {
      const nxt = nextRunAt({ mode: 'interval', interval_minutes: 90 });
      expect(nxt).toMatch(SQL_DT);
      // 90 分钟后:2026-08-14 09:30:00
      expect(nxt).toBe('2026-08-14 09:30:00');
      expect(Math.round((sqlToEpoch(nxt!) - base.getTime()) / 60000)).toBe(90);
    } finally {
      vi.useRealTimers();
    }
  });

  it('SCH-01 nextRunAt:once 模式返回 null(执行一次后不再触发)', () => {
    expect(nextRunAt({ mode: 'once', interval_minutes: 0 })).toBeNull();
  });

  it('SCH-02 createScheduledTask:once 模式用 at 指定精确日期(UTC)', () => {
    const t = createScheduledTask({
      name: '早读英语单词', prompt: '背 20 个单词并造句', mode: 'once',
      at: '2026-08-15T08:30:00Z', providerId: 'p-sched', model: 'sched-model-1',
    });
    expect(t.id).toBeTruthy();
    expect(t.id).toMatch(/^[0-9a-f-]{36}$/); // uuid
    expect(t.name).toBe('早读英语单词');
    expect(t.mode).toBe('once');
    expect(t.next_run_at).toBe('2026-08-15 08:30:00'); // 无时区偏移,按 UTC 存储
    expect(t.provider_id).toBe('p-sched');
    expect(t.model).toBe('sched-model-1');
    // 归属会话标题带【定时】前缀
    const sess = getDb().prepare('SELECT title FROM sessions WHERE id=?').get(t.session_id) as any;
    expect(sess.title).toBe('【定时】早读英语单词');
    deleteScheduledTask(t.id);
  });

  it('SCH-02 createScheduledTask:interval 模式 next_run_at ≈ now+间隔分钟', () => {
    const base = new Date('2026-08-14T10:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(base);
    try {
      const t = createScheduledTask({
        name: '每 45 分钟整理课堂笔记', prompt: '整理数学课笔记', mode: 'interval', intervalMinutes: 45,
      });
      expect(t.mode).toBe('interval');
      expect(t.interval_minutes).toBe(45);
      expect(t.next_run_at).toMatch(SQL_DT);
      expect(Math.round((sqlToEpoch(t.next_run_at) - base.getTime()) / 60000)).toBe(45);
      deleteScheduledTask(t.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it('SCH-03 createScheduledTask:参数校验(空名/空内容/非法间隔/once 缺 at)', () => {
    const at = '2026-08-15T00:00:00Z';
    expect(() => createScheduledTask({ name: '', prompt: 'x', mode: 'once', at })).toThrow(/任务名称不能为空/);
    expect(() => createScheduledTask({ name: 'x', prompt: '', mode: 'once', at })).toThrow(/任务内容不能为空/);
    expect(() => createScheduledTask({ name: 'x', prompt: 'x', mode: 'interval', intervalMinutes: 0 })).toThrow(/间隔需为正数/);
    expect(() => createScheduledTask({ name: 'x', prompt: 'x', mode: 'interval', intervalMinutes: -5 })).toThrow(/间隔需为正数/);
    expect(() => createScheduledTask({ name: 'x', prompt: 'x', mode: 'once' })).toThrow(/一次性任务需指定执行时间/);
  });

  it('SCH-04 updateScheduledTask:改 at → 模式切为 once 且 next_run_at 更新', () => {
    const t = createScheduledTask({ name: '改期任务', prompt: 'x', mode: 'interval', intervalMinutes: 30 });
    const upd = updateScheduledTask(t.id, { at: '2026-09-01T12:00:00Z' }); // 跨月日期
    expect(upd.mode).toBe('once');
    expect(upd.next_run_at).toBe('2026-09-01 12:00:00');
    deleteScheduledTask(t.id);
  });

  it('SCH-04 updateScheduledTask:改 interval → 模式切为 interval 且重算 next_run_at', () => {
    const t = createScheduledTask({ name: '改频任务', prompt: 'x', mode: 'once', at: '2026-08-16T00:00:00Z' });
    const base = new Date('2026-08-14T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(base);
    try {
      const upd = updateScheduledTask(t.id, { intervalMinutes: 60 });
      expect(upd.mode).toBe('interval');
      expect(upd.interval_minutes).toBe(60);
      expect(upd.next_run_at).toBe('2026-08-14 13:00:00');
      expect(Math.round((sqlToEpoch(upd.next_run_at) - base.getTime()) / 60000)).toBe(60);
    } finally {
      vi.useRealTimers();
      deleteScheduledTask(t.id);
    }
  });

  it('SCH-04 updateScheduledTask:enabled 启停 / 未知 id 返回 null', () => {
    const t = createScheduledTask({ name: '启停任务', prompt: 'x', mode: 'once', at: '2026-08-20T00:00:00Z' });
    expect(updateScheduledTask(t.id, { enabled: false }).enabled).toBe(0);
    expect(updateScheduledTask(t.id, { enabled: true }).enabled).toBe(1);
    expect(updateScheduledTask('nope-999', { enabled: true })).toBeNull();
    deleteScheduledTask(t.id);
  });

  it('SCH-05 deleteScheduledTask:删除任务,归属会话保留(软删历史)', () => {
    const t = createScheduledTask({ name: '待删任务', prompt: 'x', mode: 'once', at: '2026-08-18T00:00:00Z' });
    expect(deleteScheduledTask(t.id)).toBe(true);
    expect(getDb().prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(t.id)).toBeUndefined();
    expect(deleteScheduledTask(t.id)).toBe(false); // 重复删除返回 false
    // 会话仍在(不物理删)
    expect(getDb().prepare('SELECT id FROM sessions WHERE id=?').get(t.session_id)).toBeTruthy();
  });

  it('SCH-06 listScheduledTasks:按 created_at 升序,且带归属会话标题', () => {
    getDb().prepare('DELETE FROM scheduled_tasks').run(); // 隔离本用例
    const a = createScheduledTask({ name: '任务A', prompt: 'a', mode: 'once', at: '2026-08-20T00:00:00Z' });
    const b = createScheduledTask({ name: '任务B', prompt: 'b', mode: 'once', at: '2026-08-21T00:00:00Z' });
    const list = listScheduledTasks();
    const ia = list.findIndex((x: any) => x.id === a.id);
    const ib = list.findIndex((x: any) => x.id === b.id);
    expect(ia).toBeGreaterThanOrEqual(0);
    expect(ib).toBeGreaterThanOrEqual(0);
    expect(ia).toBeLessThan(ib); // 先创建的在前面
    expect(list[ia].session_title).toBe('【定时】任务A');
    deleteScheduledTask(a.id);
    deleteScheduledTask(b.id);
  });

  it('SCH-07 resolveTaskModel:显式指定 > 已选模型 > 默认服务商(带日期化数据)', () => {
    const explicit = resolveTaskModel('p-sched', 'custom-model-v2');
    expect(explicit).toEqual({ providerId: 'p-sched', model: 'custom-model-v2' });

    const fallback = resolveTaskModel(); // 已选 p-sched/sched-model-1
    expect(fallback).toEqual({ providerId: 'p-sched', model: 'sched-model-1' });
  });
});
