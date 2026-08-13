import { Router, Request, Response } from 'express';
import { getDb } from '../../core/gateway/db';
import { Gateway } from '../../core/gateway';
import type { SessionStateStore } from '../../core/gateway/session-state';
import crypto from 'node:crypto';

/** 注册状态检查 + 会话 CRUD 路由 */
export function registerSessions(r: Router, gw: Gateway, sessionStates?: SessionStateStore): void {
  // 状态检查
  r.get('/status', (_req: Request, res: Response) => {
    const hasProviders = !!getDb().prepare('SELECT id FROM providers LIMIT 1').get();
    res.json({ hasProviders });
  });

  // 会话
  r.get('/sessions', (_req: Request, res: Response) => {
    res.json(getDb().prepare('SELECT * FROM sessions WHERE deleted_at IS NULL ORDER BY pinned DESC, updated_at DESC').all());
  });

  r.get('/sessions/:id', (req: Request, res: Response) => {
    const s = getDb().prepare('SELECT * FROM sessions WHERE id=?').get(req.params.id);
    if (!s) return res.status(404).json({ error: 'not found' });
    const msgs = getDb().prepare('SELECT * FROM messages WHERE session_id=? ORDER BY ts').all(req.params.id);
    res.json({ session: s, messages: msgs });
  });

  // 会话实时状态快照：阶段 / 工具步骤 / 任务清单 / 思考过程 / Trace。
  // 前端切回会话时拉取恢复（架构独立性：每个会话的 UI 状态服务端独立持有）。
  r.get('/sessions/:id/live', (req: Request, res: Response) => {
    try {
      if (!sessionStates) return res.status(404).json({ error: 'not found' });
      const st = sessionStates.get(String(req.params.id));
      if (!st) return res.status(404).json({ error: 'not found' });
      res.json(st);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 会话真实上下文用量：模型 context window（limit）+ 系统提示/历史/工具/文件分项估算。
  // 前端进度条用此数据替代写死的 8000。
  r.get('/sessions/:id/context', (req: Request, res: Response) => {
    try {
      res.json(gw.estimateSessionContext(String(req.params.id)));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 软删除会话（仅隐藏，不物理删除，规避外键级联 + 数据可恢复）
  r.delete('/sessions/:id', (req: Request, res: Response) => {
    try {
      const existing = getDb().prepare('SELECT id FROM sessions WHERE id=? AND deleted_at IS NULL').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'not found' });
      getDb().prepare("UPDATE sessions SET deleted_at=datetime('now') WHERE id=?").run(req.params.id);
      res.json({ id: req.params.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 置顶 / 取消置顶（切换 pinned）
  r.put('/sessions/:id/pin', (req: Request, res: Response) => {
    try {
      const existing = getDb().prepare('SELECT id FROM sessions WHERE id=? AND deleted_at IS NULL').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'not found' });
      getDb().prepare('UPDATE sessions SET pinned = CASE WHEN pinned=1 THEN 0 ELSE 1 END WHERE id=?').run(req.params.id);
      res.json({ id: req.params.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 重命名会话（更新 title）
  r.put('/sessions/:id', (req: Request, res: Response) => {
    try {
      const { title } = req.body || {};
      if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'title 必填' });
      const existing = getDb().prepare('SELECT id FROM sessions WHERE id=? AND deleted_at IS NULL').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'not found' });
      const finalTitle = title.trim().slice(0, 200);
      getDb().prepare("UPDATE sessions SET title=?, updated_at=datetime('now') WHERE id=?").run(finalTitle, req.params.id);
      res.json({ id: req.params.id, title: finalTitle });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 恢复被软删除的会话（供「删除」的撤销使用）
  r.post('/sessions/:id/restore', (req: Request, res: Response) => {
    try {
      const existing = getDb().prepare('SELECT id FROM sessions WHERE id=?').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'not found' });
      getDb().prepare("UPDATE sessions SET deleted_at=NULL, updated_at=datetime('now') WHERE id=?").run(req.params.id);
      res.json({ id: req.params.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 分享任务：将会话导出为 Markdown，并生成可复制的分享令牌
  r.post('/sessions/:id/share', (req: Request, res: Response) => {
    try {
      const s = getDb().prepare('SELECT * FROM sessions WHERE id=? AND deleted_at IS NULL').get(req.params.id) as { title: string } | undefined;
      if (!s) return res.status(404).json({ error: 'not found' });
      const msgs = getDb().prepare('SELECT role, content FROM messages WHERE session_id=? ORDER BY ts').all(req.params.id) as any[];
      const lines = [
        `# ${s.title}`,
        '',
        ...msgs.map((m: any) => `**${m.role === 'user' ? '用户' : 'studentbuddy'}**：\n${m.content}`),
        '',
        '---',
        `由 studentbuddy 导出 · ${new Date().toISOString()}`,
      ];
      const markdown = lines.join('\n');
      const token = crypto.randomUUID();
      getDb().prepare('INSERT INTO session_shares (token, session_id) VALUES (?, ?)').run(token, req.params.id);
      res.json({ token, url: `studentbuddy://share/${token}`, markdown });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
