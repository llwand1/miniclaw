import { Router, Request, Response } from 'express';
import { getDb } from '../../core/gateway/db';
import { previewService } from '../../core/preview';
import { renderArtifactToHtml } from '../../core/artifact';

/** 注册预览子系统路由（纯 Web：内存索引 + HTML 导出，无 Electron 原生视图） */
export function registerPreview(r: Router): void {
  // 列出当前所有 artifact（前端首屏 / 刷新后同步用）
  r.get('/preview/list', (_req: Request, res: Response) => {
    try { res.json({ artifacts: previewService.listArtifacts() }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // 以完整 HTML 返回某个 artifact，便于在系统浏览器中打开
  r.get('/preview/file/:id', (req: Request, res: Response) => {
    try {
      const a = previewService.getArtifact(String(req.params.id));
      if (!a) return res.status(404).json({ error: 'not found' });
      res.type('html').send(renderArtifactToHtml(a));
    } catch (err: any) { res.status(500).send(err.message); }
  });

  // 直接推一段 HTML（兼容旧编辑器；内部转成临时 artifact）
  r.post('/preview/html', async (req: Request, res: Response) => {
    try {
      const { html, sessionId } = req.body || {};
      if (typeof html !== 'string') return res.status(400).json({ error: 'html 必须是字符串' });
      const id = await previewService.pushHtml(html, sessionId || 'ad-hoc');
      res.json({ ok: true, id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 局部更新 artifact（如用户在编辑器里改了内容）
  r.post('/preview/update', async (req: Request, res: Response) => {
    try {
      const { id, content, title, devServerUrl } = req.body || {};
      if (typeof id !== 'string') return res.status(400).json({ error: 'id 必填' });
      await previewService.patchArtifact(id, { content, title, devServerUrl });
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // 简易 Trace：查询某会话最近若干次请求的调用瀑布（刷新/回看用）
  r.get('/traces', (req: Request, res: Response) => {
    try {
      const sid = (req.query.sessionId as string) || '';
      const db = getDb();
      const traces = db.prepare('SELECT * FROM traces WHERE session_id=? ORDER BY started_at DESC LIMIT 20').all(sid) as any[];
      const out = traces.map((t: any) => {
        const spans = db.prepare('SELECT * FROM spans WHERE trace_id=? ORDER BY started_at ASC').all(t.trace_id) as any[];
        return {
          ...t,
          spans: spans.map((s: any) => ({ ...s, attrs: JSON.parse(s.attrs || '{}') })),
        };
      });
      res.json({ traces: out });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
