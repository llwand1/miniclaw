import { Router, Request, Response } from 'express';
import { getDb } from '../../core/gateway/db';
import crypto from 'node:crypto';

/** 题库路由：AI 生成 / 手动导入的选择题组 CRUD。
 *  data 结构 = QuizData：{ title?: string; questions: { type?, question, options, answer?, explanation? }[] }
 */
export function registerQuiz(r: Router): void {
  // 校验并规范化一条 QuizData；非法返回 null
  function normalize(data: any): { title: string; questions: any[] } | null {
    if (!data || typeof data !== 'object') return null;
    const qs = Array.isArray(data.questions) ? data.questions : null;
    if (!qs || qs.length === 0) return null;
    for (const q of qs) {
      if (!q || typeof q.question !== 'string' || !q.question.trim()) return null;
      if (!q.options || typeof q.options !== 'object') return null;
      const keys = Object.keys(q.options);
      if (keys.length === 0) return null;
    }
    return { title: typeof data.title === 'string' ? data.title.trim().slice(0, 200) : '', questions: qs };
  }

  // 从 [QUIZ]...[/QUIZ] 文本里解析出 QuizData；失败返回 null
  function parseQuizText(text: string): any | null {
    if (!text) return null;
    const m = text.match(/\[QUIZ\]([\s\S]*?)\[\/QUIZ\]/);
    const raw = m ? m[1] : text;
    try {
      const d = JSON.parse(raw.trim());
      return d && Array.isArray(d.questions) && d.questions.length ? d : null;
    } catch {
      return null;
    }
  }

  // ─── 列表：id/title/source/question_count/created_at + data（完整，便于题库页直接渲染练习） ───
  r.get('/quiz-bank', (_req: Request, res: Response) => {
    try {
      const rows = getDb().prepare('SELECT id,title,data,source,created_at FROM quiz_bank ORDER BY created_at DESC').all() as any[];
      const list = rows.map((row) => {
        let qCount = 0;
        try {
          const d = JSON.parse(row.data);
          qCount = Array.isArray(d.questions) ? d.questions.length : 0;
        } catch { /* ignore */ }
        return { id: row.id, title: row.title, source: row.source, created_at: row.created_at, question_count: qCount, data: JSON.parse(row.data) };
      });
      res.json(list);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 保存单条（AI 收藏 / 手动新增）───
  r.post('/quiz-bank', (req: Request, res: Response) => {
    try {
      const { data, source } = req.body || {};
      const norm = normalize(data);
      if (!norm) return res.status(400).json({ error: '题目数据无效：需包含 questions 数组（每项含 question + options）' });
      const src = source === 'import' || source === 'manual' ? source : 'ai';
      const id = `qz-${crypto.randomUUID()}`;
      getDb().prepare("INSERT INTO quiz_bank (id,title,data,source) VALUES (?,?,?,?)")
        .run(id, norm.title, JSON.stringify(norm), src);
      res.json({ id, title: norm.title, source: src, question_count: norm.questions.length });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 删除 ───
  r.delete('/quiz-bank/:id', (req: Request, res: Response) => {
    try {
      const info = getDb().prepare('DELETE FROM quiz_bank WHERE id=?').run(req.params.id);
      if (info.changes === 0) return res.status(404).json({ error: 'not found' });
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 导入：支持三种输入
  //  1) { text: "[QUIZ]...[/QUIZ]" }           —— 从 AI 回复/剪贴板导入
  //  2) { data: QuizData }                     —— 单条结构化数据
  //  3) { items: QuizData[] }                  —— 批量结构化数据
  r.post('/quiz-bank/import', (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const candidates: any[] = [];
      if (typeof body.text === 'string' && body.text.trim()) {
        // 文本里可能含多个 [QUIZ] 块，逐个解析
        const blocks = body.text.match(/\[QUIZ\]([\s\S]*?)\[\/QUIZ\]/g);
        if (blocks) {
          for (const b of blocks) {
            const d = parseQuizText(b);
            if (d) candidates.push(d);
          }
        } else {
          const d = parseQuizText(body.text);
          if (d) candidates.push(d);
        }
      }
      if (body.data) candidates.push(body.data);
      if (Array.isArray(body.items)) candidates.push(...body.items);

      const inserted: { id: string; title: string; question_count: number }[] = [];
      const db = getDb();
      const ins = db.prepare("INSERT INTO quiz_bank (id,title,data,source) VALUES (?,?,?,?)");
      for (const c of candidates) {
        const norm = normalize(c);
        if (!norm) continue;
        const id = `qz-${crypto.randomUUID()}`;
        ins.run(id, norm.title, JSON.stringify(norm), 'import');
        inserted.push({ id, title: norm.title, question_count: norm.questions.length });
      }
      res.json({ imported: inserted.length, items: inserted });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });
}
