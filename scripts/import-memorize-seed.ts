#!/usr/bin/env tsx
/**
 * 把「背背背」默认词库导入到现有数据库（按 term 去重，不覆盖用户已有词条）。
 * 用法：node scripts/import-memorize-seed.ts
 * 与启动时种子 seedMemorizeIfEmpty（仅空表注入）互补：本脚本可随时重复执行，
 * 已存在的单词（大小写不敏感）自动跳过。
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { MEMORIZE_SEED_WORDS } from '../src/core/gateway/memorize-seed-data';

const DATA_DIR = process.env.DATA_DIR || path.join(process.env.APPDATA || '', 'studentbuddy');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'studentbuddy.db');

if (!fs.existsSync(DB_PATH)) {
  console.error(`数据库不存在: ${DB_PATH}（请先启动一次应用）`);
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('busy_timeout = 5000');

const existing = new Set(
  (db.prepare('SELECT term FROM memorize').all() as { term: string }[]).map((r) => r.term.trim().toLowerCase()),
);

const toInsert = MEMORIZE_SEED_WORDS.filter((w) => !existing.has(w.term.toLowerCase()));
const ins = db.prepare(
  'INSERT INTO memorize (id, term, definition, category, difficulty, mastered) VALUES (?,?,?,?,?,?)',
);
const tx = db.transaction((words: typeof MEMORIZE_SEED_WORDS) => {
  for (const w of words) {
    ins.run(`mem-seed-${crypto.randomUUID()}`, w.term, w.definition, w.category, w.difficulty, 0);
  }
});
tx(toInsert);
db.close();

const total = existing.size + toInsert.length;
console.log(`已导入 ${toInsert.length} 个词条（跳过已有 ${existing.size} 个），memorize 表现有 ${total} 条。`);
