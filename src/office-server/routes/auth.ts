import { Router, Request, Response } from 'express';
import { getDb } from '../../core/gateway/db';
import { createLogger } from '../../core/logger';
import { encryptSecret } from '../../core/security/crypto';
import crypto from 'node:crypto';

const log = createLogger('api:auth');

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

// 微信 OAuth 配置
function getWechatConfig(): { appId: string; appSecret: string; redirectUri: string } {
  const row = getDb().prepare('SELECT app_id, app_secret, redirect_uri FROM wechat_oauth_config WHERE id=1').get() as any;
  return {
    appId: row?.app_id || '',
    appSecret: row?.app_secret || '',
    redirectUri: row?.redirect_uri || 'http://localhost:18791/auth/wechat/callback',
  };
}

/** 注册 OAuth 路由：GitHub（PKCE，无需 client_secret）+ 微信（开放平台网站应用扫码登录） */
export function registerAuth(r: Router): void {
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
    const url = `https://open.weixin.qq.com/connect/qrconnect?appid=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=snsapi_login&state=studentbuddy#wechat_redirect`;
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
}
