import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { createLogger } from '../logger';
import { initCrypto, encryptSecret, isEncrypted, decryptSecret } from '../security/crypto';
import { ensureApprovalTable } from '../security/approval';
import { ensurePolicy } from '../security/policy';

const dbLog = createLogger('db');

export const DATA_DIR = process.env.DATA_DIR || path.join(process.env.APPDATA || '', 'studentbuddy');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'studentbuddy.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (db) return db;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 安全子系统初始化：加密主密钥、审批队列表、安全策略默认值
  initCrypto();
  migrate(db);
  ensureApprovalTable();
  ensurePolicy();
  migrateSecrets(db);

  return db;
}

function migrate(database: Database.Database): void {
  dbLog.info('Running database migrations...');

  database.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('openai', 'anthropic')),
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      default_model TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'assistant',
      provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      system_prompt TEXT NOT NULL DEFAULT '',
      workspace TEXT DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (provider_id) REFERENCES providers(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT DEFAULT '',
      source TEXT NOT NULL CHECK(source IN ('main', 'floating')),
      title TEXT NOT NULL DEFAULT '新对话',
      parent_id TEXT,
      root_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      tokens INTEGER DEFAULT 0,
      reasoning TEXT,
      model TEXT,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      path TEXT DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      source TEXT DEFAULT 'local',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cron_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      expr TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('once', 'interval')),
      next_run_at TEXT NOT NULL DEFAULT (datetime('now')),
      interval_minutes INTEGER NOT NULL DEFAULT 0,
      session_id TEXT NOT NULL,
      provider_id TEXT DEFAULT '',
      model TEXT DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      last_status TEXT DEFAULT 'idle',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT DEFAULT '',
      provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (provider_id) REFERENCES providers(id)
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mime TEXT DEFAULT '',
      path TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      uploaded_by TEXT DEFAULT '',
      ts TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS window_state (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL CHECK(name IN ('main', 'floating')),
      x INTEGER DEFAULT 0,
      y INTEGER DEFAULT 0,
      visible INTEGER NOT NULL DEFAULT 1,
      collapsed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('A', 'B', 'C')),
      importance REAL NOT NULL DEFAULT 0.5,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS search_config (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      provider TEXT NOT NULL DEFAULT 'duckduckgo' CHECK(provider IN ('duckduckgo', 'custom')),
      custom_api_url TEXT NOT NULL DEFAULT '',
      custom_api_key TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO search_config (id, enabled) VALUES (1, 1);

    CREATE TABLE IF NOT EXISTS github_oauth_config (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      client_id TEXT NOT NULL DEFAULT '',
      redirect_uri TEXT NOT NULL DEFAULT 'http://localhost:18791/auth/github/callback',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO github_oauth_config (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      github_id INTEGER NOT NULL UNIQUE,
      username TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      avatar_url TEXT DEFAULT '',
      email TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS github_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      access_token TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT '',
      token_type TEXT NOT NULL DEFAULT 'bearer',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- 微信 OAuth 配置（开放平台网站应用）
    CREATE TABLE IF NOT EXISTS wechat_oauth_config (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      app_id TEXT NOT NULL DEFAULT '',
      app_secret TEXT NOT NULL DEFAULT '',
      redirect_uri TEXT NOT NULL DEFAULT 'http://localhost:18791/auth/wechat/callback',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO wechat_oauth_config (id) VALUES (1);

    -- 微信 access_token 缓存（含 refresh_token、expires_in、openid、unionid）
    CREATE TABLE IF NOT EXISTS wechat_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      access_token TEXT NOT NULL,
      refresh_token TEXT DEFAULT '',
      expires_in INTEGER DEFAULT 7200,
      openid TEXT NOT NULL,
      unionid TEXT,
      scope TEXT NOT NULL DEFAULT 'snsapi_login',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // users 表非破坏性补列：支持微信登录（unionid / openid 可为空）
  const userCols = (database.prepare('PRAGMA table_info(users)').all() as any[]).map((c) => c.name);
  if (!userCols.includes('wechat_unionid')) {
    database.prepare('ALTER TABLE users ADD COLUMN wechat_unionid TEXT').run();
  }
  if (!userCols.includes('wechat_openid')) {
    database.prepare('ALTER TABLE users ADD COLUMN wechat_openid TEXT').run();
  }
  // unionid 唯一索引（允许 NULL，仅约束非空值唯一）
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wechat_unionid
    ON users(wechat_unionid) WHERE wechat_unionid IS NOT NULL
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // 题库：AI 生成 / 手动导入的选择题组。data 存完整 QuizData JSON（title + questions）。
  database.exec(`
    CREATE TABLE IF NOT EXISTS quiz_bank (
      id TEXT PRIMARY KEY,
      title TEXT DEFAULT '',
      data TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'ai',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // 做题统计：每个被收藏的题目（quiz_bank + question_index）记录作答次数 / 正确次数 / 连续正确。
  // 准确率 = correct / attempts；streak 为「连续答对」当前值（答错归零），best_streak 为历史最高。
  database.exec(`
    CREATE TABLE IF NOT EXISTS quiz_stats (
      quiz_id TEXT NOT NULL,
      question_index INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      correct INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      best_streak INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (quiz_id, question_index)
    );
  `);

  // 会话置顶 / 软删除：对已有库非破坏性地补列（幂等）
  const sessionCols = (database.prepare('PRAGMA table_info(sessions)').all() as any[]).map((c) => c.name);
  if (!sessionCols.includes('pinned')) {
    database.prepare('ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0').run();
  }
  if (!sessionCols.includes('deleted_at')) {
    database.prepare('ALTER TABLE sessions ADD COLUMN deleted_at TEXT').run();
  }
  // 子对话（fork）：parent_id = 父会话 id（根会话为 NULL），root_id = 整棵树的根会话 id，
  // 用于「对话 → 子对话」树状历史。对已有库幂等补列。
  if (!sessionCols.includes('parent_id')) {
    database.prepare('ALTER TABLE sessions ADD COLUMN parent_id TEXT').run();
  }
  if (!sessionCols.includes('root_id')) {
    database.prepare('ALTER TABLE sessions ADD COLUMN root_id TEXT').run();
  }

  // messages：推理内容（深度思考折叠块），对已有库非破坏性地补列
  const messageCols = (database.prepare('PRAGMA table_info(messages)').all() as any[]).map((c) => c.name);
  if (!messageCols.includes('reasoning')) {
    database.prepare('ALTER TABLE messages ADD COLUMN reasoning TEXT').run();
  }
  if (!messageCols.includes('model')) {
    database.prepare('ALTER TABLE messages ADD COLUMN model TEXT').run();
  }

  // messages：工具调用消息持久化——重建表放开 role 约束（支持 'tool'）并新增
  // tool_call_id（tool 结果对应的调用 id）与 tool_calls（assistant 携带的调用 JSON）两列。
  // 幂等：仅当建表语句还不支持 'tool' 角色时重建（不改动现有数据，列已存在则跳过）。
  const msgDef = (database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'").get() as any)?.sql || '';
  if (!/role.*'tool'/.test(msgDef)) {
    database.exec(`
      CREATE TABLE messages_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
        content TEXT NOT NULL,
        tokens INTEGER DEFAULT 0,
        reasoning TEXT,
        model TEXT,
        tool_call_id TEXT,
        tool_calls TEXT,
        ts TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
      INSERT INTO messages_new (id, session_id, role, content, tokens, reasoning, model, ts)
        SELECT id, session_id, role, content, tokens, reasoning, model, ts FROM messages;
      DROP TABLE messages;
      ALTER TABLE messages_new RENAME TO messages;
    `);
    dbLog.info('Rebuilt messages table: role CHECK includes tool + tool_call_id/tool_calls columns');
  }

  // 分享令牌表（分享任务导出会话用，幂等）
  database.exec(`
    CREATE TABLE IF NOT EXISTS session_shares (
      token TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

  `);

  // 记忆表增量迁移：加 importance / source 两列（兼容旧库，列已存在则忽略）
  // importance=记忆重要性权重（A 长期画像默认高、B 近期默认中），source=来源 session/摘要，用于溯源
  try { db.exec('ALTER TABLE memories ADD COLUMN importance REAL NOT NULL DEFAULT 0.5'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE memories ADD COLUMN source TEXT'); } catch { /* 列已存在 */ }
  // 记忆隔离迁移：加 session_id 列，把记忆按会话归属，根治「多对话 prompt 互相干扰」。
  // 旧库（无 session_id 的遗留记忆）置 NULL，召回时作为跨会话兜底仍可注入，避免一次性丢失历史记忆。
  try { db.exec('ALTER TABLE memories ADD COLUMN session_id TEXT'); } catch { /* 列已存在 */ }

  // 记忆表重建迁移：把 category 的 CHECK 约束从 ('A','B') 升级为 ('A','B','C')。
  // SQLite 不支持修改 CHECK，只能重建表；用 sqlite_master 里的建表语句判断是否需要重建（幂等）。
  const memDef = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='memories'").get() as any;
  if (memDef && !/IN \('A', 'B', 'C'\)/.test(memDef.sql || '')) {
    db.exec(`
      CREATE TABLE memories_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('A', 'B', 'C')),
        importance REAL NOT NULL DEFAULT 0.5,
        source TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO memories_new (id, content, category, importance, source, created_at)
        SELECT id, content, category, importance, source, created_at FROM memories;
      DROP TABLE memories;
      ALTER TABLE memories_new RENAME TO memories;
    `);
    dbLog.info('Rebuilt memories table: category CHECK upgraded to (A,B,C)');
  }

  dbLog.info('Migrations complete');
}

/**
 * 密钥幂等迁移：把 providers.api_key、wechat_oauth_config.app_secret、
 * github_tokens.access_token、wechat_tokens.access_token、search_config.custom_api_key
 * 中仍是明文的行加密（带 enc:v1: 前缀的跳过）。
 *
 * 幂等：已加密的行不会被二次加密；旧库明文会被原地更新为密文。
 * 回退：若 masterKey 丢失（DPAPI 换用户/换机），decryptSecret 返回空字符串，
 * 用户需在设置页重新录入密钥——这是有意的安全代价。
 */
function migrateSecrets(database: Database.Database): void {
  try {
    // providers.api_key
    const provs = database.prepare('SELECT id, api_key FROM providers').all() as any[];
    const updProv = database.prepare("UPDATE providers SET api_key=? WHERE id=?");
    for (const p of provs) {
      if (!p.api_key || isEncrypted(p.api_key)) continue;
      updProv.run(encryptSecret(p.api_key), p.id);
    }

    // wechat_oauth_config.app_secret
    const wx = database.prepare('SELECT app_secret FROM wechat_oauth_config WHERE id=1').get() as any;
    if (wx?.app_secret && !isEncrypted(wx.app_secret)) {
      database.prepare("UPDATE wechat_oauth_config SET app_secret=? WHERE id=1").run(encryptSecret(wx.app_secret));
    }

    // github_tokens.access_token
    const ghs = database.prepare('SELECT id, access_token FROM github_tokens').all() as any[];
    const updGh = database.prepare("UPDATE github_tokens SET access_token=? WHERE id=?");
    for (const g of ghs) {
      if (!g.access_token || isEncrypted(g.access_token)) continue;
      updGh.run(encryptSecret(g.access_token), g.id);
    }

    // wechat_tokens.access_token
    const wts = database.prepare('SELECT id, access_token FROM wechat_tokens').all() as any[];
    const updWt = database.prepare("UPDATE wechat_tokens SET access_token=? WHERE id=?");
    for (const w of wts) {
      if (!w.access_token || isEncrypted(w.access_token)) continue;
      updWt.run(encryptSecret(w.access_token), w.id);
    }

    // search_config.custom_api_key
    const sc = database.prepare('SELECT custom_api_key FROM search_config WHERE id=1').get() as any;
    if (sc?.custom_api_key && !isEncrypted(sc.custom_api_key)) {
      database.prepare("UPDATE search_config SET custom_api_key=? WHERE id=1").run(encryptSecret(sc.custom_api_key));
    }

    dbLog.info('Secrets migration complete');
  } catch (err: any) {
    dbLog.warn({ error: err.message }, 'migrateSecrets failed (non-fatal)');
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null as any; // 重置单例,允许 closeDb 后重新 getDb(测试模拟重启/热重载)
    dbLog.info('Database connection closed');
  }
}
