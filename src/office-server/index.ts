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

  if (webPath) {
    app.use(express.static(webPath));
  }

  // 会话实时状态快照：每个会话的 UI 状态（阶段/步骤/任务清单/思考/Trace）独立存储，
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

  function pushBuffer(sid: string | undefined, data: any): void {
    if (!sid) return;
    let arr = tokenBuffer.get(sid);
    if (!arr) { arr = []; tokenBuffer.set(sid, arr); }
    arr.push(data);
    if (arr.length > 5000) arr.shift();
    bufferSeen.set(sid, Date.now());
  }

  function writeTo(res: http.ServerResponse, data: any): void {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* 连接已断开，忽略 */ }
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
        tokenBuffer.delete(sid);
        bufferSeen.delete(sid);
      }
      // 新一轮对话：快照从干净状态起步（清掉上一轮残留步骤/清单/思考）。
      sessionStates.start(sid);
    }
    pushBuffer(sid, { type: 'token', ...data });
    broadcast({ type: 'token', ...data });
    // 该轮结束：延迟清缓冲（容让「刚结束时才连上」的客户端回放），此后再次重连不再回放旧轮。
    if (data.done) {
      sessionStates.finish(sid, true);
      setTimeout(() => { tokenBuffer.delete(sid); bufferSeen.delete(sid); }, 2000);
    }
  });
  gateway.on('artifact', (data: any) => {
    pushBuffer(data.sessionId, { type: 'artifact', ...data });
    broadcast({ type: 'artifact', ...data });
  });
  // 失败事件：广播给对应会话，前端据此给出明确的失败反馈
  gateway.on('chat-error', (data: any) => {
    const sid = data.sessionId;
    sessionStates.finish(sid, false, data.error);
    pushBuffer(sid, { type: 'chat-error', ...data });
    broadcast({ type: 'chat-error', ...data });
    // 该轮异常结束：延迟清缓冲，避免重连回放旧轮错误污染下一轮（容让「刚失败时连上」的客户端）。
    setTimeout(() => { tokenBuffer.delete(sid); bufferSeen.delete(sid); }, 2000);
  });
  // 简易 Trace：实时增量（start/span）走缓冲+广播（兼容「新会话先发后连」竞态），
  // 最终完整 payload 仅广播（校准用，丢包不影响已收增量）。
  gateway.on('trace-start', (data: any) => {
    sessionStates.setTrace(data.sessionId, data.trace); // 基线 payload（含 root span）
    pushBuffer(data.sessionId, { type: 'trace-start', ...data });
    broadcast({ type: 'trace-start', ...data });
  });
  gateway.on('trace-span', (data: any) => {
    sessionStates.pushTraceSpan(data.sessionId, data.span); // 增量子 span（前端边收边画）
    pushBuffer(data.sessionId, { type: 'trace-span', ...data });
    broadcast({ type: 'trace-span', ...data });
  });
  gateway.on('trace', (data: any) => {
    sessionStates.setTrace(data.sessionId, data); // 最终校准 payload
    broadcast({ type: 'trace', ...data });
  });
  // 工具调用步骤：结构化 step 事件（前端「工具调用提示」卡片），走缓冲+广播
  // （兼容「新会话先发后连」竞态，与 token 同一套机制）。
  gateway.on('step', (data: any) => {
    sessionStates.upsertStep(data.sessionId, data.step);
    pushBuffer(data.sessionId, { type: 'step', ...data });
    broadcast({ type: 'step', ...data });
  });
  // 任务规划清单：规划阶段 [TODO:...] 步骤清单（WorkBuddy 式任务清单），走缓冲+广播，
  // 前端实时展示并随 step 完成逐个打勾。
  gateway.on('todos', (data: any) => {
    sessionStates.setTodos(data.sessionId, data.todos);
    pushBuffer(data.sessionId, { type: 'todos', ...data });
    broadcast({ type: 'todos', ...data });
  });
  // 需求澄清（grill-me）：模型输出 [ASK:...] 后挂起，下发澄清问题与选项，
  // 前端渲染 ClarifyCard，用户选择后 POST /api/chat/clarify 恢复生成。走缓冲+广播。
  gateway.on('clarify', (data: any) => {
    pushBuffer(data.sessionId, { type: 'clarify', ...data });
    broadcast({ type: 'clarify', ...data });
  });
  // 思考/推理内容（reasoning_content，如 DeepSeek-R1 / OpenAI o 系列）：独立事件，
  // 走缓冲+广播（与 token 同机制），前端以可折叠「思考过程」块实时渲染。
  gateway.on('reasoning', (data: any) => {
    sessionStates.appendReasoning(data.sessionId, data.content);
    pushBuffer(data.sessionId, { type: 'reasoning', ...data });
    broadcast({ type: 'reasoning', ...data });
  });
  // 文件变更事件：AI 读/写/编辑工作区文件后广播，驱动前端「文件变更」卡片（diff + 撤销）。
  // 走缓冲+广播（与 token 同机制），重连客户端也能还原本轮变更清单。
  gateway.on('file-change', (data: any) => {
    pushBuffer(data.sessionId, { type: 'file-change', ...data });
    broadcast({ type: 'file-change', ...data });
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
    const buf = tokenBuffer.get(sid);
    if (buf && buf.length) {
      let terminal = false;
      for (const ev of buf) {
        writeTo(res, ev);
        if (ev.type === 'chat-error' || ev.done === true) terminal = true;
      }
      if (terminal) {
        tokenBuffer.delete(sid);
        bufferSeen.delete(sid);
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
      // step/todos/reasoning/trace-start 等实时状态，否则进行中的 UI 提示会丢失。
      const stillRunning = gateway.getRunningTasks().some(x => x.sessionId === sid && x.phase !== 'done' && x.phase !== 'error');
      if (now - t > 60_000 && !(streamClients.get(sid)?.size) && !stillRunning) {
        tokenBuffer.delete(sid);
        bufferSeen.delete(sid);
      }
    }
    for (const set of streamClients.values()) for (const res of set) writeTo(res, { type: 'ping' });
    for (const res of globalClients) writeTo(res, { type: 'ping' });
  }, 15_000);
  process.on('SIGINT', () => clearInterval(heartbeat));

  const server = http.createServer(app);

  server.listen(PORT, '127.0.0.1', () => {
    serverLog.info(`Office server running on http://127.0.0.1:${PORT}`);
  });

  return server;
}
