import { Router, Request, Response } from 'express';
import { Gateway } from '../../core/gateway';
import { createLogger } from '../../core/logger';

const log = createLogger('api:chat');

/** 注册对话 / 模型 / 中止 / 澄清 / 后台任务路由 */
export function registerChat(r: Router, gw: Gateway): void {
  // 对话
  r.post('/chat', async (req: Request, res: Response) => {
    const { text, sessionId, source, temperature, providerId, model, resend, skillNames, attachments } = req.body;
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
  // 提交到此端点，网关把选择写入历史并恢复完整生成流程。
  r.post('/chat/clarify', async (req: Request, res: Response) => {
    const { sessionId, answer } = req.body;
    if (!sessionId || typeof answer !== 'string' || !answer.trim()) {
      return res.status(400).json({ error: 'sessionId 与 answer 必填' });
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
