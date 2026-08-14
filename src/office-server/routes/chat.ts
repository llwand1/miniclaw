import { Router, Request, Response } from 'express';
import { Gateway } from '../../core/gateway';
import { createLogger } from '../../core/logger';

const log = createLogger('api:chat');

// ─── 简单令牌桶限流（防本机脚本高频打 /api/chat 消耗模型额度） ───
// 按「会话」+「IP」双维度计数；窗口 60s，上限可调。超限返回 429。
const CHAT_LIMIT = 30; // 每分钟最多对话次数（正常交互远低于此）
const chatBuckets = new Map<string, number[]>();

function rateLimitChat(key: string): boolean {
  const now = Date.now();
  const arr = (chatBuckets.get(key) || []).filter((t) => now - t < 60_000);
  if (arr.length >= CHAT_LIMIT) return false;
  arr.push(now);
  chatBuckets.set(key, arr);
  return true;
}

function chatLimitKey(sessionId: unknown, req: Request): string {
  const sid = typeof sessionId === 'string' && sessionId ? sessionId : 'anon';
  const ip = req.socket?.remoteAddress || '0';
  return `${ip}:${sid}`;
}

/** 注册对话 / 模型 / 中止 / 澄清 / 后台任务路由 */
export function registerChat(r: Router, gw: Gateway): void {
  // 对话
  r.post('/chat', async (req: Request, res: Response) => {
    const { text, sessionId, source, temperature, providerId, model, resend, skillNames, attachments } = req.body;
    // 限流：超限直接 429，不进入网关（不消耗模型额度）
    if (!rateLimitChat(chatLimitKey(sessionId, req))) {
      return res.status(429).json({ error: `请求过于频繁：每分钟最多 ${CHAT_LIMIT} 次对话` });
    }
    try {
      const sid = await gw.handleMessage({ source: source || 'main', sessionId, text, temperature, providerId, model, resend: !!resend, skillNames: Array.isArray(skillNames) ? skillNames : undefined, attachments: Array.isArray(attachments) ? attachments : undefined });
      res.json({ sessionId: sid });
    } catch (err: any) {
      if (err.message === '__ABORTED__') return res.json({ sessionId, aborted: true });
      log.error({ error: err.message }, 'Chat error');
      res.status(500).json({ error: err.message });
    }
  });

  // 中止对话
  r.post('/chat/abort', (req: Request, res: Response) => {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId 不能为空' });
    const ok = gw.abort(sessionId);
    res.json({ ok });
  });

  // 需求澄清回复（grill-me）：模型 [ASK:...] 挂起后，用户从澄清卡片选择/输入答案，
  // 提交到此端点，网关把选择写入历史并恢复完整生成流程。同样受限流保护（消耗模型额度）。
  r.post('/chat/clarify', async (req: Request, res: Response) => {
    const { sessionId, answer } = req.body;
    if (!sessionId || typeof answer !== 'string' || !answer.trim()) {
      return res.status(400).json({ error: 'sessionId 与 answer 必填' });
    }
    if (!rateLimitChat(chatLimitKey(sessionId, req))) {
      return res.status(429).json({ error: `请求过于频繁：每分钟最多 ${CHAT_LIMIT} 次对话` });
    }
    try {
      const sid = await gw.answerClarify(sessionId, answer.trim());
      res.json({ sessionId: sid });
    } catch (err: any) {
      if (err.message === '__ABORTED__') return res.json({ sessionId, aborted: true });
      res.status(500).json({ error: err.message });
    }
  });

  // 后台任务：当前进行中的所有生成任务（供底部任务栏初始化对齐）
  r.get('/running-tasks', (_req: Request, res: Response) => {
    try { res.json({ tasks: gw.getRunningTasks() }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });
}
