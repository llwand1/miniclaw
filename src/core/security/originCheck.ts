/**
 * security/originCheck —— Express 中间件，防御 DNS rebinding 与跨源请求。
 *
 * 威胁模型：studentbuddy 的 office-server 监听 127.0.0.1:18791，
 * 用户在本机浏览器访问恶意网站时，该网站可尝试 fetch('http://127.0.0.1:18791/api/...')。
 * 浏览器同源策略会阻止读取响应，但「简单请求」(GET/POST 表单) 仍可发出，
 * 可能触发 AI 对话、文件写入等副作用。
 *
 * 防御：
 * 1) 校验 Origin/Referer 头，只允许 localhost / 127.0.0.1。
 * 2) 对写操作（POST/PUT/DELETE）强制要求有效 Origin。
 * 3) 设置 CORS 为严格白名单（仅开发期的 Vite 端口）。
 */
import { Request, Response, NextFunction } from 'express';

/** 允许的 Origin host（端口通配）。 */
const ALLOWED_HOSTS = ['localhost', '127.0.0.1', '::1'];

/** 允许的 Origin 协议。 */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return ALLOWED_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

/** 主中间件：校验 Origin，拒绝外部来源。 */
export function originCheck(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  const referer = req.headers.referer;

  // GET 请求若不带 Origin/Referer（如 curl）则放行，但若有 Origin 必须是允许的来源。
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (origin && !isAllowedOrigin(origin)) {
      res.status(403).json({ error: 'Forbidden: disallowed origin' });
      return;
    }
    if (referer && !isRefererAllowed(referer)) {
      res.status(403).json({ error: 'Forbidden: disallowed referer' });
      return;
    }
    next();
    return;
  }

  // 写操作：必须有有效 Origin
  if (!origin || !isAllowedOrigin(origin)) {
    res.status(403).json({ error: 'Forbidden: missing or disallowed origin' });
    return;
  }
  next();
}

function isRefererAllowed(referer: string): boolean {
  try {
    const url = new URL(referer);
    return ALLOWED_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

/** CORS 白名单配置（替换原 app.use(cors()) 全开）。 */
export const corsWhitelist = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void): void => {
  // 允许同源（无 Origin，如服务端到服务端）
  if (!origin) return callback(null, true);
  if (isAllowedOrigin(origin)) return callback(null, true);
  return callback(new Error(`Not allowed by CORS: ${origin}`), false);
};
