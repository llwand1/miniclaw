import { Router, Request, Response } from 'express';
import { getDb } from '../../core/gateway/db';
import { Gateway } from '../../core/gateway';
import { createLogger } from '../../core/logger';
import { encryptSecret, decryptSecret } from '../../core/security/crypto';

const log = createLogger('api:providers');

/** 注册服务商 CRUD + 模型切换路由 */
export function registerProviders(r: Router, gw: Gateway): void {
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
      getDb().prepare('INSERT INTO providers (id,type,name,base_url,api_key,default_model) VALUES (?,?,?,?,?,?)').run(id, type, name, baseUrl, encryptSecret(apiKey), defaultModel);
      // 新服务商默认设为「当前使用」（单选：同一时刻仅一个服务商可用）
      gw.selectProvider(id);
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
      const finalKey = (apiKey && !apiKey.includes('...')) ? encryptSecret(apiKey) : old.api_key;
      getDb().prepare("UPDATE providers SET type=?,name=?,base_url=?,api_key=?,default_model=?,updated_at=datetime('now') WHERE id=?")
        .run(type || 'openai', name, baseUrl, finalKey, defaultModel, req.params.id);
      // 若当前使用的服务商改了默认模型，同步刷新「当前模型」
      const active = getDb().prepare('SELECT id FROM providers WHERE id=? AND enabled=1').get(req.params.id) as any;
      if (active && defaultModel) gw.setSelectedModel(String(req.params.id), defaultModel);
      res.json({ id: req.params.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  r.delete('/providers/:id', (req: Request, res: Response) => {
    try {
      const db = getDb();
      // token_usage 等表通过外键引用 providers，且未配置级联删除。
      // 数据库开启了 foreign_keys，直接删会触发 FOREIGN KEY constraint failed，
      // 导致「删除键」永远失败。这里先清理依赖记录，再删服务商。
      const agentCount = (db.prepare('SELECT COUNT(*) as c FROM agents WHERE provider_id=?').get(req.params.id) as any).c;
      if (agentCount > 0) {
        return res.status(400).json({ error: '该服务商正被智能体使用，请先删除相关智能体' });
      }
      // token_usage 仅记录用量统计，随服务商一起清理
      db.prepare('DELETE FROM token_usage WHERE provider_id=?').run(req.params.id);
      db.prepare('DELETE FROM providers WHERE id=?').run(req.params.id);
      // 删掉的是当前服务商时，自动把剩下的最新一个设为当前，避免出现「无可用服务商」
      const remaining = db.prepare('SELECT id FROM providers ORDER BY created_at ASC').get() as any;
      if (remaining) gw.selectProvider(remaining.id);
      res.json({ id: req.params.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 单选当前服务商（同一时刻仅一个服务商可用）
  r.put('/providers/:id/select', (req: Request, res: Response) => {
    try {
      gw.selectProvider(String(req.params.id));
      res.json({ id: req.params.id, ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 测试连通性（发一个最小请求到 providers API）
  r.post('/providers/:id/test', async (req: Request, res: Response) => {
    try {
      const p = getDb().prepare('SELECT * FROM providers WHERE id=?').get(req.params.id) as any;
      if (!p) return res.status(404).json({ error: 'not found' });
      const url = `${p.base_url}/chat/completions`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${decryptSecret(p.api_key)}` },
          body: JSON.stringify({ model: p.default_model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, stream: false }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (r.ok) {
          res.json({ ok: true, status: r.status });
        } else {
          const text = await r.text().catch(() => '');
          res.json({ ok: false, status: r.status, error: text.slice(0, 200) });
        }
      } catch (err: any) {
        clearTimeout(timer);
        res.json({ ok: false, error: err.name === 'AbortError' ? '连接超时（10s）' : err.message });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 模型切换：当前选中 + 可选列表
  r.get('/model', (_req: Request, res: Response) => {
    try { res.json(gw.getSelectedModel()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  r.put('/model', (req: Request, res: Response) => {
    try {
      const { providerId, model } = req.body || {};
      const p = gw.getProviderById(providerId);
      if (!p || !p.enabled) return res.status(400).json({ error: '服务商不存在或已禁用' });
      if (!model) return res.status(400).json({ error: 'model 必填' });
      gw.setSelectedModel(providerId, model);
      res.json({ ok: true, providerId, model });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  r.get('/model-options', async (_req: Request, res: Response) => {
    try { res.json(await gw.listModelOptions()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });
}
