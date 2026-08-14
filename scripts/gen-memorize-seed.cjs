#!/usr/bin/env node
/**
 * 生成「背背背」默认词库数据模块 src/core/gateway/memorize-seed-data.ts。
 * 输入：qwerty-learner 词库 JSON（CET4_T.json / CET6_T.json，每条 {name, trans[], usphone, ukphone}）。
 * 用法：node scripts/gen-memorize-seed.cjs <cet4.json> <cet6.json>
 * 规则：
 *   - 两表按 term 小写合并去重，重叠词优先取 CET6 词条（释义带词性更完整）；
 *   - category：仅在 CET4 → 'CET4'，在 CET6（含重叠）→ 'CET6'；
 *   - difficulty：CET4 专属 1（中），CET6 及重叠 2（难）；
 *   - definition = trans 用「；」连接（与前端「一句话释义」展示一致）。
 */
const fs = require('node:fs');
const path = require('node:path');

const [cet4Path, cet6Path] = process.argv.slice(2);
if (!cet4Path || !cet6Path) {
  console.error('用法: node scripts/gen-memorize-seed.cjs <cet4.json> <cet6.json>');
  process.exit(1);
}

function load(p) {
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(raw)) throw new Error(`${p} 不是数组`);
  return raw.filter((w) => w && typeof w.name === 'string' && w.name.trim());
}

const cet4 = load(cet4Path);
const cet6 = load(cet6Path);

const byTerm = new Map(); // key: lower name → { entry, source: 'CET4' | 'CET6' }

for (const w of cet4) {
  const key = w.name.trim().toLowerCase();
  if (!byTerm.has(key)) byTerm.set(key, { entry: w, source: 'CET4' });
}
for (const w of cet6) {
  const key = w.name.trim().toLowerCase();
  // 重叠词优先 CET6（释义更完整）
  byTerm.set(key, { entry: w, source: 'CET6' });
}

const words = [];
for (const { entry, source } of byTerm.values()) {
  const term = entry.name.trim();
  const trans = Array.isArray(entry.trans) ? entry.trans.map((t) => String(t).trim()).filter(Boolean) : [];
  if (!trans.length) continue; // 无释义的单词不收录
  const definition = trans.join('；');
  const category = source === 'CET6' ? 'CET6' : 'CET4';
  const difficulty = source === 'CET6' ? 2 : 1;
  words.push({ term, definition, category, difficulty });
}

words.sort((a, b) => a.term.localeCompare(b.term));

const outPath = path.resolve(__dirname, '..', 'src', 'core', 'gateway', 'memorize-seed-data.ts');
const lines = [];
lines.push('// 自动生成：CET4/CET6 默认词库（勿手改，重新生成请跑 scripts/gen-memorize-seed.cjs）。');
lines.push('// 来源：qwerty-learner 词库数据（CET4_T.json / CET6_T.json，MIT）。');
lines.push('// 字段：term 单词，definition 中文释义，category 级别（CET4/CET6），difficulty 0易/1中/2难。');
lines.push('');
lines.push('export interface MemorizeSeedWord {');
lines.push('  term: string;');
lines.push('  definition: string;');
lines.push("  category: 'CET4' | 'CET6';");
lines.push('  difficulty: 0 | 1 | 2;');
lines.push('}');
lines.push('');
lines.push('export const MEMORIZE_SEED_WORDS: MemorizeSeedWord[] = [');
for (const w of words) {
  lines.push(`  { term: ${JSON.stringify(w.term)}, definition: ${JSON.stringify(w.definition)}, category: '${w.category}', difficulty: ${w.difficulty} },`);
}
lines.push('];');
lines.push('');

fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log(`输出: ${outPath}`);
console.log(`词条总数: ${words.length}（CET4 专属 ${words.filter((w) => w.category === 'CET4').length}，CET6 ${words.filter((w) => w.category === 'CET6').length}）`);
console.log(`样例: ${JSON.stringify(words[0])}`);
console.log(`样例: ${JSON.stringify(words[Math.floor(words.length / 2)])}`);
console.log(`样例: ${JSON.stringify(words[words.length - 1])}`);
