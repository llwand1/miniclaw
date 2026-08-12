import { Router, Request, Response } from 'express';
import { getDb } from '../../core/gateway/db';
import { Gateway } from '../../core/gateway';
import { DEFAULT_SYSTEM_PROMPT } from '../../core/gateway';
import { searchWeb } from '../../core/search';
import { createLogger } from '../../core/logger';
import { previewService } from '../../core/preview';
import { renderArtifactToHtml } from '../../core/artifact';
import { getWorkspaceRoot, setWorkspaceRoot, fsList, fsRead, fsGrep, fsRevert, listChanges } from '../../core/fs-tools';
import { getOwnUsageStats, getCcSwitchUsage, syncCcSwitchProviders, getCcSwitchDbPath, setCcSwitchDbPath } from '../../core/usage';
import crypto from 'node:crypto';
import {
  writeLocalSkillFile,
  readSkillFile,
  updateLocalSkillFile,
  listWorkbuddySkills,
  removeSkillFile,
  exportSkillToWorkbuddy,
} from '../../core/skills';
import { getPolicy, setPolicy } from '../../core/security/policy';
import { listPendingApprovals, listAllApprovals, approveItem, rejectItem, getApprovalStats } from '../../core/security/approval';
import { encryptSecret } from '../../core/security/crypto';
const log = createLogger('api');

// SHA-256 for PKCE
async function sha256(buffer: Buffer): Promise<Buffer> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(buffer).digest();
}
function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 从数据库读取 GitHub Client ID
function getGithubClientId(): string {
  const row = getDb().prepare('SELECT client_id FROM github_oauth_config WHERE id=1').get() as any;
  return row?.client_id || '';
}

export function createApiRouter(gw: Gateway): Router {
  const r = Router();

  // ─── GitHub OAuth (PKCE, 无需 client_secret) ────────────────
  const pendingStates = new Map<string, { verifier: string; ts: number }>();
  const REDIRECT_URI = 'http://localhost:18791/auth/github/callback';

  // 获取 GitHub Client ID
  r.get('/auth/github/config', (_req: Request, res: Response) => {
    const clientId = getGithubClientId();
    res.json({ clientId: clientId || '' });
  });

  // 保存 GitHub Client ID
  r.put('/auth/github/config', (req: Request, res: Response) => {
    try {
      const { clientId } = req.body;
      if (!clientId) return res.status(400).json({ error: 'Client ID 不能为空' });
      getDb().prepare("UPDATE github_oauth_config SET client_id=?,updated_at=datetime('now') WHERE id=1").run(clientId);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // 发起 GitHub 授权（PKCE: 生成 code_verifier + code_challenge）
  r.get('/auth/github', async (_req: Request, res: Response) => {
    const clientId = getGithubClientId();
    if (!clientId) return res.status(400).json({ error: '请先配置 GitHub Client ID' });
    // 生成 code_verifier (43-128 chars, URL-safe)
    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(await sha256(Buffer.from(verifier)));
    const state = crypto.randomBytes(16).toString('hex');
    pendingStates.set(state, { verifier, ts: Date.now() });
    setTimeout(() => pendingStates.delete(state), 600_000);
    const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=repo%20read:user%20user:email&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`;
    res.json({ url });
  });

  // GitHub 回调 → 用 code + code_verifier 换 token（无 client_secret）
  r.get('/auth/github/callback', async (req: Request, res: Response) => {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) return res.status(400).send('缺少 code 或 state 参数');
    const entry = pendingStates.get(state);
    if (!entry) return res.status(400).send('state 无效或已过期');
    pendingStates.delete(state);
    try {
      const clientId = getGithubClientId();
      // 用 code + code_verifier 换 token（PKCE，不需要 client_secret）
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ client_id: clientId, code, redirect_uri: REDIRECT_URI, code_verifier: entry.verifier }),
      });
      const tokenData = await tokenRes.json() as any;
      if (tokenData.error) return res.status(400).send(`GitHub 错误: ${tokenData.error_description || tokenData.error}`);
      const accessToken = tokenData.access_token;
      // 获取用户信息
      const userRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
      });
      const ghUser = await userRes.json() as any;
      if (!ghUser.id) return res.status(400).send('获取 GitHub 用户信息失败');
      // 写入 / 更新数据库
      const db = getDb();
      const userId = `u-${ghUser.id}`;
      const existing = db.prepare('SELECT id FROM users WHERE github_id=?').get(ghUser.id) as any;
      if (existing) {
        db.prepare("UPDATE users SET username=?,display_name=?,avatar_url=?,email=?,updated_at=datetime('now') WHERE github_id=?")
          .run(ghUser.login, ghUser.name || '', ghUser.avatar_url || '', ghUser.email || '', ghUser.id);
      } else {
        db.prepare('INSERT INTO users (id,github_id,username,display_name,avatar_url,email) VALUES (?,?,?,?,?,?)')
          .run(userId, ghUser.id, ghUser.login, ghUser.name || '', ghUser.avatar_url || '', ghUser.email || '');
      }
      const tokenId = `gt-${Date.now()}`;
      db.prepare('DELETE FROM github_tokens WHERE user_id=?').run(userId);
      db.prepare('INSERT INTO github_tokens (id,user_id,access_token,scope,token_type) VALUES (?,?,?,?,?)')
        .run(tokenId, userId, encryptSecret(accessToken), tokenData.scope || '', tokenData.token_type || 'bearer');
      log.info(`GitHub 登录成功: ${ghUser.login}`);
      res.send(`<script>window.opener?.postMessage({github:'ok',user:${JSON.stringify({login:ghUser.login,avatar:ghUser.avatar_url})}},'*');window.close();document.write('<h2>✅ ${ghUser.login}，授权成功，可关闭此页</h2>')</script>`);
    } catch (err: any) {
      log.error({ error: err.message }, 'GitHub OAuth failed');
      res.status(500).send(`授权失败: ${err.message}`);
    }
  });

  // 获取当前 GitHub 登录状态
  r.get('/auth/github/status', (_req: Request, res: Response) => {
    try {
      const row = getDb().prepare(`
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.email, t.scope
        FROM users u JOIN github_tokens t ON u.id = t.user_id
        ORDER BY t.created_at DESC LIMIT 1
      `).get() as any;
      if (!row) return res.json({ loggedIn: false });
      res.json({ loggedIn: true, user: { id: row.id, username: row.username, displayName: row.display_name, avatarUrl: row.avatar_url, email: row.email, scope: row.scope } });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // 断开 GitHub 授权
  r.post('/auth/github/logout', (_req: Request, res: Response) => {
    try {
      const row = getDb().prepare('SELECT user_id FROM github_tokens ORDER BY created_at DESC LIMIT 1').get() as any;
      if (row) {
        getDb().prepare('DELETE FROM github_tokens WHERE user_id=?').run(row.user_id);
        getDb().prepare('DELETE FROM users WHERE id=?').run(row.user_id);
      }
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // 获取 GitHub access_token（供内部使用，如搜索 GitHub）
  r.get('/auth/github/token', (_req: Request, res: Response) => {
    try {
      const row = getDb().prepare('SELECT access_token FROM github_tokens ORDER BY created_at DESC LIMIT 1').get() as any;
      if (!row) return res.status(401).json({ error: '未登录 GitHub' });
      res.json({ token: row.access_token });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 微信 OAuth（开放平台网站应用扫码登录）────────────────────
  function getWechatConfig(): { appId: string; appSecret: string; redirectUri: string } {
    const row = getDb().prepare('SELECT app_id, app_secret, redirect_uri FROM wechat_oauth_config WHERE id=1').get() as any;
    return {
      appId: row?.app_id || '',
      appSecret: row?.app_secret || '',
      redirectUri: row?.redirect_uri || 'http://localhost:18791/auth/wechat/callback',
    };
  }

  // 获取微信 OAuth 配置（不返回 app_secret）
  r.get('/auth/wechat/config', (_req: Request, res: Response) => {
    const { appId, redirectUri } = getWechatConfig();
    res.json({ appId: appId || '', redirectUri });
  });

  // 保存微信 OAuth 配置
  r.put('/auth/wechat/config', (req: Request, res: Response) => {
    try {
      const { appId, appSecret, redirectUri } = req.body;
      if (!appId || !appSecret) return res.status(400).json({ error: 'AppID 和 AppSecret 不能为空' });
      getDb().prepare("UPDATE wechat_oauth_config SET app_id=?,app_secret=?,redirect_uri=?,updated_at=datetime('now') WHERE id=1")
        .run(appId, encryptSecret(appSecret), redirectUri || 'http://localhost:18791/auth/wechat/callback');
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // 发起微信扫码授权（生成 authorize URL，前端用 iframe/新窗口打开）
  r.get('/auth/wechat', (_req: Request, res: Response) => {
    const { appId, redirectUri } = getWechatConfig();
    if (!appId) return res.status(400).json({ error: '请先配置微信 AppID 和 AppSecret' });
    // 微信开放平台网站应用授权 URL
    const url = `https://open.weixin.qq.com/connect/qrconnect?appid=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=snsapi_login&state=miniclaw#wechat_redirect`;
    res.json({ url });
  });

  // 微信回调：code → access_token → 用户信息 → 落库
  r.get('/auth/wechat/callback', async (req: Request, res: Response) => {
    const { code } = req.query as { code?: string };
    if (!code) return res.status(400).send('缺少 code 参数');
    const { appId, appSecret, redirectUri } = getWechatConfig();
    if (!appId || !appSecret) return res.status(400).send('微信 OAuth 未配置');
    try {
      // 1. code 换 access_token
      const tokenRes = await fetch(
        `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${appId}&secret=${appSecret}&code=${code}&grant_type=authorization_code`,
      );
      const tokenData = await tokenRes.json() as any;
      if (tokenData.errcode) return res.status(400).send(`微信错误: ${tokenData.errmsg || tokenData.errcode}`);
      const { access_token, refresh_token, expires_in, openid, unionid, scope } = tokenData;
      if (!access_token || !openid) return res.status(400).send('获取微信 access_token 失败');

      // 2. 拉用户信息（snsapi_login scope）
      const userRes = await fetch(
        `https://api.weixin.qq.com/sns/userinfo?access_token=${access_token}&openid=${openid}`,
      );
      const wxUser = await userRes.json() as any;
      if (wxUser.errcode) return res.status(400).send(`微信错误: ${wxUser.errmsg || wxUser.errcode}`);

      // 3. 写入 / 更新数据库（按 unionid upsert，无 unionid 退回 openid）
      const db = getDb();
      const unionKey = unionid || openid;
      const existing = db.prepare('SELECT id FROM users WHERE wechat_unionid=?').get(unionKey) as any
        || (!unionid && (db.prepare('SELECT id FROM users WHERE wechat_openid=?').get(openid) as any));
      const userId = existing?.id || `u-wx-${Date.now()}`;
      const nickname = wxUser.nickname || '微信用户';
      if (existing) {
        db.prepare("UPDATE users SET username=?,display_name=?,avatar_url=?,wechat_unionid=?,wechat_openid=?,updated_at=datetime('now') WHERE id=?")
          .run(nickname, nickname, wxUser.headimgurl || '', unionid || null, openid, existing.id);
      } else {
        db.prepare('INSERT INTO users (id,github_id,username,display_name,avatar_url,wechat_unionid,wechat_openid) VALUES (?,?,?,?,?,?,?,?)')
          .run(userId, 0, nickname, nickname, wxUser.headimgurl || '', unionid || null, openid);
      }
      // 4. 缓存 token（先删后插，保持 user_id 唯一）
      db.prepare('DELETE FROM wechat_tokens WHERE user_id=?').run(existing?.id || userId);
      db.prepare('INSERT INTO wechat_tokens (id,user_id,access_token,refresh_token,expires_in,openid,unionid,scope) VALUES (?,?,?,?,?,?,?,?)')
        .run(`wt-${Date.now()}`, existing?.id || userId, encryptSecret(access_token), encryptSecret(refresh_token || ''), expires_in || 7200, openid, unionid || null, scope || 'snsapi_login');
      log.info(`微信登录成功: ${nickname}`);
      res.send(`<script>window.opener?.postMessage({wechat:'ok',user:${JSON.stringify({ nickname, avatar: wxUser.headimgurl || '' })}},'*');window.close();document.write('<h2>✅ ${nickname}，授权成功，可关闭此页</h2>')</script>`);
    } catch (err: any) {
      log.error({ error: err.message }, 'WeChat OAuth failed');
      res.status(500).send(`授权失败: ${err.message}`);
    }
  });

  // 获取当前微信登录状态
  r.get('/auth/wechat/status', (_req: Request, res: Response) => {
    try {
      const row = getDb().prepare(`
        SELECT u.id, u.username, u.display_name, u.avatar_url, t.scope, t.openid, t.unionid
        FROM users u JOIN wechat_tokens t ON u.id = t.user_id
        ORDER BY t.created_at DESC LIMIT 1
      `).get() as any;
      if (!row) return res.json({ loggedIn: false });
      res.json({
        loggedIn: true,
        user: {
          id: row.id,
          username: row.username,
          displayName: row.display_name,
          avatarUrl: row.avatar_url,
          scope: row.scope,
          openid: row.openid,
          unionid: row.unionid,
        },
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // 断开微信授权
  r.post('/auth/wechat/logout', (_req: Request, res: Response) => {
    try {
      const row = getDb().prepare('SELECT user_id FROM wechat_tokens ORDER BY created_at DESC LIMIT 1').get() as any;
      if (row) {
        getDb().prepare('DELETE FROM wechat_tokens WHERE user_id=?').run(row.user_id);
        // 微信用户可能没有 GitHub 绑定，单独清理
        const u = getDb().prepare('SELECT github_id FROM users WHERE id=?').get(row.user_id) as any;
        if (u && !u.github_id) getDb().prepare('DELETE FROM users WHERE id=?').run(row.user_id);
      }
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

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
        ...msgs.map((m: any) => `**${m.role === 'user' ? '用户' : 'MiniClaw'}**：\n${m.content}`),
        '',
        '---',
        `由 MiniClaw 导出 · ${new Date().toISOString()}`,
      ];
      const markdown = lines.join('\n');
      const token = crypto.randomUUID();
      getDb().prepare('INSERT INTO session_shares (token, session_id) VALUES (?, ?)').run(token, req.params.id);
      res.json({ token, url: `miniclaw://share/${token}`, markdown });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
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
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p.api_key}` },
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

  // ─── 技能（Skills，与 WorkBuddy 文件格式互通）─────────────────
  // 列表（不含正文，减负）：id/name/description/enabled/source/created_at
  r.get('/skills', (_req: Request, res: Response) => {
    try {
      const list = getDb().prepare(
        'SELECT id,name,description,enabled,source,created_at FROM skills ORDER BY name',
      ).all();
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 详情 + 正文（按 path 读 SKILL.md）
  r.get('/skills/:id', (req: Request, res: Response) => {
    try {
      const s = getDb().prepare('SELECT * FROM skills WHERE id=?').get(req.params.id) as any;
      if (!s) return res.status(404).json({ error: 'not found' });
      const meta = readSkillFile(s.path);
      res.json({ ...s, content: meta?.content || '' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 新建（写 DB + 落本地 SKILL.md，source=local）
  r.post('/skills', (req: Request, res: Response) => {
    try {
      const { name, description, content } = req.body || {};
      if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name 必填' });
      const safeName = name.trim().slice(0, 80);
      const desc = (typeof description === 'string' ? description : '').slice(0, 500);
      const body = typeof content === 'string' ? content : '';
      const fp = writeLocalSkillFile(safeName, desc, body);
      const id = `sk-${crypto.randomUUID()}`;
      getDb().prepare("INSERT INTO skills (id,name,description,path,enabled,source) VALUES (?,?,?,?,1,'local')")
        .run(id, safeName, desc, fp);
      res.json({ id, name: safeName, description: desc, path: fp, enabled: 1, source: 'local' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 更新（改名/描述/正文/启停）
  r.put('/skills/:id', (req: Request, res: Response) => {
    try {
      const s = getDb().prepare('SELECT * FROM skills WHERE id=?').get(req.params.id) as any;
      if (!s) return res.status(404).json({ error: 'not found' });
      const { name, description, content, enabled } = req.body || {};
      const newName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : s.name;
      const newDesc = typeof description === 'string' ? description.slice(0, 500) : s.description;
      const newEnabled = typeof enabled === 'number' ? (enabled ? 1 : 0) : s.enabled;

      if (s.source === 'workbuddy') {
        // 只读引用：不覆盖 WorkBuddy 原文件。若用户改了正文 → 派生为本地 imported 副本。
        if (typeof content === 'string' && content !== (readSkillFile(s.path)?.content || '')) {
          const fp = writeLocalSkillFile(newName, newDesc, content);
          getDb().prepare("UPDATE skills SET name=?,description=?,path=?,enabled=?,source='imported' WHERE id=?")
            .run(newName, newDesc, fp, newEnabled, req.params.id);
          return res.json({ id: req.params.id, name: newName, description: newDesc, enabled: newEnabled, source: 'imported', forked: true });
        }
        getDb().prepare('UPDATE skills SET name=?,description=?,enabled=? WHERE id=?')
          .run(newName, newDesc, newEnabled, req.params.id);
        return res.json({ id: req.params.id, name: newName, description: newDesc, enabled: newEnabled, source: 'workbuddy' });
      }

      // local / imported：正文落盘（改名时重写到新目录并清理旧目录）
      if (typeof content === 'string') {
        const fp = updateLocalSkillFile(s.path, newName, newDesc, content);
        getDb().prepare("UPDATE skills SET name=?,description=?,path=?,enabled=? WHERE id=?")
          .run(newName, newDesc, fp, newEnabled, req.params.id);
      } else {
        getDb().prepare('UPDATE skills SET name=?,description=?,enabled=? WHERE id=?')
          .run(newName, newDesc, newEnabled, req.params.id);
      }
      res.json({ id: req.params.id, name: newName, description: newDesc, enabled: newEnabled, source: s.source });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 删除：local/imported 删 DB + 删本地文件；workbuddy 只删 DB 行（保留原文件）
  r.delete('/skills/:id', (req: Request, res: Response) => {
    try {
      const s = getDb().prepare('SELECT * FROM skills WHERE id=?').get(req.params.id) as any;
      if (!s) return res.status(404).json({ error: 'not found' });
      if (s.source !== 'workbuddy') removeSkillFile(s.path);
      getDb().prepare('DELETE FROM skills WHERE id=?').run(req.params.id);
      res.json({ id: req.params.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 从 WorkBuddy 一键导入：扫描 ~/.workbuddy/skills，登记进 DB（source=workbuddy，默认禁用）
  r.post('/skills/import', (_req: Request, res: Response) => {
    try {
      const wb = listWorkbuddySkills();
      const db = getDb();
      let added = 0;
      let skipped = 0;
      for (const m of wb) {
        const exists = db.prepare('SELECT id FROM skills WHERE path=?').get(m.path);
        if (exists) { skipped++; continue; }
        const id = `sk-${crypto.randomUUID()}`;
        db.prepare("INSERT INTO skills (id,name,description,path,enabled,source) VALUES (?,?,?,?,0,'workbuddy')")
          .run(id, m.name, m.description, m.path);
        added++;
      }
      res.json({ added, skipped, total: wb.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 导出到 WorkBuddy：把 MiniClaw 技能写成 ~/.workbuddy/skills/<name>/SKILL.md
  r.post('/skills/:id/export', (req: Request, res: Response) => {
    try {
      const s = getDb().prepare('SELECT * FROM skills WHERE id=?').get(req.params.id) as any;
      if (!s) return res.status(404).json({ error: 'not found' });
      const meta = readSkillFile(s.path);
      if (!meta) return res.status(404).json({ error: 'skill 文件不存在' });
      const target = exportSkillToWorkbuddy(meta.name, meta.description, meta.content);
      res.json({ ok: true, path: target });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 对话
  r.post('/chat', async (req: Request, res: Response) => {
    const { text, sessionId, source, temperature, providerId, model, resend, skillNames, attachments } = req.body;
    try {
      const sid = await gw.handleMessage({ source: source || 'main', sessionId, text, temperature, providerId, model, resend: !!resend, skillNames: Array.isArray(skillNames) ? skillNames : undefined, attachments: Array.isArray(attachments) ? attachments : undefined });
      res.json({ sessionId: sid });
    } catch (err: any) {
      if (err.message === '__ABORTED__') return res.json({ sessionId, aborted: true });
      log.error({ error: err.message }, 'Chat error');
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

  // 中止对话
  r.post('/chat/abort', (req: Request, res: Response) => {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId 不能为空' });
    const ok = gw.abort(sessionId);
    res.json({ ok });
  });

  // 需求澄清回复（grill-me）：模型 [ASK:...] 挂起后，用户从澄清卡片选择/输入答案，
  // 提交到此端点，网关把选择写入历史并恢复完整生成流程。
  r.post('/chat/clarify', async (req: Request, res: Response) => {
    const { sessionId, answer } = req.body;
    if (!sessionId || typeof answer !== 'string' || !answer.trim()) {
      return res.status(400).json({ error: 'sessionId 与 answer 必填' });
    }
    try {
      const sid = await gw.answerClarify(sessionId, answer.trim());
      res.json({ sessionId: sid });
    } catch (err: any) {
      if (err.message === '__ABORTED__') return res.json({ sessionId, aborted: true });
      res.status(500).json({ error: err.message });
    }
  });

  // 后台任务：当前进行中的所有生成任务（供底部任务栏初始化对齐）
  r.get('/running-tasks', (_req: Request, res: Response) => {
    try { res.json({ tasks: gw.getRunningTasks() }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 定时任务（定时触发对话）─────────────────────────────
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

  // ─── 预览子系统（PreviewService 控制原生 WebContentsView）───
  // 渲染进程 / 悬浮窗通过 /api/preview/* 这一稳定契约面驱动主窗口预览。
  // 所有方法都走 previewService，方便日后替换实现或增加远程预览。

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

  // 打开 / 聚焦某个 artifact 的原生预览视图
  r.post('/preview/open', async (req: Request, res: Response) => {
    try {
      const { id } = req.body || {};
      if (typeof id !== 'string') return res.status(400).json({ error: 'id 必填' });
      await previewService.open(id);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
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

  // 关闭某个 artifact 的预览视图
  r.post('/preview/close', (req: Request, res: Response) => {
    try {
      const { id } = req.body || {};
      if (typeof id !== 'string') return res.status(400).json({ error: 'id 必填' });
      previewService.close(id);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // 重新加载当前（或指定）预览
  r.post('/preview/reload', (req: Request, res: Response) => {
    try {
      const { id } = req.body || {};
      previewService.reload(typeof id === 'string' ? id : undefined);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // 渲染进程上报占位区矩形（窗口坐标，CSS 像素）
  r.post('/preview/layout', (req: Request, res: Response) => {
    try {
      const { x, y, width, height } = req.body || {};
      if ([x, y, width, height].some((v: any) => typeof v !== 'number')) {
        return res.status(400).json({ error: 'bounds 参数缺失' });
      }
      previewService.setLayout({ x, y, width, height });
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // 预留 dev 模式：static ↔ dev 切换（dev 需 artifact 带 devServerUrl）
  r.post('/preview/setMode', (req: Request, res: Response) => {
    try {
      const { id, mode } = req.body || {};
      if (typeof id !== 'string' || (mode !== 'static' && mode !== 'dev')) {
        return res.status(400).json({ error: 'id 与 mode(static|dev) 必填' });
      }
      previewService.setMode(id, mode);
      res.json({ ok: true, mode: previewService.getMode(id) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // 加载任意 URL（dev server / 文档站点等）
  r.post('/preview/url', (req: Request, res: Response) => {
    try {
      const { url, id } = req.body || {};
      if (typeof url !== 'string') return res.status(400).json({ error: 'url 必须是字符串' });
      previewService.loadUrl(url, typeof id === 'string' ? id : 'url');
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

  // 离开预览页：隐藏所有视图避免遮挡其它页面
  r.post('/preview/hide', (_req: Request, res: Response) => {
    try { previewService.hideAll(); res.json({ ok: true }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── Token 用量统计 ────────────────────────────────────────────────
  r.get('/usage/stats', (req: Request, res: Response) => {
    try {
      const period = ((req.query.period as string) || 'all') as any;
      if (!['today', '7d', '30d', 'all'].includes(period)) return res.status(400).json({ error: 'period 无效' });
      const ccDbPath = getCcSwitchDbPath();
      const own = getOwnUsageStats(ccDbPath, period);
      const ccSwitch = getCcSwitchUsage(ccDbPath);
      res.json({ own, ccSwitch });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  r.get('/usage/cc-config', (_req: Request, res: Response) => {
    try { res.json({ dbPath: getCcSwitchDbPath() }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  r.put('/usage/cc-config', (req: Request, res: Response) => {
    try {
      const { dbPath } = req.body || {};
      if (typeof dbPath !== 'string' || !dbPath.trim()) return res.status(400).json({ error: 'dbPath 必填' });
      setCcSwitchDbPath(dbPath.trim());
      res.json({ ok: true, dbPath: dbPath.trim() });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  r.post('/usage/cc-sync', (req: Request, res: Response) => {
    try {
      const result = syncCcSwitchProviders(getCcSwitchDbPath());
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 安全：策略 / 审批 / 沙箱 ────────────────────────────────────
  // 读取安全策略（路径黑名单、扩展名白名单、写入限流、审批模式、沙箱开关）
  r.get('/security/policy', (_req: Request, res: Response) => {
    try {
      res.json(getPolicy());
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // 更新安全策略（部分字段，合并存储）
  r.put('/security/policy', (req: Request, res: Response) => {
    try {
      const updated = setPolicy(req.body || {});
      res.json(updated);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // 审批队列：列出 pending 项
  r.get('/security/approvals', (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      if (status === 'pending') return res.json(listPendingApprovals());
      if (status === 'all') return res.json(listAllApprovals(200));
      res.json(listPendingApprovals());
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // 批准某审批项：把沙箱暂存内容 apply 到目标文件
  r.post('/security/approvals/:id/approve', (req: Request, res: Response) => {
    try {
      const item = approveItem(String(req.params.id));
      // 广播 file-change 让前端刷新（可选）
      res.json({ ok: true, item });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  // 拒绝某审批项：删除沙箱暂存，目标文件不变
  r.post('/security/approvals/:id/reject', (req: Request, res: Response) => {
    try {
      const item = rejectItem(String(req.params.id));
      res.json({ ok: true, item });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  // 审批统计：pending 数量、今日处理量等
  r.get('/security/stats', (_req: Request, res: Response) => {
    try {
      res.json(getApprovalStats());
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  return r;
}
