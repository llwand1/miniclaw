import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { createApiRouter } from './routes/api';
import { Gateway } from '../core/gateway';
import { createLogger } from '../core/logger';
import { originCheck, corsWhitelist } from '../core/security/originCheck';
import { SessionStateStore } from '../core/gateway/session-state';

const serverLog = createLogger('server');
const PORT = parseInt(process.env.PORT || '18791', 10);

export function createServer(gateway: Gateway, webPath?: string): http.Server {
  const app = express();

  // 安全：CORS 严格白名单（替换原 app.use(cors()) 全开）
  // 仅允许本机 dev server (5173) 与同源请求
  app.use(cors({ origin: corsWhitelist, credentials: false }));
  app.use(express.json({ limit: '2mb' })); // 安全：限制请求体大小，防大 payload DoS

  // 安全：基础响应头（去掉框架指纹 + nosniff + 禁止被 iframe 嵌入 + CSP）
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // CSP：脚本仅同源；样式允许内联（组件内嵌 <style> 如 MC_CSS）；图片允许 data:/blob:
    // （预览面板用 URL.createObjectURL）；iframe 预览为同源 srcDoc + sandbox（另见 FileView/PreviewPage）。
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "font-src 'self' data:",
        "frame-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
    );
    next();
  });

  if (webPath) {
    app.use(express.static(webPath));
  }

  // 会话实时状态快照：每个会话的 UI 状态（阶段/步骤/任务清单/思考）独立存储，
  // 供 /api/sessions/:id/live 查询与前端切回会话时恢复（架构独立性加强）。
  const sessionStates = new SessionStateStore();

  // 安全：Origin 校验中间件，防御 DNS rebinding 与跨源写操作
  app.use('/api', originCheck);
  app.use('/auth', originCheck);
  app.use('/api', createApiRouter(gateway, sessionStates));

  // sessionId -> 该会话的 SSE 连接集合；只向对应会话推送 token（修复 P1-1 串台）
  const streamClients = new Map<string, Set<http.ServerResponse>>();
  // 通配订阅者（如预览面板）：接收所有事件（artifact 等），与按会话的订阅互斥。
  const globalClients = new Set<http.ServerResponse>();

  // 按会话缓冲已发出的事件：解决「新会话先发请求、SSE 后连」的竞态丢包。
  // 客户端连上后先回放缓冲，再接入实时推送。关键修复：缓冲不能在 emit 时删除，
  // 否则晚连的客户端（新会话先发请求后连 SSE）会永远收不到已发出的 token / 错误。
  // 改为「客户端连上回放、且该轮已终止(done/error)后才清缓冲」，并用 TTL 兜底回收。
  const tokenBuffer = new Map<string, any[]>();
  const bufferSeen = new Map<string, number>(); // sid -> 末次写入时间，用于 TTL 回收
  // 每个会话的单调递增事件序号：客户端断线重连时携带「已收到 seq」，服务端只回放更新的，
  // 避免把已消费的 token 正文/思考再次 append 导致回复重复或被冲掉（Last-Event-ID 语义）。
  const bufferSeq = new Map<string, number>();

  function pushBuffer(sid: string | undefined, data: any): any {
    if (!sid) return data;
    let arr = tokenBuffer.get(sid);
    if (!arr) { arr = []; tokenBuffer.set(sid, arr); }
    const seq = (bufferSeq.get(sid) || 0) + 1;
    bufferSeq.set(sid, seq);
    const ev = { ...data, seq };
    arr.push(ev);
    if (arr.length > 5000) arr.shift();
    bufferSeen.set(sid, Date.now());
    return ev;
  }

  function dropBuffer(sid: string): void {
    tokenBuffer.delete(sid);
    bufferSeen.delete(sid);
    bufferSeq.delete(sid);
  }

  function writeTo(res: http.ServerResponse, data: any): void {
    if (res.destroyed || res.writableEnded) return;
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* 连接已断开，忽略 */ }
  }

  /** 统一「入缓冲 + 实时广播」：广播的必须是与缓冲同一份带 seq 的事件，
   *  否则前端实时收到的没有 seq、lastSeqRef 永远为 0，断线重连 since=0 会全量回放导致重复。 */
  function emitAndBroadcast(data: any): void {
    const ev = pushBuffer(data.sessionId, data);
    broadcast(ev);
  }

  function broadcast(data: any): void {
    const set = streamClients.get(data.sessionId || '*');
    if (set) for (const res of set) writeTo(res, data);
    for (const res of globalClients) writeTo(res, data);
  }

  gateway.on('token', (data: any) => {
    const sid = data.sessionId;
    // 新一轮开始：若上一轮已结束（缓冲末位是 done/error），先清空累积缓冲，
    // 避免 EventSource 重连把上一轮的 token 回放、前端又 append 一次导致回复被重复/冲掉。
    if (!data.done && data.content) {
      const arr = tokenBuffer.get(sid);
      if (arr && arr.length && (arr[arr.length - 1].done === true || arr[arr.length - 1].type === 'chat-error')) {
        dropBuffer(sid);
      }
      // 新一轮对话：快照从干净状态起步（清掉上一轮残留步骤/清单/思考）。
      sessionStates.start(sid);
    }
    emitAndBroadcast({ type: 'token', ...data });
    // 该轮结束：延迟清缓冲（容让「刚结束时才连上」的客户端回放），此后再次重连不再回放旧轮。
    if (data.done) {
      sessionStates.finish(sid, true);
      setTimeout(() => dropBuffer(sid), 2000);
    }
  });
  gateway.on('artifact', (data: any) => {
    emitAndBroadcast({ type: 'artifact', ...data });
  });
  // 失败事件：广播给对应会话，前端据此给出明确的失败反馈
  gateway.on('chat-error', (data: any) => {
    const sid = data.sessionId;
    sessionStates.finish(sid, false, data.error);
    emitAndBroadcast({ type: 'chat-error', ...data });
    // 该轮异常结束：延迟清缓冲，避免重连回放旧轮错误污染下一轮（容让「刚失败时连上」的客户端）。
    setTimeout(() => dropBuffer(sid), 2000);
  });
  // 用户主动停止：广播给对应会话，前端据此给出「已停止」反馈（而非静默收尾），
  // 并保留已产出的过程信息（步骤/清单/思考/部分回复）可见。
  gateway.on('chat-stopped', (data: any) => {
    emitAndBroadcast({ type: 'chat-stopped', ...data });
  });
  // 工具调用步骤：结构化 step 事件（前端「工具调用提示」卡片），走缓冲+广播
  // （兼容「新会话先发后连」竞态，与 token 同一套机制）。
  gateway.on('step', (data: any) => {
    sessionStates.upsertStep(data.sessionId, data.step);
    emitAndBroadcast({ type: 'step', ...data });
  });
  // 任务规划清单：规划阶段 [TODO:...] 步骤清单（WorkBuddy 式任务清单），走缓冲+广播，
  // 前端实时展示并随 step 完成逐个打勾。
  gateway.on('todos', (data: any) => {
    sessionStates.setTodos(data.sessionId, data.todos);
    emitAndBroadcast({ type: 'todos', ...data });
  });
  // 需求澄清（grill-me）：模型输出 [ASK:...] 后挂起，下发澄清问题与选项，
  // 前端渲染 ClarifyCard，用户选择后 POST /api/chat/clarify 恢复生成。走缓冲+广播。
  gateway.on('clarify', (data: any) => {
    emitAndBroadcast({ type: 'clarify', ...data });
  });
  // 思考/推理内容（reasoning_content，如 DeepSeek-R1 / OpenAI o 系列）：独立事件，
  // 走缓冲+广播（与 token 同机制），前端以可折叠「思考过程」块实时渲染。
  gateway.on('reasoning', (data: any) => {
    sessionStates.appendReasoning(data.sessionId, data.content);
    emitAndBroadcast({ type: 'reasoning', ...data });
  });
  // 文件变更事件：AI 读/写/编辑工作区文件后广播，驱动前端「文件变更」卡片（diff + 撤销）。
  // 走缓冲+广播（与 token 同机制），重连客户端也能还原本轮变更清单。
  gateway.on('file-change', (data: any) => {
    emitAndBroadcast({ type: 'file-change', ...data });
  });
  // 后台任务 run-state：会话级 + 全局双广播（任务栏即使切走也持续收进度）。
  // 不入 buffer：run-state 的 done 字段与 token 终态判定会冲突；初始阶段靠
  // GET /api/running-tasks 快照对齐，切回会话时任务栏/Messages 以实时事件为准。
  gateway.on('run-state', (data: any) => {
    broadcast({ type: 'run-state', ...data });
  });

  app.get('/api/stream', (req, res) => {
    const sid = (req.query.sessionId as string) || '*';
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // 通配：接收全部事件（预览面板用），与按会话订阅互斥
    if (sid === '*') {
      globalClients.add(res);
      req.on('close', () => globalClients.delete(res));
      return;
    }

    // 先回放本轮已缓冲的事件（修复竞态丢包），再接入实时推送。
    // 若该轮已终止（出现 done 或 chat-error），回放后清空缓冲——该会话本轮数据已交付完毕。
    // 断线重连去重：客户端携带 lastSeq（URL 参数 since / Last-Event-ID 头），只回放 seq 更大的事件，
    // 避免把已消费的 token 正文/思考再次 append 导致回复重复或冲掉（配合前端手动重连）。
    const sinceRaw = (req.headers['last-event-id'] as string) || (req.query.since as string) || '0';
    const since = parseInt(sinceRaw, 10) || 0;
    const buf = tokenBuffer.get(sid);
    if (buf && buf.length) {
      let terminal = false;
      for (const ev of buf) {
        if (since > 0 && (ev.seq || 0) <= since) continue;
        writeTo(res, ev);
        if (ev.type === 'chat-error' || ev.done === true) terminal = true;
      }
      if (terminal) {
        dropBuffer(sid);
      }
    }

    if (!streamClients.has(sid)) streamClients.set(sid, new Set());
    streamClients.get(sid)!.add(res);

    req.on('close', () => {
      streamClients.get(sid)?.delete(res);
    });
  });

  // 心跳：每 15s 发送 SSE 注释，保持连接活跃，避免被系统/代理回收；
  // 同时用 TTL 回收「发过事件但从未被回放清空」的会话缓冲，防止内存泄漏。
  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const [sid, t] of bufferSeen) {
      // 该会话仍在后台生成（任务未完成）时保留缓冲：用户切走再切回需要回放
      // step/todos/reasoning 等实时状态，否则进行中的 UI 提示会丢失。
      const stillRunning = gateway.getRunningTasks().some(x => x.sessionId === sid && x.phase !== 'done' && x.phase !== 'error');
      if (now - t > 60_000 && !(streamClients.get(sid)?.size) && !stillRunning) {
        dropBuffer(sid);
      }
    }
    // 心跳探测断链：客户端异常断开（崩溃/休眠/网络切换）时 write 会失败或 res 已销毁，
    // 从订阅集合中移除死连接，避免持续向其写事件造成资源泄漏；对端正常 close 已由 req.on('close') 处理。
    for (const [sid, set] of streamClients) {
      for (const res of set) {
        if (res.destroyed || res.writableEnded) { set.delete(res); continue; }
        try {
          res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
        } catch {
          set.delete(res);
        }
      }
      if (set.size === 0) streamClients.delete(sid);
    }
    for (const res of globalClients) {
      if (res.destroyed || res.writableEnded) { globalClients.delete(res); continue; }
      try {
        res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
      } catch {
        globalClients.delete(res);
      }
    }
  }, 15_000);
  process.on('SIGINT', () => clearInterval(heartbeat));

  const server = http.createServer(app);

  server.listen(PORT, '127.0.0.1', () => {
    serverLog.info(`Office server running on http://127.0.0.1:${PORT}`);
  });

  return server;
}
