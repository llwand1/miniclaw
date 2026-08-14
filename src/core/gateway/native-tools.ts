/**
 * 原生 function call 工具循环（从 gateway/index.ts 拆出）。
 *
 * 与「文本标记路径」（[SEARCH:]/[FS]）并行：模型带原生 tools 参数请求，
 * 若返回 tool_calls 则逐个执行并以 tool 角色回灌，直到无 tool_calls 或达到轮数上限。
 */
import { getDb } from './db';
import Database from 'better-sqlite3';
import { AgentEngine, AgentConfig, ProviderConfig } from '../agent';
import { ChatMessage, ToolDefinition, ToolCall } from '../adapter/types';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../logger';
import { getWorkspaceRoot, fsRead, fsGrep, fsEdit, fsWrite } from '../fs-tools';
import { trimMarkers, extractMemos, extractTodos, createTodoTracker, FsToolCall } from './parsers';
import type { TodoTracker } from './parsers';
import { estimateTokens } from './context';
import { performSearches, performFetches } from './searcher';
import type { SearchConfig } from '../search';
import type { RunningTaskPhase } from './run-state';

const log = createLogger('gateway:native-tools');

/** 原生 function call 工具循环上限：模型连续发起工具调用时最多执行轮数，防死循环。 */
const MAX_TOOL_TURNS = 8;

/** native-tools 需要的 Gateway 能力（由 Gateway 实例满足）。 */
export interface NativeToolsHost {
  engine: AgentEngine;
  emit(event: string, payload: any): void;
  tickRunning(sessionId: string, phase: RunningTaskPhase, chars?: number): void;
  finishRunning(sessionId: string, done: boolean, error?: string): void;
  publishArtifacts(sessionId: string, text: string): void;
  extractMemories(history: ChatMessage[], reply: string, source?: string): void;
}

/**
 * 执行单个文件工具调用（read/grep/edit/write，文本标记 [FS] 路径）：
 * 发 step 事件驱动前端「正在调用工具」卡片，调用 fs-tools 落盘/读取，
 * 可撤销的 edit/write 广播 file-change 事件（前端 diff + 一键撤销），返回给模型的结果文本。
 */
export async function runFileTool(host: NativeToolsHost, sessionId: string, call: FsToolCall): Promise<string> {
  const stepId = uuidv4();
  const names: Record<string, string> = { read: '读取文件', grep: '搜索文件', edit: '编辑文件', write: '写入文件' };
  host.emit('step', { sessionId, step: { stepId, name: names[call.action] || call.action, tool: 'fs', status: 'running', args: [call.path], startedAt: Date.now() } });
  try {
    let result = '';
    if (call.action === 'read') {
      const r = fsRead(call.path);
      result = `【文件 ${call.path}】\n${r.content}` + (r.truncated ? `\n（已截断，全文 ${r.size} 字节，可用 grep 定位后读取片段）` : '');
    } else if (call.action === 'grep') {
      const g = fsGrep(call.pattern || '', call.path);
      result = `【grep "${call.pattern}" in ${call.path}】\n` + g.matches.map(m => `${m.path}:${m.line}: ${m.text}`).join('\n') + (g.truncated ? `\n（匹配过多，已截断，扫描 ${g.scanned} 个文件）` : '');
    } else if (call.action === 'edit') {
      const e = fsEdit(call.path, call.old || '', call.new || '', call.occurrence, sessionId);
      host.emit('file-change', {
        sessionId,
        change: { changeId: e.changeId, path: call.path, existed: (e.before || '').length > 0, old: e.before, new: e.after, revertible: !e.sandboxed },
      });
      result = `【已编辑 ${call.path}】替换 ${e.replaced} 处` + (e.sandboxed ? '（已暂存沙箱，待审批）' : '');
    } else {
      const w = fsWrite(call.path, call.content || '', sessionId);
      host.emit('file-change', {
        sessionId,
        change: { changeId: w.changeId, path: call.path, existed: (w.before || '').length > 0, old: w.before, new: call.content || '', revertible: !w.sandboxed },
      });
      result = `【已写入 ${call.path}】` + (w.sandboxed ? '（已暂存沙箱，待审批）' : '');
    }
    host.emit('step', { sessionId, step: { stepId, status: 'done', endedAt: Date.now(), result } });
    return result;
  } catch (err: any) {
    host.emit('step', { sessionId, step: { stepId, status: 'error', error: err.message, endedAt: Date.now() } });
    return `【${call.action} ${call.path}】失败：${err.message}`;
  }
}

/**
 * 构建原生 function call 工具清单(OpenAI function calling / Anthropic tools)。
 * 仅返回「当前已启用」的工具:联网搜索(search_web/fetch_page)+ 工作区文件工具(fs_*)。
 * 未启用任何工具时返回空数组 → gateway 走原有文本标记路径。
 */
export function buildNativeTools(searchEnabled: boolean, workspaceConfigured: boolean): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  if (searchEnabled) {
    tools.push({
      type: 'function',
      function: {
        name: 'search_web',
        description: '联网搜索获取实时/最新信息。当用户问题需要时效性信息、事实核验或明确要求查网页时调用。',
        parameters: {
          type: 'object',
          properties: { queries: { type: 'array', items: { type: 'string' }, description: '搜索关键词列表(1-3 个,越具体越好)' } },
          required: ['queries'],
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'fetch_page',
        description: '抓取指定网页的正文内容(最多 8000 字符)。当搜索结果需要详情、或用户给出具体 URL 时调用。',
        parameters: {
          type: 'object',
          properties: { urls: { type: 'array', items: { type: 'string' }, description: '要抓取的网页 URL 列表' } },
          required: ['urls'],
        },
      },
    });
  }
  if (workspaceConfigured) {
    tools.push({
      type: 'function',
      function: {
        name: 'fs_read',
        description: '读取工作区内文件的内容(路径相对工作区根目录)。',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: '相对工作区的文件路径,如 src/app.ts' } },
          required: ['path'],
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'fs_grep',
        description: '在工作区内按正则表达式搜索文本,返回匹配的文件/行/内容。',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: '正则表达式' },
            path: { type: 'string', description: '搜索范围(目录或文件),默认 "."' },
          },
          required: ['pattern'],
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'fs_edit',
        description: '编辑工作区内文件:用 new 替换 old(需逐字匹配)。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '相对工作区的文件路径' },
            old: { type: 'string', description: '待替换的原文(必须与文件内容逐字一致)' },
            new: { type: 'string', description: '替换后的新文本' },
            occurrence: { type: 'string', enum: ['first', 'all'], description: '替换第几处,默认 first' },
          },
          required: ['path', 'old', 'new'],
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'fs_write',
        description: '写入工作区内文件(创建新文件或覆盖已有文件内容)。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '相对工作区的文件路径' },
            content: { type: 'string', description: '完整文件内容' },
          },
          required: ['path', 'content'],
        },
      },
    });
  }
  return tools;
}

/** 执行单个原生工具调用(解析 JSON 参数 → 复用 performSearches/performFetches/fs-tools),emit step + file-change。 */
export async function executeNativeToolCall(host: NativeToolsHost, sessionId: string, call: ToolCall, searchConfig: SearchConfig): Promise<string> {
  const stepId = uuidv4();
  const args: any = (() => { try { return JSON.parse(call.arguments || '{}'); } catch { return {}; } })();
  const label: Record<string, string> = { search_web: '联网搜索', fetch_page: '抓取网页', fs_read: '读取文件', fs_grep: '搜索文件', fs_edit: '编辑文件', fs_write: '写入文件' };
  const kind = call.name.startsWith('fs_') ? 'fs' : call.name === 'fetch_page' ? 'fetch' : 'search';
  host.emit('step', { sessionId, step: { stepId, name: label[call.name] || call.name, tool: kind, status: 'running', args: [call.arguments], startedAt: Date.now() } });
  try {
    let result = '';
    if (call.name === 'search_web') {
      host.tickRunning(sessionId, 'searching');
      const queries = Array.isArray(args.queries) ? args.queries : [];
      result = await performSearches(queries, searchConfig, (p) => {
        host.emit('step', { sessionId, step: { stepId, status: 'running', progress: { done: p.done, total: p.total, item: p.item, ok: p.ok, summary: p.summary }, result: `正在搜索 ${p.done}/${p.total}…` } });
      });
    } else if (call.name === 'fetch_page') {
      host.tickRunning(sessionId, 'fetching');
      const urls = Array.isArray(args.urls) ? args.urls : [];
      result = await performFetches(urls, (p) => {
        host.emit('step', { sessionId, step: { stepId, status: 'running', progress: { done: p.done, total: p.total, item: p.item, ok: p.ok, summary: p.summary }, result: `正在抓取 ${p.done}/${p.total}…` } });
      });
    } else if (call.name === 'fs_read') {
      const r = fsRead(String(args.path || ''));
      result = `【文件 ${args.path}】\n${r.content}` + (r.truncated ? `\n（已截断，全文 ${r.size} 字节，可用 grep 定位后读取片段）` : '');
    } else if (call.name === 'fs_grep') {
      const g = fsGrep(String(args.pattern || ''), String(args.path || '.'));
      result = `【grep "${args.pattern}" in ${args.path || '.'}】\n` + g.matches.map(m => `${m.path}:${m.line}: ${m.text}`).join('\n') + (g.truncated ? `\n（匹配过多，已截断，扫描 ${g.scanned} 个文件）` : '');
    } else if (call.name === 'fs_edit') {
      const e = fsEdit(String(args.path), String(args.old || ''), String(args.new || ''), args.occurrence === 'all' ? 'all' : 'first', sessionId);
      host.emit('file-change', {
        sessionId,
        change: { changeId: e.changeId, path: String(args.path), existed: (e.before || '').length > 0, old: e.before, new: e.after, revertible: !e.sandboxed },
      });
      result = `【已编辑 ${args.path}】替换 ${e.replaced} 处` + (e.sandboxed ? '（已暂存沙箱，待审批）' : '');
    } else if (call.name === 'fs_write') {
      const w = fsWrite(String(args.path), String(args.content || ''), sessionId);
      host.emit('file-change', {
        sessionId,
        change: { changeId: w.changeId, path: String(args.path), existed: (w.before || '').length > 0, old: w.before, new: String(args.content || ''), revertible: !w.sandboxed },
      });
      result = `【已写入 ${args.path}】` + (w.sandboxed ? '（已暂存沙箱，待审批）' : '');
    } else {
      throw new Error(`未知工具:${call.name}`);
    }
    host.emit('step', { sessionId, step: { stepId, status: 'done', endedAt: Date.now(), result } });
    return result;
  } catch (err: any) {
    host.emit('step', { sessionId, step: { stepId, status: 'error', error: err.message, endedAt: Date.now() } });
    return `【${call.name}】失败：${err.message}`;
  }
}

/** 原生工具循环的返回契约：
 * - { kind: 'completed', sessionId }：工具已执行并产出最终回答（或达上限强制收尾），整轮完成；
 * - { kind: 'plan', text, promptTokens, completionTokens }：模型未走原生工具，把探测文本交给
 *   文本标记路径复用为「规划结果」，避免网关再调一次 LLM（普通对话也少一次调用）；
 * - null：无可用的原生工具（buildNativeTools 为空），调用方走原有路径。 */
export type NativeToolLoopResult =
  | { kind: 'completed'; sessionId: string }
  | { kind: 'plan'; text: string; promptTokens: number; completionTokens: number }
  | null;

/**
 * 原生 function call 工具循环:模型带 tools 请求 → 若返回 tool_calls → 逐个执行 →
 * 以 tool 角色消息回灌结果 → 再请求 → 直到无 tool_calls 或达到 MAX_TOOL_TURNS。
 * 工具轮消息（assistant tool_calls + tool 结果）在最终回答确认后原子落库，
 * 追问时历史回放能让模型看到原始工具结果；中途失败则整体不落库，避免残留孤儿 tool 消息。
 * 模型不使用原生工具时返回 { kind: 'plan' }，由调用方复用探测文本跳过重复规划。
 */
export async function runNativeToolLoop(host: NativeToolsHost, params: {
  provider: ProviderConfig; agent: AgentConfig; convHistory: ChatMessage[]; temperature?: number;
  controller: AbortController; checkAborted: () => void; sessionId: string;
  searchConfig: SearchConfig; systemPrompt: string; history: ChatMessage[]; model: string;
}): Promise<NativeToolLoopResult> {
  const { provider, agent, convHistory, temperature, controller, checkAborted, sessionId, searchConfig, systemPrompt, history, model } = params;
  const db = getDb();
  const workspaceConfigured = !!getWorkspaceRoot();
  const tools = buildNativeTools(searchConfig.enabled, workspaceConfigured);
  if (tools.length === 0) return null; // 无可用工具,走原路径

  let messages: ChatMessage[] = [...convHistory];
  let reasoningFull = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let executedAny = false; // 是否执行过至少一次原生 tool_calls
  // 已执行工具轮（assistant tool_calls + tool 结果），最终答案确认后一并原子落库
  const toolRounds: { assistant: ChatMessage; tools: ChatMessage[] }[] = [];
  // 任务规划清单（WorkBuddy 式）：首轮探测文本里解析 [TODO:...] 并随工具完成逐个打勾。
  // 注意与 chat-flow 文本标记路径互斥——原生路径执行了工具时在此维护并广播，
  // 未走原生工具（返回 {kind:'plan'}）时由 chat-flow 的文本路径负责。
  let todoTracker: TodoTracker | null = null;

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    checkAborted();
    let turnText = '';
    let turnToolCalls: ToolCall[] | undefined;
    let finishReason: string | undefined;

    for await (const chunk of host.engine.chat(provider, agent, messages, temperature, controller.signal, tools)) {
      checkAborted();
      if (chunk.reasoning) { reasoningFull += chunk.reasoning; host.emit('reasoning', { sessionId, content: chunk.reasoning }); }
      turnText += chunk.content;
      if (chunk.toolCalls && chunk.toolCalls.length > 0) turnToolCalls = chunk.toolCalls;
      if (chunk.finishReason) finishReason = chunk.finishReason;
      if (chunk.usage) { promptTokens = chunk.usage.promptTokens || promptTokens; completionTokens = chunk.usage.completionTokens || completionTokens; }
      if (chunk.done) break;
    }

    // 模型要求调用工具:执行后回灌,继续下一轮
    if (turnToolCalls && turnToolCalls.length > 0) {
      executedAny = true;
      // 首次出现工具调用时,从本轮探测文本解析任务清单并下发(模型通常在规划文本里写 [TODO:...])
      if (!todoTracker) {
        todoTracker = createTodoTracker(host.emit.bind(host), sessionId, extractTodos(turnText));
        todoTracker?.emit();
      }
      const toolResults: string[] = [];
      for (const tc of turnToolCalls) {
        const res = await executeNativeToolCall(host, sessionId, tc, searchConfig);
        // 与文本标记路径一致:结果截断到 14k,避免多轮工具调用把上下文撑爆
        toolResults.push(res.slice(0, 14000));
        todoTracker?.complete(); // 任务清单打勾:单次原生工具调用完成
      }
      const assistantMsg: ChatMessage = { role: 'assistant', content: turnText, toolCalls: turnToolCalls };
      const toolMsgs: ChatMessage[] = turnToolCalls.map((tc, i) => ({ role: 'tool', toolCallId: tc.id, content: toolResults[i] }));
      toolRounds.push({ assistant: assistantMsg, tools: toolMsgs });
      messages = [...messages, assistantMsg, ...toolMsgs];
      continue;
    }

    // 模型从未调用原生工具(可能走 [SEARCH:]/[FS] 文本标记或直接回答):
    // 把探测文本交还给文本标记路径当规划结果,省一次 LLM 调用
    if (!executedAny) {
      return { kind: 'plan', text: turnText, promptTokens, completionTokens };
    }

    // 已执行过工具:本轮为最终回答,原子落库(工具轮 + 最终答案)后流式输出收尾
    const cleaned = trimMarkers(turnText);
    const estPrompt = estimateTokens(systemPrompt + '\n' + history.map(m => m.role + ':' + m.content).join('\n'));
    const estCompletion = estimateTokens(cleaned);
    const recPrompt = promptTokens || estPrompt;
    const recCompletion = completionTokens || estCompletion;
    persistToolRounds(db, sessionId, toolRounds, reasoningFull, cleaned, recCompletion, model, agent, recPrompt, recCompletion);
    // 流式输出最终回答(与文本标记路径一致):此前只发空 done,前端得等 loadSession 兜底回填,
    // 工具路径全程无打字机效果。这里按块 emit token + 增量发布 artifact,补齐流式体验。
    const CHUNK_SIZE = 3;
    host.tickRunning(sessionId, 'writing');
    for (let i = 0; i < cleaned.length; i += CHUNK_SIZE) {
      if (controller.signal.aborted) break;
      host.emit('token', { sessionId, content: cleaned.slice(i, i + CHUNK_SIZE), done: false });
      if (/[\n`<>]/.test(cleaned.slice(i, i + CHUNK_SIZE))) host.publishArtifacts(sessionId, cleaned.slice(0, i + CHUNK_SIZE));
    }
    host.emit('token', { sessionId, content: '', done: true, model, tokens: recCompletion });
    todoTracker?.finishAll(); // 任务清单收尾:剩余项全部打勾
    host.finishRunning(sessionId, true);
    host.extractMemories(history, cleaned, sessionId);
    return { kind: 'completed', sessionId };
  }

  // 达到 MAX_TOOL_TURNS 仍未结束:已执行的工具轮先落库(保持上下文),并以 assistant 收尾,
  // 避免历史以孤立的 tool 消息结尾(OpenAI 要求 tool 消息前有对应的 assistant tool_calls)。
  const msg = `工具调用已达上限(${MAX_TOOL_TURNS} 轮),已停止。请考虑让模型直接回答或调整需求。`;
  persistToolRounds(db, sessionId, toolRounds, reasoningFull, msg, 0, model, agent, 0, 0);
  host.emit('chat-error', { sessionId, error: msg });
  host.finishRunning(sessionId, false, msg);
  return { kind: 'completed', sessionId };
}

/** 原子落库:先写各工具轮(assistant tool_calls + tool 结果),再写最终 assistant 收尾消息 + 用量统计。 */
function persistToolRounds(
  db: Database.Database, sessionId: string, toolRounds: { assistant: ChatMessage; tools: ChatMessage[] }[],
  reasoning: string, finalContent: string, finalTokens: number, model: string,
  agent: AgentConfig, recPrompt: number, recCompletion: number,
): void {
  if (toolRounds.length === 0) return;
  const run = db.transaction(() => {
    for (const round of toolRounds) {
      db.prepare("INSERT INTO messages (session_id,role,content,tool_calls) VALUES (?,'assistant',?,?)")
        .run(sessionId, round.assistant.content, JSON.stringify(round.assistant.toolCalls));
      const insTool = db.prepare("INSERT INTO messages (session_id,role,content,tool_call_id) VALUES (?,?,?,?)");
      for (const t of round.tools) insTool.run(sessionId, t.role, t.content, t.toolCallId);
    }
    db.prepare("INSERT INTO messages (session_id,role,content,tokens,reasoning,model) VALUES (?,'assistant',?,?,?,?)")
      .run(sessionId, finalContent, finalTokens, reasoning, model);
    db.prepare('INSERT INTO token_usage (agent_id,provider_id,model,prompt_tokens,completion_tokens) VALUES (?,?,?,?,?)')
      .run(agent.id, agent.providerId, agent.model, recPrompt, recCompletion);
  });
  run();
}
