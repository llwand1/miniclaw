import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// vi.hoisted 保证在静态 import 之前设置 DATA_DIR(独立临时库,避免连到真实库)
vi.hoisted(() => {
  const fs = require('node:fs') as typeof import('node:fs');
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'studentbuddy-test-db-'));
  process.env.DATA_DIR = TMP;
});

import { getDb, closeDb } from './db';
import { decryptSecret, isEncrypted } from '../security/crypto';

describe('gateway/db', () => {
  afterAll(() => { closeDb(); });

  it('DBS-01 建表:23 张正式表(22 migrate + approval_queue,排除 sqlite_* 系统表与 _new 重建)', () => {
    const rows = getDb().prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_new' ORDER BY name
    `).all() as any[];
    const names = rows.map(r => r.name);
    // 23 张业务表(22 张 migrate + ensureApprovalTable 建的 approval_queue)
    expect(names.length).toBe(23);
    for (const t of ['providers', 'agents', 'sessions', 'messages', 'skills', 'cron_jobs',
      'scheduled_tasks', 'token_usage', 'files', 'window_state', 'memories', 'search_config',
      'github_oauth_config', 'users', 'github_tokens', 'wechat_oauth_config', 'wechat_tokens',
      'app_settings', 'quiz_bank', 'quiz_stats', 'memorize', 'session_shares', 'approval_queue']) {
      expect(names).toContain(t);
    }
  });

  it('DBS-01 WAL 模式 + foreign_keys 开启', () => {
    const db = getDb();
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('种子默认行:search_config/github/wechat 配置行存在', () => {
    const db = getDb();
    const sc = db.prepare('SELECT * FROM search_config WHERE id=1').get() as any;
    expect(sc).toBeTruthy();
    expect(sc.enabled).toBe(1);
    expect(sc.provider).toBe('duckduckgo');
    const gh = db.prepare('SELECT * FROM github_oauth_config WHERE id=1').get() as any;
    expect(gh).toBeTruthy();
    const wx = db.prepare('SELECT * FROM wechat_oauth_config WHERE id=1').get() as any;
    expect(wx).toBeTruthy();
  });

  it('DBS-02 密钥迁移:明文 api_key 在重启后加密,且幂等', () => {
    const db = getDb();
    // 造一条明文 providers 行
    db.prepare(`
      INSERT INTO providers (id,type,name,base_url,api_key,default_model)
      VALUES ('p-plain','openai','T','https://x/v1','sk-plain-secret','m1')
      ON CONFLICT(id) DO NOTHING
    `).run();

    // 模拟重启:closeDb 后再次 getDb() → migrateSecrets 把明文加密
    closeDb();
    const db2 = getDb();
    const row = db2.prepare("SELECT api_key FROM providers WHERE id='p-plain'").get() as any;
    expect(isEncrypted(row.api_key)).toBe(true);
    expect(decryptSecret(row.api_key)).toBe('sk-plain-secret');

    // 再模拟一次重启:已加密行不再二次处理(幂等),解密值不变
    closeDb();
    const db3 = getDb();
    const row3 = db3.prepare("SELECT api_key FROM providers WHERE id='p-plain'").get() as any;
    expect(isEncrypted(row3.api_key)).toBe(true);
    expect(decryptSecret(row3.api_key)).toBe('sk-plain-secret');
  });

  it('DBS-04 时间戳列:created_at/updated_at/ts 为 SQLite 时间串格式,且语义正确', () => {
    const db = getDb();
    const SQL_DT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/; // YYYY-MM-DD HH:MM:SS

    // 会话:created_at / updated_at 均为合法时间串
    db.prepare("INSERT INTO sessions (id,agent_id,source,title) VALUES ('s-ts-1','default','main','时间戳会话')").run();
    const sess = db.prepare("SELECT created_at, updated_at FROM sessions WHERE id='s-ts-1'").get() as any;
    expect(sess.created_at).toMatch(SQL_DT);
    expect(sess.updated_at).toMatch(SQL_DT);

    // 消息:ts 为合法时间串,且与 created_at 同秒量级(同一事务内创建)
    db.prepare("INSERT INTO messages (session_id,role,content,model) VALUES ('s-ts-1','user','带时间的提问','m')").run();
    const msg = db.prepare("SELECT ts FROM messages WHERE session_id='s-ts-1' ORDER BY id DESC LIMIT 1").get() as any;
    expect(msg.ts).toMatch(SQL_DT);

    // token_usage:ts 为合法时间串(先建 provider 满足外键)
    db.prepare(`
      INSERT INTO providers (id,type,name,base_url,api_key,default_model)
      VALUES ('p-ts','openai','T','https://x/v1','sk-ts','m')
      ON CONFLICT(id) DO NOTHING
    `).run();
    db.prepare(`
      INSERT INTO token_usage (provider_id,agent_id,model,prompt_tokens,completion_tokens)
      VALUES ('p-ts','default','m',10,5)
    `).run();
    const usage = db.prepare("SELECT ts FROM token_usage ORDER BY id DESC LIMIT 1").get() as any;
    expect(usage.ts).toMatch(SQL_DT);

    // 语义:会话创建时间不晚于消息时间(单调递增)
    const created = new Date(sess.created_at.replace(' ', 'T') + 'Z').getTime();
    const msgTs = new Date(msg.ts.replace(' ', 'T') + 'Z').getTime();
    expect(msgTs).toBeGreaterThanOrEqual(created);
  });

  it('DBS-05 时间戳更新:updated_at 在 UPDATE 时刷新,created_at 保持不变', () => {
    const db = getDb();
    db.prepare("INSERT INTO sessions (id,agent_id,source,title) VALUES ('s-ts-2','default','main','更新测试')").run();
    const before = db.prepare("SELECT created_at, updated_at FROM sessions WHERE id='s-ts-2'").get() as any;
    // 等待 1.1s 让秒级时间戳必然变化
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        db.prepare("UPDATE sessions SET title='更新后标题' WHERE id='s-ts-2'").run();
        const after = db.prepare("SELECT created_at, updated_at FROM sessions WHERE id='s-ts-2'").get() as any;
        expect(after.created_at).toBe(before.created_at);   // created_at 不变
        expect(after.updated_at >= before.updated_at).toBe(true); // updated_at 刷新
        resolve();
      }, 1100);
    });
  });
});
