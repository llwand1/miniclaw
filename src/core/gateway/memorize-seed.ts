import { getDb } from './db';
import { MEMORIZE_SEED_WORDS } from './memorize-seed-data';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../logger';

const log = createLogger('gateway:memorize-seed');

/**
 * 背背背空库种子：memorize 表为空时注入 CET4/CET6 默认词库（约 3900 词，覆盖到六级）。
 * 幂等：仅空表注入，用户已有词条（哪怕一条）则完全跳过，绝不打扰既有数据。
 */
export function seedMemorizeIfEmpty(): void {
  const db = getDb();
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM memorize').get() as { n: number };
  if (n > 0) return; // 已有词条：跳过

  const ins = db.prepare(
    'INSERT INTO memorize (id, term, definition, category, difficulty, mastered) VALUES (?,?,?,?,?,?)',
  );
  const tx = db.transaction((words: typeof MEMORIZE_SEED_WORDS) => {
    for (const w of words) {
      ins.run(`mem-seed-${uuidv4()}`, w.term, w.definition, w.category, w.difficulty, 0);
    }
  });
  tx(MEMORIZE_SEED_WORDS);
  log.info(`Seeded ${MEMORIZE_SEED_WORDS.length} default memorize words (CET4/CET6)`);
}
