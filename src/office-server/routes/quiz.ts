import { Router, Request, Response } from 'express';
import { getDb } from '../../core/gateway/db';
import crypto from 'node:crypto';
import { Gateway } from '../../core/gateway';
import { AgentConfig } from '../../core/agent';
import { getProviderById, getSelectedModel, getDefaultProvider } from '../../core/gateway/providers';
import { createLogger } from '../../core/logger';

const log = createLogger('api:quiz');

/** 题库路由：AI 生成 / 手动导入的选择题组 CRUD。
 *  data 结构 = QuizData：{ title?: string; questions: { type?, question, options, answer?, explanation?, solution? }[] }
 */
export function registerQuiz(r: Router, gw: Gateway): void {
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

  // ─── 详细题解：做题完成后的可选环节。
  // 接收题目组 + 用户作答（可选，用于针对性讲解做错的题），调 LLM 生成逐题详细题解，
  // 返回 { solutions: string[] }（每题一段 Markdown 讲解）。
  r.post('/quiz/solution', async (req: Request, res: Response) => {
    try {
      const { data, answers } = req.body || {};
      const norm = normalize(data);
      if (!norm) return res.status(400).json({ error: '题目数据无效：需包含 questions 数组（每项含 question + options）' });

      // 解析当前 provider/model（与对话流程一致：优先前端指定 → 已选模型 → 默认服务商）
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
      const agent: AgentConfig = {
        id: 'default', name: '题解助手', role: 'assistant',
        providerId: provider.id, model, enabled: true,
        systemPrompt: '你是 studentbuddy 的题解老师。用户做完一组选择题后，你要针对每道题给出详细讲解：先判断对错，再讲清考点、正确选项为什么对、错误选项为什么错（结合用户作答重点讲错因），最后给出举一反三的提示。语言通俗、结构清晰。',
      };

      // 组装题解请求：题目 + 用户作答（按题号索引）
      const lines: string[] = [];
      lines.push('请为下面这组选择题逐题生成【详细题解】。每题讲解请包含：');
      lines.push('1. 考点（这题考什么知识点）');
      lines.push('2. 正确选项为什么对（必要时给出推导/步骤）');
      lines.push('3. 错误选项为什么错（若用户该题答错，请重点分析用户选的选项错在哪里）');
      lines.push('4. 举一反三提示（1 句即可）');
      lines.push('');
      if (norm.title) lines.push(`题目组：${norm.title}`);
      norm.questions.forEach((q, i) => {
        const optTxt = Object.entries(q.options || {})
          .map(([k, v]) => `${k}. ${v}`).join('　');
        const ansTxt = Array.isArray(q.answer) && q.answer.length ? q.answer.join('、') : '（未提供）';
        const userTxt = answers && Array.isArray(answers[i]) && answers[i].length ? answers[i].join('、') : '（未作答）';
        lines.push('');
        lines.push(`第${i + 1}题：${q.question}`);
        lines.push(`选项：${optTxt}`);
        lines.push(`正确答案：${ansTxt}`);
        lines.push(`用户作答：${userTxt}`);
      });
      lines.push('');
      lines.push('请按题目顺序输出，每题的题解用 Markdown 格式，题与题之间用空行分隔。只输出题解本身，不要输出题解之外的前言或总结。');

      const { text } = await gw.generateOnce(provider, agent, [{ role: 'user', content: lines.join('\n') }], 0.4);
      const solutions = splitSolutions(text, norm.questions.length);
      res.json({ solutions, count: solutions.length });
    } catch (err: any) {
      log.error({ error: err.message }, 'Quiz solution generation failed');
      res.status(500).json({ error: err.message });
    }
  });

  // ─── 一键分析：做完一组题后，分析用户的知识缺陷 → 薄弱点报告。
  // 接收题目组 + 用户作答，调 LLM 输出结构化 JSON：
  // { summary, weak_points: [{ topic, question_indexes, reason, suggestion }], strong_points: string[] }
  // 前端据此展示报告，并支持「针对薄弱点继续出题」（fork 子对话）。
  r.post('/quiz/analyze', async (req: Request, res: Response) => {
    try {
      const { data, answers } = req.body || {};
      const norm = normalize(data);
      if (!norm) return res.status(400).json({ error: '题目数据无效：需包含 questions 数组（每项含 question + options）' });

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
      const agent: AgentConfig = {
        id: 'default', name: '学习分析助手', role: 'assistant',
        providerId: provider.id, model, enabled: true,
        systemPrompt: '你是 studentbuddy 的学习分析老师。根据用户做完一组选择题的作答情况，诊断其知识薄弱点，并给出针对性建议。只输出 JSON，不要输出多余文字。',
      };

      // 组装分析请求：题目 + 用户作答 + 逐题对错标注
      const lines: string[] = [];
      lines.push('请根据下面这组选择题的用户作答，诊断知识薄弱点并输出 JSON 分析报告。');
      lines.push('');
      lines.push('输出 JSON 结构（严格遵循，字段名英文）：');
      lines.push('{');
      lines.push('  "summary": "总体评价（2-3 句，指出整体掌握情况）",');
      lines.push('  "weak_points": [');
      lines.push('    { "topic": "薄弱知识点名称", "question_indexes": [题号, ...], "reason": "为什么薄弱（结合具体错题说明）", "suggestion": "针对性学习建议（1-2 句）" }');
      lines.push('  ],');
      lines.push('  "strong_points": ["掌握较好的知识点，可简要列出"]');
      lines.push('}');
      lines.push('');
      lines.push('要求：weak_points 只列真实暴露出的薄弱点（用户答错的题对应），每题按 1 开始编号；');
      lines.push('不要编造未出现的知识点；薄弱点数量与错误题目数量相匹配；答对的题不要列入 weak_points。');
      lines.push('');
      if (norm.title) lines.push(`题目组：${norm.title}`);
      norm.questions.forEach((q, i) => {
        const optTxt = Object.entries(q.options || {})
          .map(([k, v]) => `${k}. ${v}`).join('　');
        const ansTxt = Array.isArray(q.answer) && q.answer.length ? q.answer.join('、') : '（未提供）';
        const userTxt = answers && Array.isArray(answers[i]) && answers[i].length ? answers[i].join('、') : '（未作答）';
        const correct = Array.isArray(q.answer) && q.answer.length > 0
          && Array.isArray(answers && answers[i])
          && (answers[i] as string[]).length === q.answer.length
          && (q.answer as string[]).every(a => (answers[i] as string[]).includes(a));
        lines.push('');
        lines.push(`第${i + 1}题：${q.question}`);
        lines.push(`选项：${optTxt}`);
        lines.push(`正确答案：${ansTxt}`);
        lines.push(`用户作答：${userTxt}（${correct ? '正确' : '错误或未作答'}）`);
      });

      const { text } = await gw.generateOnce(provider, agent, [{ role: 'user', content: lines.join('\n') }], 0.3);
      const report = parseAnalyzeReport(text);
      res.json(report);
    } catch (err: any) {
      log.error({ error: err.message }, 'Quiz analyze failed');
      res.status(500).json({ error: err.message });
    }
  });

  // ─── 单题一键解析（基于子对话）：
  // 用户对某道题点「一键解析」→ 以父会话 fork 出一个子对话，在子对话中生成该题的详细解析，
  // 并把「请求 + 解析」写入子对话消息流 → 前端可在树状历史里看到这条子对话并继续追问。
  // body: { data, questionIndex, parentSessionId, title? }
  // 返回 { solution, sessionId: 子会话id, parentId }；未传 parentSessionId 时只生成不 fork。
  r.post('/quiz/solution/one', async (req: Request, res: Response) => {
    try {
      const { data, questionIndex, parentSessionId, title } = req.body || {};
      const norm = normalize(data);
      if (!norm) return res.status(400).json({ error: '题目数据无效：需包含 questions 数组' });
      const idx = Number(questionIndex);
      if (!Number.isInteger(idx) || idx < 0 || idx >= norm.questions.length) {
        return res.status(400).json({ error: 'questionIndex 无效' });
      }
      const q = norm.questions[idx];

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
      const agent: AgentConfig = {
        id: 'default', name: '题解老师', role: 'assistant',
        providerId: provider.id, model, enabled: true,
        systemPrompt: '你是 studentbuddy 的题解老师。针对用户指定的某一道选择题，给出详细解析：考点、正确项为什么对、错误项为什么错、解题步骤、举一反三提示。语言通俗、结构清晰。',
      };

      const optTxt = Object.entries(q.options || {})
        .map(([k, v]) => `${k}. ${v}`).join('　');
      const ansTxt = Array.isArray(q.answer) && q.answer.length ? q.answer.join('、') : '（未提供）';
      const prompt = [
        `请详细解析下面这道选择题：`,
        '',
        `题目（第 ${idx + 1} 题）：${q.question}`,
        `选项：${optTxt}`,
        `正确答案：${ansTxt}`,
        '',
        '解析请包含：1. 考点；2. 正确选项为什么对；3. 错误选项为什么错；4. 解题步骤（如适用）；5. 一句举一反三提示。',
        '用 Markdown 组织，只输出解析本身。',
      ].join('\n');

      const { text } = await gw.generateOnce(provider, agent, [{ role: 'user', content: prompt }], 0.4);
      const solution = (text || '').trim() || '（未能生成解析）';

      // fork 子对话：以父会话为父，建子会话并复制历史；再把「请求+解析」写入子会话消息流
      let childId: string | null = null;
      let parentId: string | null = null;
      if (typeof parentSessionId === 'string' && parentSessionId) {
        const db = getDb();
        const parent = db.prepare('SELECT * FROM sessions WHERE id=?').get(parentSessionId) as any;
        if (parent) {
          parentId = parent.id;
          childId = `s-${crypto.randomUUID()}`;
          const rootId = parent.root_id || parent.id;
          const finalTitle = (typeof title === 'string' && title.trim())
            ? title.trim().slice(0, 200)
            : `第 ${idx + 1} 题解析 · ${(q.question || '').slice(0, 12)}`;
          const tx = db.transaction(() => {
            db.prepare("INSERT INTO sessions (id,agent_id,source,title,parent_id,root_id) VALUES (?,?,?,?,?,?)")
              .run(childId, parent.agent_id || 'default', parent.source || 'main', finalTitle, parent.id, rootId);
            db.prepare(`INSERT INTO messages (session_id, role, content, tokens, reasoning, model, tool_call_id, tool_calls, ts)
              SELECT ?, role, content, tokens, reasoning, model, tool_call_id, tool_calls, ts FROM messages WHERE session_id=?`)
              .run(childId, parent.id);
            db.prepare('INSERT INTO messages (session_id,role,content,model) VALUES (?,\'user\',?,?)')
              .run(childId, `请解析第 ${idx + 1} 题：${q.question}`, model);
            db.prepare('INSERT INTO messages (session_id,role,content,model) VALUES (?,\'assistant\',?,?)')
              .run(childId, solution, model);
          });
          tx();
        }
      }

      res.json({ solution, sessionId: childId, parentId, questionIndex: idx });
    } catch (err: any) {
      log.error({ error: err.message }, 'Quiz single solution failed');
      res.status(500).json({ error: err.message });
    }
  });

  // ─── 做题统计上报：收藏后的题目作答结果入库（次数 / 正确数 / 连续正确）。
  // body: { quizId, results: [{ question_index, correct }] } —— 一次提交一组作答结果。
  // 幂等语义：每次提交 attempts+1，correct 记 1/0；streak 答对 +1、答错归零，best_streak 保留峰值。
  r.post('/quiz/stats/record', (req: Request, res: Response) => {
    try {
      const { quizId, results } = req.body || {};
      if (typeof quizId !== 'string' || !quizId) return res.status(400).json({ error: 'quizId 必填' });
      const bank = getDb().prepare('SELECT id FROM quiz_bank WHERE id=?').get(quizId);
      if (!bank) return res.status(404).json({ error: '题库不存在（请先收藏该题目组）' });
      if (!Array.isArray(results) || results.length === 0) return res.status(400).json({ error: 'results 必填' });

      const db = getDb();
      const upsert = db.prepare(`
        INSERT INTO quiz_stats (quiz_id, question_index, attempts, correct, streak, best_streak, updated_at)
        VALUES (?, ?, 1, ?, ?, ?, datetime('now'))
        ON CONFLICT(quiz_id, question_index) DO UPDATE SET
          attempts = attempts + 1,
          correct = correct + excluded.correct,
          streak = CASE WHEN excluded.correct = 1 THEN streak + 1 ELSE 0 END,
          best_streak = MAX(best_streak, CASE WHEN excluded.correct = 1 THEN streak + 1 ELSE 0 END),
          updated_at = datetime('now')
      `);
      const tx = db.transaction(() => {
        for (const r of results) {
          const idx = Number(r && r.question_index);
          const correct = r && r.correct ? 1 : 0;
          if (!Number.isInteger(idx) || idx < 0) continue;
          upsert.run(quizId, idx, correct, correct, correct);
        }
      });
      tx();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── 做题统计查询：GET /api/quiz/stats?quizId=xxx → { stats: [{ question_index, attempts, correct, accuracy, streak, best_streak }] }
  r.get('/quiz/stats', (req: Request, res: Response) => {
    try {
      const quizId = String(req.query.quizId || '');
      if (!quizId) return res.status(400).json({ error: 'quizId 必填' });
      const rows = getDb().prepare('SELECT question_index, attempts, correct, streak, best_streak FROM quiz_stats WHERE quiz_id=? ORDER BY question_index').all(quizId) as any[];
      const stats = rows.map((r: any) => ({
        question_index: r.question_index,
        attempts: r.attempts,
        correct: r.correct,
        accuracy: r.attempts > 0 ? Math.round((r.correct / r.attempts) * 100) : 0,
        streak: r.streak,
        best_streak: r.best_streak,
      }));
      res.json({ quizId, stats });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}

/** 宽容解析一键分析报告：剥代码围栏 → 取第一个 JSON 对象 → 兜底为纯文本。 */
function parseAnalyzeReport(text: string): any {
  const t = (text || '').trim();
  if (!t) return { summary: '', weak_points: [], strong_points: [] };
  // 1) 剥 ```json ... ``` 围栏
  let raw = t.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '');
  // 2) 取第一个 { ... } 对象（可能前后有说明文字）
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) raw = m[0];
  try {
    const d = JSON.parse(raw);
    if (d && typeof d === 'object') {
      return {
        summary: typeof d.summary === 'string' ? d.summary : '',
        weak_points: Array.isArray(d.weak_points) ? d.weak_points : [],
        strong_points: Array.isArray(d.strong_points) ? d.strong_points : [],
      };
    }
  } catch {
    // 尾逗号容错
    try {
      const d = JSON.parse(raw.replace(/,\s*([}\]])/g, '$1'));
      if (d && typeof d === 'object') {
        return {
          summary: typeof d.summary === 'string' ? d.summary : '',
          weak_points: Array.isArray(d.weak_points) ? d.weak_points : [],
          strong_points: Array.isArray(d.strong_points) ? d.strong_points : [],
        };
      }
    } catch { /* fallthrough */ }
  }
  // 3) 兜底：整段作为 summary（模型未按 JSON 输出）
  return { summary: t, weak_points: [], strong_points: [] };
}

/** 把模型返回的题解文本按「第N题：」/「### 第N题」/序号标题切分为逐题数组。
 *  若无法识别分题结构，则整体作为一段返回（长度对齐题目数时逐题填充）。 */
function splitSolutions(text: string, questionCount: number): string[] {
  const t = (text || '').trim();
  if (!t) return [];
  // 常见分题标题：第1题 / ### 1. / **1.** / 1、等
  const heads = t.split(/\n(?=(?:#{1,6}\s*)?(?:第\s*\d+\s*题|(?:^|\s)\d+[.、])\s*)/);
  const parts = heads.map(h => h.trim()).filter(Boolean);
  if (parts.length >= questionCount && questionCount > 0) return parts.slice(0, questionCount);
  if (parts.length > 1) return parts;
  return [t];
}
