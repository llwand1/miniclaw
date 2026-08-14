import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// 独立临时 DATA_DIR,避免连真实库
vi.hoisted(() => {
  const fs = require('node:fs') as typeof import('node:fs');
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'studentbuddy-test-qz-'));
  process.env.DATA_DIR = TMP;
});

import { getDb, closeDb } from '../../core/gateway/db';
import { registerQuiz } from './quiz';
import type { Gateway } from '../../core/gateway';

// Gateway 桩:CRUD/导入/统计路由不触碰 LLM,只有 /quiz/solution、/quiz/analyze、/quiz/solution/one 用到
const fakeGw = {
  generateOnce: async () => ({ text: '模拟题解' }),
} as unknown as Gateway;

function makeServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  registerQuiz(router, fakeGw);
  app.use('/api', router);
  const server = http.createServer(app);
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}/api`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

const QUIZ_DATA = {
  title: '数学测验',
  questions: [
    { question: '1+1=?', options: { A: '1', B: '2', C: '3' }, answer: ['B'], explanation: '基本加法' },
    { question: '2+2=?', options: { A: '3', B: '4', C: '5' }, answer: ['B'], explanation: '基本加法2' },
  ],
};

describe('routes/quiz(学习助手题库路由)', () => {
  beforeAll(() => { getDb(); });
  afterAll(() => { closeDb(); });

  it('POST /quiz-bank 保存题目组,GET 列表可见,统计数量正确', async () => {
    const srv = await makeServer();
    try {
      const res = await fetch(`${srv.url}/quiz-bank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: QUIZ_DATA, source: 'manual' }),
      });
      expect(res.status).toBe(200);
      const saved = await res.json() as any;
      expect(saved.id).toMatch(/^qz-/);
      expect(saved.question_count).toBe(2);

      const listRes = await fetch(`${srv.url}/quiz-bank`);
      expect(listRes.status).toBe(200);
      const list = await listRes.json() as any[];
      expect(list.length).toBeGreaterThanOrEqual(1);
      const mine = list.find((x: any) => x.id === saved.id);
      expect(mine).toBeTruthy();
      expect(mine.question_count).toBe(2);
      expect(mine.source).toBe('manual');
    } finally {
      await srv.close();
    }
  });

  it('POST /quiz-bank 非法数据(无 questions)返回 400', async () => {
    const srv = await makeServer();
    try {
      const res = await fetch(`${srv.url}/quiz-bank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { title: '空' }, source: 'manual' }),
      });
      expect(res.status).toBe(400);
    } finally {
      await srv.close();
    }
  });

  it('POST /quiz-bank/import 从 [QUIZ] 文本导入,支持批量', async () => {
    const srv = await makeServer();
    try {
      const block = `[QUIZ]${JSON.stringify(QUIZ_DATA)}[/QUIZ]`;
      const res = await fetch(`${srv.url}/quiz-bank/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `AI 回复如下\n${block}\n${block}` }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.imported).toBe(2);

      const listRes = await fetch(`${srv.url}/quiz-bank`);
      const list = await listRes.json() as any[];
      expect(list.filter((x: any) => x.source === 'import').length).toBe(2);
    } finally {
      await srv.close();
    }
  });

  it('DELETE /quiz-bank/:id 删除后列表不再包含', async () => {
    const srv = await makeServer();
    try {
      const save = await fetch(`${srv.url}/quiz-bank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: QUIZ_DATA, source: 'manual' }),
      });
      const { id } = await save.json() as any;

      const del = await fetch(`${srv.url}/quiz-bank/${id}`, { method: 'DELETE' });
      expect(del.status).toBe(200);
      expect((await del.json() as any).ok).toBe(true);

      const del2 = await fetch(`${srv.url}/quiz-bank/${id}`, { method: 'DELETE' });
      expect(del2.status).toBe(404);

      const list = await (await fetch(`${srv.url}/quiz-bank`)).json() as any[];
      expect(list.some((x: any) => x.id === id)).toBe(false);
    } finally {
      await srv.close();
    }
  });

  it('POST /quiz/stats/record 落库,GET /quiz/stats 聚合正确率与连对', async () => {
    const srv = await makeServer();
    try {
      const save = await fetch(`${srv.url}/quiz-bank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: QUIZ_DATA, source: 'manual' }),
      });
      const { id } = await save.json() as any;

      // 两次作答:第一题全对,第二题一错一对
      for (const results of [
        [{ question_index: 0, correct: true }, { question_index: 1, correct: false }],
        [{ question_index: 0, correct: true }, { question_index: 1, correct: true }],
      ]) {
        const rec = await fetch(`${srv.url}/quiz/stats/record`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quizId: id, results }),
        });
        expect(rec.status).toBe(200);
      }

      const stRes = await fetch(`${srv.url}/quiz/stats?quizId=${id}`);
      expect(stRes.status).toBe(200);
      const { stats } = await stRes.json() as any;
      expect(stats).toHaveLength(2);
      expect(stats[0].attempts).toBe(2);
      expect(stats[0].correct).toBe(2);
      expect(stats[0].accuracy).toBe(100);
      expect(stats[0].streak).toBe(2); // 连续答对 2 次
      expect(stats[1].attempts).toBe(2);
      expect(stats[1].correct).toBe(1);
      expect(stats[1].accuracy).toBe(50);
      expect(stats[1].streak).toBe(1); // 答错归零后答对 1
      expect(stats[1].best_streak).toBe(1);
    } finally {
      await srv.close();
    }
  });

  it('POST /quiz/stats/record 缺 quizId / 不存在的题库 → 400 / 404', async () => {
    const srv = await makeServer();
    try {
      const noId = await fetch(`${srv.url}/quiz/stats/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results: [] }),
      });
      expect(noId.status).toBe(400);

      const noBank = await fetch(`${srv.url}/quiz/stats/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quizId: 'qz-不存在', results: [{ question_index: 0, correct: true }] }),
      });
      expect(noBank.status).toBe(404);
    } finally {
      await srv.close();
    }
  });
});
