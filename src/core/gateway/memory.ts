import { getDb } from './db';

/**
 * 记忆模式注册表（多重记忆架构）：
 * 系统同时维护多种记忆模式，模型在「规划阶段」根据任务难度与类型，用 <<MEM:key1,key2>> 标记
 * 选择要加载的模式；网关按所选模式从 memories 表按需召回并注入最终生成阶段。
 * - 不输出 <<MEM:...>> 时走默认策略（按任务复杂度自动决定，见 resolveMemoryModes）。
 * - 输出 <<MEM:none>> 表示本任务不需要任何记忆（省 token）。
 */
export interface MemoryMode {
  key: string;              // <<MEM:...>> 标记里用的 key
  category: string | null;  // 对应 memories.category（null = 不来自 memories 表）
  name: string;             // 中文名（注入提示用）
  desc: string;             // 内容说明（给模型看）
  when: string;             // 适用场景（模型判断依据）
  limit: number;            // 最多召回条数
}

export const MEMORY_MODES: MemoryMode[] = [
  {
    key: 'profile',
    category: 'A',
    name: '长期画像',
    desc: '用户的身份、职业、偏好、习惯等稳定信息',
    when: '任何需要个性化回答的任务；简单任务也建议带',
    limit: 6,
  },
  {
    key: 'recent',
    category: 'B',
    name: '近期关注',
    desc: '用户最近关注的话题、进行中的需求、当前项目上下文',
    when: '延续性对话，或用户提到"上次/刚才/最近/这个项目"时',
    limit: 5,
  },
  {
    key: 'episodic',
    category: 'C',
    name: '任务经验',
    desc: '历史任务中沉淀的方案、踩坑、代码片段、可复用结论',
    when: '复杂任务、重复性任务（编程/分析/写作），需要复用历史经验时',
    limit: 5,
  },
];

function getMemories(): { content: string; category: string }[] {
  return getDb().prepare('SELECT content, category FROM memories ORDER BY category ASC, created_at ASC').all() as any[];
}

/** 轻量分词：英文/数字按词、中文逐字。用于记忆相关性召回（不引入向量库，简单好上手） */
function tokenize(s: string): Set<string> {
  const lower = (s || '').toLowerCase();
  const tokens = new Set<string>();
  for (const m of lower.match(/[a-z0-9]+/g) || []) tokens.add(m);
  for (const m of lower.match(/[一-鿿]/g) || []) tokens.add(m);
  return tokens;
}

/**
 * 按需召回：根据当前用户输入对全部记忆打分（相关性 × 重要性 × 时间衰减），返回降序排列。
 * 记忆总量很小（A≤15/B≤10），全量读出后在 JS 里打分即可，无需向量库。
 * - category A = 长期个性化画像（身份/偏好/习惯），默认高 importance
 * - category B = 近期关注，默认中 importance
 */
export function retrieveMemories(query?: string, sessionId?: string): {
  id: number; content: string; category: string; importance: number;
  created_at: string; relevance: number; score: number;
}[] {
  const db = getDb();
  // 会话隔离：传入 sessionId 时，A 类（长期画像）全局保留（跨会话个性化），
  // B/C 类（近期关注/任务经验）仅取本会话或历史遗留(NULL)的记忆，避免不同对话互相串台。
  let sql = 'SELECT id, content, category, importance, created_at FROM memories';
  const params: any[] = [];
  if (sessionId) {
    sql += ' WHERE (category = ? OR session_id = ? OR session_id IS NULL)';
    params.push('A', sessionId);
  }
  const all = db.prepare(sql).all(...params) as any[];
  const qTok = tokenize(query || '');
  const now = Date.now();
  return all.map((m: any) => {
    const mTok = tokenize(m.content);
    let overlap = 0;
    for (const t of qTok) if (mTok.has(t)) overlap++;
    const relevance = qTok.size ? overlap / Math.sqrt(qTok.size * mTok.size || 1) : 0;
    const createdMs = new Date((m.created_at || '').replace(' ', 'T') + 'Z').getTime() || now;
    const hours = Math.max(0, (now - createdMs) / 3600000);
    const decay = Math.exp(-0.01 * hours); // 温和时间衰减：约 1 天 0.96、7 天 0.75
    const importance = typeof m.importance === 'number' ? m.importance : 0.5;
    const score = relevance * importance * decay;
    return { ...m, relevance, score };
  }).sort((a, b) => b.score - a.score);
}

/**
 * 默认记忆模式策略（模型未输出 <<MEM:...>> 时使用）：
 * 简单任务（无工具、无技能、无工作区）= 仅长期画像（省 token）；
 * 复杂任务（有工具调用/技能/工作区，任务难度高）= 长期画像 + 近期关注 + 任务经验。
 */
export function resolveMemoryModes(opts: { complex: boolean }): string[] {
  return opts.complex ? ['profile', 'recent', 'episodic'] : ['profile'];
}

/**
 * 按选中的记忆模式召回并组装为提示块。
 * 返回 [{ name, items }]，调用方拼进 system prompt；召回逻辑复用 retrieveMemories 的
 * 相关性×重要性×时间衰减 打分，仅按 category 过滤对应模式。
 */
export function loadModeMemories(modeKeys: string[], query?: string, sessionId?: string): { name: string; items: string[] }[] {
  const blocks: { name: string; items: string[] }[] = [];
  const ranked = retrieveMemories(query, sessionId);
  for (const key of modeKeys) {
    const mode = MEMORY_MODES.find(mm => mm.key === key);
    if (!mode || !mode.category) continue;
    const items = ranked
      .filter(m => m.category === mode.category)
      .slice(0, mode.limit)
      .map(m => `- ${m.content}`);
    if (items.length > 0) blocks.push({ name: mode.name, items });
  }
  return blocks;
}

/** 保存一条长期记忆（A/B/C 分类，去重 + 限额 + 重要性衰减）。 */
export function saveMemo(content: string, category: string, source?: string): void {
  category = category.trim();
  if (!content || (category !== 'A' && category !== 'B' && category !== 'C')) return;
  const db = getDb();
  // A=长期个性化画像，默认重要性最高；B=近期关注，默认中等；C=任务经验，默认较高（复杂任务复用价值高）。
  // 来源用于溯源（来自哪次会话/摘要）
  const importance = category === 'A' ? 0.9 : category === 'C' ? 0.8 : 0.6;
  const existing = db.prepare('SELECT id, category, importance FROM memories WHERE content = ?').get(content) as any;
  if (existing) {
    if (existing.category !== category) {
      db.prepare('UPDATE memories SET category = ?, created_at = datetime("now"), importance = ?, source = COALESCE(source, ?), session_id = COALESCE(session_id, ?) WHERE id = ?')
        .run(category, importance, source || null, source || null, existing.id);
    } else {
      // 刷新时间；仅在更高时提升 importance（避免被低权重覆盖）；补记来源与归属会话
      db.prepare('UPDATE memories SET created_at = datetime("now"), importance = MAX(importance, ?), source = COALESCE(source, ?), session_id = COALESCE(session_id, ?) WHERE id = ?')
        .run(importance, source || null, source || null, existing.id);
    }
    return;
  }
  const count = (db.prepare('SELECT COUNT(*) AS c FROM memories WHERE category = ?').get(category) as any).c;
  const limit = category === 'A' ? 15 : category === 'C' ? 15 : 10;
  if (count >= limit) {
    // 限流：优先删除「重要性最低且最旧」的一条（替代原纯 FIFO，更贴近衰减语义）
    db.prepare('DELETE FROM memories WHERE id IN (SELECT id FROM memories WHERE category = ? ORDER BY importance ASC, created_at ASC LIMIT 1)').run(category);
  }
  db.prepare('INSERT INTO memories (content, category, importance, source, session_id) VALUES (?, ?, ?, ?, ?)')
    .run(content, category, importance, source || null, source || null);
}