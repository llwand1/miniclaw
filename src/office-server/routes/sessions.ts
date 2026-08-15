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
    res.json(getDb().prepare('SELECT * FROM sessions ORDER BY pinned DESC, updated_at DESC').all());
  });

  // 搜索历史对话：GET /api/search?q=关键词
  // 在 messages.content 里做 LIKE 匹配（中文友好，无需分词），join sessions 拿会话标题，
  // 返回命中的消息片段（带会话归属），供「搜索对话」入口展示并跳转。
  // 排除工具内部消息（role='tool'），最多返回 MAX_RESULTS 条，按时间倒序。
  r.get('/search', (req: Request, res: Response) => {
    try {
      const q = ((req.query.q as string) || '').trim();
      if (!q) return res.status(400).json({ error: 'q 必填' });
      const MAX_RESULTS = 30;
      // 取关键词前后各 60 字作为上下文片段
      const span = 60;
      // 安全转义 LIKE 特殊字符（% _ \），避免通配符注入；片段定位仍用原始 q（indexOf 是字面量匹配）
      const safeQ = q.replace(/[%_\\]/g, (c) => '\\' + c);
      const rows = getDb().prepare(`
        SELECT m.id, m.session_id, m.role, m.content, m.ts, s.title AS session_title
        FROM messages m LEFT JOIN sessions s ON s.id = m.session_id
        WHERE m.role IN ('user','assistant') AND m.content LIKE ?
        ORDER BY m.id DESC LIMIT ?
      `).all(`%${safeQ}%`, MAX_RESULTS) as any[];
      const results = rows.map((m: any) => {
        const content = String(m.content || '');
        const idx = content.indexOf(q);
        const start = Math.max(0, idx - span);
        const end = Math.min(content.length, idx + q.length + span);
        const snippet = (start > 0 ? '…' : '') + content.slice(start, end) + (end < content.length ? '…' : '');
        return {
          id: m.id,
          sessionId: m.session_id,
          sessionTitle: m.session_title || '新对话',
          role: m.role,
          snippet,
          ts: m.ts,
        };
      }).filter((m: any) => m.snippet);
      res.json({ query: q, count: results.length, results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 会话树：返回所有会话的父子树（根 + children + depth），供左侧树状历史渲染。
  // 兼容孤立节点：父会话已被删除的子会话自动提升为根，避免从树中消失。
  r.get('/sessions/tree', (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const all = db.prepare('SELECT * FROM sessions ORDER BY pinned DESC, updated_at DESC').all() as any[];
      const ids = new Set(all.map((s: any) => s.id));
      const byParent = new Map<string | null, any[]>();
      for (const s of all) {
        // 父会话已被删除（孤立子会话）→ 视为根节点
        const k = s.parent_id && ids.has(s.parent_id) ? s.parent_id : null;
        if (!byParent.has(k)) byParent.set(k, []);
        byParent.get(k)!.push(s);
      }
      const build = (parentId: string | null, depth: number): any[] =>
        (byParent.get(parentId) || []).map((s: any) => ({
          ...s,
          depth,
          children: build(s.id, depth + 1),
        }));
      res.json({ roots: build(null, 0) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  r.get('/sessions/:id', (req: Request, res: Response) => {
    const s = getDb().prepare('SELECT * FROM sessions WHERE id=?').get(req.params.id);
    if (!s) return res.status(404).json({ error: 'not found' });
    // 仅展示面向用户的对话消息：过滤工具内部消息（role='tool' 的工具结果，以及
    // 携带 tool_calls 的中间 assistant 消息——它们只是工具上下文的占位，气泡里内容为空）。
    const msgs = getDb().prepare(
      "SELECT * FROM messages WHERE session_id=? AND role != 'tool' AND (tool_calls IS NULL OR tool_calls='') ORDER BY ts"
    ).all(req.params.id);
    res.json({ session: s, messages: msgs });
  });

  // 会话实时状态快照：阶段 / 工具步骤 / 任务清单 / 思考过程。
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

  // 真删除会话：物理删除会话及其全部关联数据（消息 / 分享）。
  r.delete('/sessions/:id', (req: Request, res: Response) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT id FROM sessions WHERE id=?').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'not found' });
      const tx = db.transaction((sid: string) => {
        db.prepare('DELETE FROM messages WHERE session_id=?').run(sid);
        db.prepare('DELETE FROM session_shares WHERE session_id=?').run(sid);
        db.prepare('DELETE FROM sessions WHERE id=?').run(sid);
      });
      tx(req.params.id as string);
      res.json({ id: req.params.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 清空全部对话数据：物理删除所有会话及其关联的消息 / 分享。
  r.delete('/sessions', (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const tx = db.transaction(() => {
        db.prepare('DELETE FROM messages').run();
        db.prepare('DELETE FROM session_shares').run();
        db.prepare('DELETE FROM sessions').run();
      });
      tx();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 置顶 / 取消置顶（切换 pinned）
  r.put('/sessions/:id/pin', (req: Request, res: Response) => {
    try {
      const existing = getDb().prepare('SELECT id FROM sessions WHERE id=?').get(req.params.id);
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
      const existing = getDb().prepare('SELECT id FROM sessions WHERE id=?').get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'not found' });
      const finalTitle = title.trim().slice(0, 200);
      getDb().prepare("UPDATE sessions SET title=?, updated_at=datetime('now') WHERE id=?").run(finalTitle, req.params.id);
      res.json({ id: req.params.id, title: finalTitle });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 派生子对话（fork）：以某会话为父，创建独立子会话并继承父会话全部历史。
  // 用途：针对父对话中某个需求（如某道题解析、薄弱点继续出题）展开新的独立分支。
  // 子会话继承 parent_id/root_id 形成树状历史；消息完整复制（含工具消息），
  // 子对话可独立演进，不干扰父对话。
  r.post('/sessions/:id/fork', (req: Request, res: Response) => {
    try {
      const db = getDb();
      const parent = db.prepare('SELECT * FROM sessions WHERE id=?').get(req.params.id) as any;
      if (!parent) return res.status(404).json({ error: 'not found' });
      const { title } = req.body || {};
      const childId = `s-${crypto.randomUUID()}`;
      const rootId = parent.root_id || parent.id;
      // 默认标题：父标题 + 序号后缀（若已存在同名分支则递增），保证树里可区分
      let finalTitle = (typeof title === 'string' && title.trim())
        ? title.trim().slice(0, 200)
        : `${parent.title || '新对话'} · 分支`;
      if (!title) {
        const siblings = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE parent_id=?').get(parent.id) as { n: number };
        if (siblings.n > 0) finalTitle = `${parent.title || '新对话'} · 分支 ${siblings.n + 1}`;
      }
      const tx = db.transaction(() => {
        // 1) 建子会话（继承 parent/root 关系）
        db.prepare("INSERT INTO sessions (id,agent_id,source,title,parent_id,root_id) VALUES (?,?,?,?,?,?)")
          .run(childId, parent.agent_id || 'default', parent.source || 'main', finalTitle, parent.id, rootId);
        // 2) 复制父会话全部消息历史（含 tool_call_id/tool_calls/reasoning，保证追问与回放一致）
        db.prepare(`INSERT INTO messages (session_id, role, content, tokens, reasoning, model, tool_call_id, tool_calls, ts)
          SELECT ?, role, content, tokens, reasoning, model, tool_call_id, tool_calls, ts FROM messages WHERE session_id=?`)
          .run(childId, parent.id);
      });
      tx();
      res.json({ id: childId, title: finalTitle, parentId: parent.id, rootId, parentTitle: parent.title || '' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 分享任务：将会话导出为 Markdown，并生成可复制的分享令牌
  r.post('/sessions/:id/share', (req: Request, res: Response) => {
    try {
      const s = getDb().prepare('SELECT * FROM sessions WHERE id=?').get(req.params.id) as { title: string } | undefined;
      if (!s) return res.status(404).json({ error: 'not found' });
      const msgs = getDb().prepare(
        "SELECT role, content FROM messages WHERE session_id=? AND role != 'tool' AND (tool_calls IS NULL OR tool_calls='') ORDER BY ts"
      ).all(req.params.id) as any[];
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
