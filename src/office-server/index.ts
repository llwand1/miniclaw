import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { createApiRouter } from './routes/api';
import { Gateway } from '../core/gateway';
import { createLogger } from '../core/logger';

const serverLog = createLogger('server');
const PORT = parseInt(process.env.PORT || '18791', 10);

export function createServer(gateway: Gateway, webPath?: string): http.Server {
  const app = express();

  app.use(cors());
  app.use(express.json());

  if (webPath) {
    app.use(express.static(webPath));
  }

  app.use('/api', createApiRouter(gateway));

  // sessionId -> 该会话的 SSE 连接集合；只向对应会话推送 token（修复 P1-1 串台）
  const streamClients = new Map<string, Set<http.ServerResponse>>();
  gateway.on('token', (data: any) => {
    const set = streamClients.get(data.sessionId);
    if (set) for (const res of set) res.write(`data: ${JSON.stringify(data)}\n\n`);
  });

  app.get('/api/stream', (req, res) => {
    const sid = (req.query.sessionId as string) || '*';
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    if (!streamClients.has(sid)) streamClients.set(sid, new Set());
    streamClients.get(sid)!.add(res);

    req.on('close', () => {
      streamClients.get(sid)?.delete(res);
    });
  });

  const server = http.createServer(app);

  server.listen(PORT, '127.0.0.1', () => {
    serverLog.info(`Office server running on http://127.0.0.1:${PORT}`);
  });

  return server;
}
