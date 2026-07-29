import { Router, Request, Response } from 'express';
import { getDb } from '../../core/gateway/db';
import { Gateway } from '../../core/gateway';
import { searchWeb } from '../../core/search';
import { createLogger } from '../../core/logger';
const log = createLogger('api');

export function createApiRouter(gw: Gateway): Router {
  const r = Router();

  // 状态检查
  r.get('/status', (_req: Request, res: Response) => {
    const hasProviders = !!getDb().prepare('SELECT id FROM providers LIMIT 1').get();
    res.json({ hasProviders });
  });

  // 会话
  r.get('/sessions', (_req: Request, res: Response) => {
    res.json(getDb().prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all());
  });

  r.get('/sessions/:id', (req: Request, res: Response) => {
    const s = getDb().prepare('SELECT * FROM sessions WHERE id=?').get(req.params.id);
    if (!s) return res.status(404).json({ error: 'not found' });
    const msgs = getDb().prepare('SELECT * FROM messages WHERE session_id=? ORDER BY ts').all(req.params.id);
    res.json({ session: s, messages: msgs });
  });

  // 服务商
  r.get('/providers', (_req: Request, res: Response) => {
    const list = getDb().prepare('SELECT * FROM providers').all() as any[];
    res.json(list.map((p: any) => ({
      ...p, api_key: p.api_key ? p.api_key.slice(0, 6) + '...' + p.api_key.slice(-4) : '',
    })));
  });

  r.post('/providers', (req: Request, res: Response) => {
    try {
      const { type, name, baseUrl, apiKey, defaultModel } = req.body;
      if (!name || !apiKey) return res.status(400).json({ error: '名称和 API Key 不能为空' });
      const id = `p-${Date.now()}`;
      getDb().prepare('INSERT INTO providers (id,type,name,base_url,api_key,default_model) VALUES (?,?,?,?,?,?)').run(id, type, name, baseUrl, apiKey, defaultModel);
      log.info(`Provider created: ${id}`);
      res.json({ id });
    } catch (err: any) {
      log.error({ error: err.message }, 'Create provider failed');
      res.status(500).json({ error: err.message });
    }
  });

  r.put('/providers/:id', (req: Request, res: Response) => {
    try {
      const old = getDb().prepare('SELECT api_key FROM providers WHERE id=?').get(req.params.id) as any;
      if (!old) return res.status(404).json({ error: 'not found' });
      const { name, baseUrl, apiKey, defaultModel, type } = req.body;
      const finalKey = (apiKey && !apiKey.includes('...')) ? apiKey : old.api_key;
      getDb().prepare("UPDATE providers SET type=?,name=?,base_url=?,api_key=?,default_model=?,updated_at=datetime('now') WHERE id=?")
        .run(type || 'openai', name, baseUrl, finalKey, defaultModel, req.params.id);
      res.json({ id: req.params.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  r.delete('/providers/:id', (req: Request, res: Response) => {
    try {
      getDb().prepare('DELETE FROM providers WHERE id=?').run(req.params.id);
      res.json({ id: req.params.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 长期记忆
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

  // 对话
  r.post('/chat', async (req: Request, res: Response) => {
    const { text, sessionId, source, temperature } = req.body;
    try {
      const sid = await gw.handleMessage({ source: source || 'main', sessionId, text, temperature });
      res.json({ sessionId: sid });
    } catch (err: any) {
      log.error({ error: err.message }, 'Chat error');
      res.status(500).json({ error: err.message });
    }
  });

  // 搜索配置
  r.get('/search-config', (_req: Request, res: Response) => {
    try {
      const row = getDb().prepare('SELECT * FROM search_config WHERE id = 1').get() || { enabled: 0, provider: 'duckduckgo', custom_api_url: '', custom_api_key: '' };
      res.json(row);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  r.put('/search-config', (req: Request, res: Response) => {
    try {
      const { enabled, provider, customApiUrl, customApiKey } = req.body;
      if (provider && !['duckduckgo', 'custom'].includes(provider)) return res.status(400).json({ error: '不支持的搜索服务商' });
      const old = getDb().prepare('SELECT custom_api_key FROM search_config WHERE id = 1').get() as any;
      const finalKey = (customApiKey && !customApiKey.includes('...')) ? customApiKey : (old?.custom_api_key || '');
      getDb().prepare("UPDATE search_config SET enabled=?,provider=?,custom_api_url=?,custom_api_key=?,updated_at=datetime('now') WHERE id=1")
        .run(enabled ? 1 : 0, provider || 'duckduckgo', customApiUrl || '', finalKey);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // 手动搜索（供前端测试用）
  r.get('/search', async (req: Request, res: Response) => {
    try {
      const q = req.query.q as string;
      if (!q) return res.status(400).json({ error: 'q 参数不能为空' });
      const result = await searchWeb(q);
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // 窗口状态（悬浮窗位置等持久化，修复 P1-3）
  r.get('/window-state/:name', (req: Request, res: Response) => {
    const row = getDb().prepare('SELECT * FROM window_state WHERE name=?').get(req.params.name);
    res.json(row || {});
  });
  r.put('/window-state/:name', (req: Request, res: Response) => {
    try {
      const { x, y, visible, collapsed } = req.body;
      const exists = getDb().prepare('SELECT name FROM window_state WHERE name=?').get(req.params.name);
      if (exists) {
        getDb().prepare('UPDATE window_state SET x=?,y=?,visible=?,collapsed=? WHERE name=?')
          .run(x ?? 0, y ?? 0, visible ?? 1, collapsed ?? 0, req.params.name);
      } else {
        getDb().prepare('INSERT INTO window_state (name,x,y,visible,collapsed) VALUES (?,?,?,?,?)')
          .run(req.params.name, x ?? 0, y ?? 0, visible ?? 1, collapsed ?? 0);
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return r;
}
