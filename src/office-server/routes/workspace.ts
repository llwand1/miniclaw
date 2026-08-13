import { Router, Request, Response } from 'express';
import { getDb } from '../../core/gateway/db';
import { Gateway, DEFAULT_SYSTEM_PROMPT } from '../../core/gateway';
import { searchWeb } from '../../core/search';
import { getWorkspaceRoot, setWorkspaceRoot, fsList, fsRead, fsGrep, fsRevert, listChanges } from '../../core/fs-tools';
import { encryptSecret } from '../../core/security/crypto';

/** 注册搜索配置 / 工作区与文件系统 / 系统提示词 / 手动搜索 / 窗口状态路由 */
export function registerWorkspace(r: Router, gw: Gateway): void {
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
      const finalKey = (customApiKey && !customApiKey.includes('...')) ? encryptSecret(customApiKey) : (old?.custom_api_key || '');
      getDb().prepare("UPDATE search_config SET enabled=?,provider=?,custom_api_url=?,custom_api_key=?,updated_at=datetime('now') WHERE id=1")
        .run(enabled ? 1 : 0, provider || 'duckduckgo', customApiUrl || '', finalKey);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 工作区与文件系统 API ──────────────────────────────────
  // 工作区根目录：GET 返回当前配置（绝对路径或 null），PUT 设置并校验存在。
  r.get('/workspace', (_req: Request, res: Response) => {
    try { res.json({ root: getWorkspaceRoot() }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  r.put('/workspace', (req: Request, res: Response) => {
    try {
      const { path } = req.body || {};
      // 允许传空字符串「关闭工作区」（清空配置，恢复纯对话直接流式，不再走文件工具规划阶段）
      if (typeof path === 'string' && path.trim() === '') {
        getDb().prepare("INSERT INTO app_settings (key,value) VALUES ('workspace_root','') ON CONFLICT(key) DO UPDATE SET value='', updated_at=datetime('now')").run();
        return res.json({ ok: true, root: null });
      }
      if (typeof path !== 'string' || !path.trim()) return res.status(400).json({ error: 'path 必填' });
      const abs = setWorkspaceRoot(path.trim());
      res.json({ ok: true, root: abs });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  // 目录树：GET /api/fs/tree?path=相对路径（默认根）
  r.get('/fs/tree', (req: Request, res: Response) => {
    try {
      const rel = (req.query.path as string) || '.';
      const nodes = fsList(rel);
      res.json({ root: getWorkspaceRoot(), path: rel, nodes });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  // 读取文件：GET /api/fs/read?path=相对路径
  r.get('/fs/read', (req: Request, res: Response) => {
    try {
      const rel = (req.query.path as string) || '';
      if (!rel) return res.status(400).json({ error: 'path 必填' });
      const r2 = fsRead(rel);
      res.json({ path: rel, ...r2 });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  // 文本搜索：GET /api/fs/grep?pattern=...&path=...
  r.get('/fs/grep', (req: Request, res: Response) => {
    try {
      const pattern = (req.query.pattern as string) || '';
      const rel = (req.query.path as string) || '.';
      if (!pattern) return res.status(400).json({ error: 'pattern 必填' });
      const g = fsGrep(pattern, rel);
      res.json({ pattern, path: rel, ...g });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  // 撤销文件变更：POST /api/fs/revert  { changeId }
  r.post('/fs/revert', (req: Request, res: Response) => {
    try {
      const { changeId } = req.body || {};
      if (typeof changeId !== 'string' || !changeId) return res.status(400).json({ error: 'changeId 必填' });
      fsRevert(changeId);
      res.json({ ok: true });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  // 查看所有变更（全局）：返回内存中记录的 AI 文件变更，供「查看所有变更」面板聚合展示
  r.get('/fs/changes', (_req: Request, res: Response) => {
    try {
      res.json({ changes: listChanges() });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // 系统提示词：返回「用户自定义值 + 是否在用默认」
  r.get('/system-prompt', (_req: Request, res: Response) => {
    try {
      res.json({
        custom: gw.getCustomSystemPrompt(),
        default: DEFAULT_SYSTEM_PROMPT,
        preview: gw.buildSystemPrompt(),
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // 保存自定义系统提示词（传空字符串 = 恢复使用默认）
  r.put('/system-prompt', (req: Request, res: Response) => {
    try {
      const { content } = req.body || {};
      if (typeof content !== 'string') return res.status(400).json({ error: 'content 必须是字符串' });
      gw.setCustomSystemPrompt(content);
      res.json({ ok: true, preview: gw.buildSystemPrompt() });
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
}
