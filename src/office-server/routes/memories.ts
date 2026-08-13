import { Router, Request, Response } from 'express';
import { getDb } from '../../core/gateway/db';

/** 注册长期记忆路由 */
export function registerMemories(r: Router): void {
  r.get('/memories', (_req: Request, res: Response) => {
    try {
      const list = getDb().prepare('SELECT * FROM memories ORDER BY category ASC, created_at DESC').all();
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  r.delete('/memories/:id', (req: Request, res: Response) => {
    try {
      getDb().prepare('DELETE FROM memories WHERE id=?').run(req.params.id);
      res.json({ id: req.params.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
