import { Router, Request, Response } from 'express';
import { getPolicy, setPolicy } from '../../core/security/policy';
import { listPendingApprovals, listAllApprovals, approveItem, rejectItem, getApprovalStats } from '../../core/security/approval';

/** 注册安全路由：策略 / 审批 / 沙箱 */
export function registerSecurity(r: Router): void {
  // 读取安全策略（路径黑名单、扩展名白名单、写入限流、审批模式、沙箱开关）
  r.get('/security/policy', (_req: Request, res: Response) => {
    try {
      res.json(getPolicy());
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // 更新安全策略（部分字段，合并存储）
  r.put('/security/policy', (req: Request, res: Response) => {
    try {
      const updated = setPolicy(req.body || {});
      res.json(updated);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // 审批队列：列出 pending 项
  r.get('/security/approvals', (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      if (status === 'pending') return res.json(listPendingApprovals());
      if (status === 'all') return res.json(listAllApprovals(200));
      res.json(listPendingApprovals());
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // 批准某审批项：把沙箱暂存内容 apply 到目标文件
  r.post('/security/approvals/:id/approve', (req: Request, res: Response) => {
    try {
      const item = approveItem(String(req.params.id));
      // 广播 file-change 让前端刷新（可选）
      res.json({ ok: true, item });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  // 拒绝某审批项：删除沙箱暂存，目标文件不变
  r.post('/security/approvals/:id/reject', (req: Request, res: Response) => {
    try {
      const item = rejectItem(String(req.params.id));
      res.json({ ok: true, item });
    } catch (err: any) { res.status(400).json({ error: err.message }); }
  });

  // 审批统计：pending 数量、今日处理量等
  r.get('/security/stats', (_req: Request, res: Response) => {
    try {
      res.json(getApprovalStats());
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });
}
