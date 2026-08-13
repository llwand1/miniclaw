import { Router, Request, Response } from 'express';
import { getOwnUsageStats, getCcSwitchUsage, syncCcSwitchProviders, getCcSwitchDbPath, setCcSwitchDbPath } from '../../core/usage';

/** 注册 Token 用量统计路由 */
export function registerUsage(r: Router): void {
  r.get('/usage/stats', (req: Request, res: Response) => {
    try {
      const period = ((req.query.period as string) || 'all') as any;
      if (!['today', '7d', '30d', 'all'].includes(period)) return res.status(400).json({ error: 'period 无效' });
      const ccDbPath = getCcSwitchDbPath();
      const own = getOwnUsageStats(ccDbPath, period);
      const ccSwitch = getCcSwitchUsage(ccDbPath);
      res.json({ own, ccSwitch });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  r.get('/usage/cc-config', (_req: Request, res: Response) => {
    try { res.json({ dbPath: getCcSwitchDbPath() }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  r.put('/usage/cc-config', (req: Request, res: Response) => {
    try {
      const { dbPath } = req.body || {};
      if (typeof dbPath !== 'string' || !dbPath.trim()) return res.status(400).json({ error: 'dbPath 必填' });
      setCcSwitchDbPath(dbPath.trim());
      res.json({ ok: true, dbPath: dbPath.trim() });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  r.post('/usage/cc-sync', (req: Request, res: Response) => {
    try {
      const result = syncCcSwitchProviders(getCcSwitchDbPath());
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });
}
