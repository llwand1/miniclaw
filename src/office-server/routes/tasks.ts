import { Router, Request, Response } from 'express';
import { Gateway } from '../../core/gateway';

/** 注册定时任务路由（定时触发对话） */
export function registerTasks(r: Router, gw: Gateway): void {
  r.get('/tasks', (_req: Request, res: Response) => {
    try { res.json({ tasks: gw.listScheduledTasks() }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  r.post('/tasks', (req: Request, res: Response) => {
    try {
      const { name, prompt, mode, at, intervalMinutes, providerId, model } = req.body || {};
      const task = gw.createScheduledTask({ name, prompt, mode, at, intervalMinutes, providerId, model });
      res.json({ ok: true, task });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  r.put('/tasks/:id', (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { name, prompt, enabled, at, intervalMinutes } = req.body || {};
      const task = gw.updateScheduledTask(id, { name, prompt, enabled, at, intervalMinutes });
      if (!task) return res.status(404).json({ error: '任务不存在' });
      res.json({ ok: true, task });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  r.delete('/tasks/:id', (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const ok = gw.deleteScheduledTask(id);
      if (!ok) return res.status(404).json({ error: '任务不存在' });
      res.json({ ok: true });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });
}
