import { Router, Request, Response } from 'express';
import { getDb } from '../../core/gateway/db';
import crypto from 'node:crypto';
import { Gateway } from '../../core/gateway';
import { AgentConfig } from '../../core/agent';
import { getProviderById, getSelectedModel, getDefaultProvider } from '../../core/gateway/providers';
import { createLogger } from '../../core/logger';

const log = createLogger('api:memorize');

/**
 * 背背背路由：记忆词条 / 专有名词 CRUD + 背诵进度 + AI 联动（讲解/出题）。
 * 词条结构：{ id, term, definition, category, difficulty(0-2), review_count, mastered(0/1), last_review_at, created_at }
 */
export function registerMemorize(r: Router, gw: Gateway): void {
  // 清洗一条词条：term/definition 必填，其余字段规范化
  function normalize(data: any): { term: string; definition: string; category: string; difficulty: number; mastered: number } | null {
    if (!data || typeof data !== 'object') return null;
    const term = typeof data.term === 'string' ? data.term.trim().slice(0, 200) : '';
    const definition = typeof data.definition === 'string' ? data.definition.trim().slice(0, 4000) : '';
    if (!term || !definition) return null;
    const category = typeof data.category === 'string' && data.category.trim() ? data.category.trim().slice(0, 50) : '单词';
    const difficulty = [0, 1, 2].includes(Number(data.difficulty)) ? Number(data.difficulty) : 1;
    const mastered = data.mastered ? 1 : 0;
    return { term, definition, category, difficulty, mastered };
  }

  // ─── 列表：全量词条（按创建时间倒序），附带可选分类过滤 ───
  r.get('/memorize', (req: Request, res: Response) => {
    try {
      const category = typeof req.query.category === 'string' && req.query.category.trim() ? req.query.category.trim() : '';
      const rows = category
        ? getDb().prepare('SELECT * FROM memorize WHERE category=? ORDER BY created_at DESC').all(category)
        : getDb().prepare('SELECT * FROM memorize ORDER BY created_at DESC').all();
      res.json(rows);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 统计：总数 / 已掌握 / 待复习（含分类分布）───
  r.get('/memorize/stats', (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const total = (db.prepare('SELECT COUNT(*) AS n FROM memorize').get() as { n: number }).n;
      const mastered = (db.prepare('SELECT COUNT(*) AS n FROM memorize WHERE mastered=1').get() as { n: number }).n;
      const cats = db.prepare('SELECT category, COUNT(*) AS n FROM memorize GROUP BY category ORDER BY n DESC').all() as { category: string; n: number }[];
      res.json({ total, mastered, toReview: total - mastered, categories: cats });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 新增词条（单个或批量）───
  r.post('/memorize', (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const items: any[] = Array.isArray(body.items) ? body.items : [body];
      const db = getDb();
      const ins = db.prepare('INSERT INTO memorize (id,term,definition,category,difficulty,mastered) VALUES (?,?,?,?,?,?)');
      let inserted = 0;
      const ids: string[] = [];
      for (const it of items) {
        const norm = normalize(it);
        if (!norm) continue;
        const id = `mem-${crypto.randomUUID()}`;
        ins.run(id, norm.term, norm.definition, norm.category, norm.difficulty, norm.mastered);
        inserted++;
        ids.push(id);
      }
      res.json({ inserted, ids });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 更新词条（term/definition/category/difficulty/mastered）───
  r.put('/memorize/:id', (req: Request, res: Response) => {
    try {
      const norm = normalize(req.body || {});
      if (!norm) return res.status(400).json({ error: '词条数据无效：term 与 definition 必填' });
      const info = getDb().prepare('UPDATE memorize SET term=?,definition=?,category=?,difficulty=?,mastered=? WHERE id=?')
        .run(norm.term, norm.definition, norm.category, norm.difficulty, norm.mastered, req.params.id);
      if (info.changes === 0) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 背诵进度上报：复习一次 → review_count+1、更新 last_review_at、可选标记掌握 ───
  // body: { mastered?: boolean } —— 传 mastered=true 表示「背熟了」，false 表示「没记住」。
  r.post('/memorize/:id/review', (req: Request, res: Response) => {
    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM memorize WHERE id=?').get(req.params.id) as any;
      if (!row) return res.status(404).json({ error: 'not found' });
      const mastered = req.body && req.body.mastered ? 1 : 0;
      db.prepare('UPDATE memorize SET review_count=review_count+1, mastered=?, last_review_at=datetime(\'now\') WHERE id=?')
        .run(mastered, req.params.id);
      res.json({ ok: true, review_count: row.review_count + 1, mastered });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 删除词条 ───
  r.delete('/memorize/:id', (req: Request, res: Response) => {
    try {
      const info = getDb().prepare('DELETE FROM memorize WHERE id=?').run(req.params.id);
      if (info.changes === 0) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 批量删除（清空 / 移除已掌握）───
  r.post('/memorize/bulk-delete', (req: Request, res: Response) => {
    try {
      const { mastered } = req.body || {};
      const db = getDb();
      if (mastered) {
        db.prepare('DELETE FROM memorize WHERE mastered=1').run();
      } else {
        db.prepare('DELETE FROM memorize').run();
      }
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── AI 联动：针对词条生成学习内容（讲解 / 例句 / 出题）。
  // body: { term, definition, mode: 'explain' | 'example' | 'quiz' }
  // 调 LLM 生成 Markdown 文本，前端 fork 子对话后展示（与对话页配合）。
  r.post('/memorize/ai', async (req: Request, res: Response) => {
    try {
      const { term, definition, mode } = req.body || {};
      if (typeof term !== 'string' || !term.trim()) return res.status(400).json({ error: 'term 必填' });
      const def = typeof definition === 'string' && definition.trim() ? definition.trim().slice(0, 2000) : '';

      let provider = null as any;
      let chosenModel: string | null = null;
      const selected = getSelectedModel();
      if (selected) {
        provider = getProviderById(selected.providerId);
        chosenModel = selected.model;
      }
      if (!provider) provider = getDefaultProvider();
      if (!provider) return res.status(400).json({ error: '请先在设置页添加 API 服务商' });

      const model = chosenModel || provider.defaultModel;
      const modeName = mode === 'example' ? '造句/举例' : mode === 'quiz' ? '出题' : '讲解';
      const agent: AgentConfig = {
        id: 'default', name: '背诵助手', role: 'assistant',
        providerId: provider.id, model, enabled: true,
        systemPrompt: '你是 studentbuddy 的背诵助手。用户在学习一个词条/专有名词，请给出高质量的学习内容：讲解清晰、例句地道、可扩展为练习。语言通俗，结构清晰。',
      };

      const promptLines = [
        `请针对下面这个待记忆的词条，生成「${modeName}」内容：`,
        `词条：${term.trim()}`,
        def ? `释义：${def}` : '',
        '',
        mode === 'example'
          ? '要求：给出 2-3 个典型例句/使用场景（若是专有名词则给出它在实际场景中的使用示例），并简要说明用法要点。'
          : mode === 'quiz'
            ? '要求：基于这个词条出 2 道练习题（选择题或填空题，含答案与解析），帮助检验是否记住。'
            : '要求：讲解这个词条的含义、背景/来源（如适用）、记忆技巧（谐音/联想/词根等），帮助牢固记忆。',
        '用 Markdown 组织，只输出内容本身。',
      ].filter(Boolean).join('\n');

      const { text } = await gw.generateOnce(provider, agent, [{ role: 'user', content: promptLines }], 0.4);
      res.json({ content: (text || '').trim() || '（未能生成内容）' });
    } catch (err: any) {
      log.error({ error: err.message }, 'Memorize AI generation failed');
      res.status(500).json({ error: err.message });
    }
  });
}
