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

  it('DBS-01 建表:21 张正式表(20 migrate + approval_queue,排除 sqlite_* 系统表)', () => {
    const rows = getDb().prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name
    `).all() as any[];
    const names = rows.map(r => r.name);
    // 21 张业务表(20 张 migrate + ensureApprovalTable 建的 approval_queue)
    expect(names.length).toBe(21);
    for (const t of ['providers', 'agents', 'sessions', 'messages', 'skills', 'cron_jobs',
      'scheduled_tasks', 'token_usage', 'files', 'window_state', 'memories', 'search_config',
      'github_oauth_config', 'users', 'github_tokens', 'wechat_oauth_config', 'wechat_tokens',
      'app_settings', 'quiz_bank', 'session_shares', 'approval_queue']) {
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
});
