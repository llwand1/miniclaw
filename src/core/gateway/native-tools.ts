/**
 * 原生 function call 工具循环（从 gateway/index.ts 拆出）。
 *
 * 与「文本标记路径」（[SEARCH:]/[FS]）并行：模型带原生 tools 参数请求，
 * 若返回 tool_calls 则逐个执行并以 tool 角色回灌，直到无 tool_calls 或达到轮数上限。
 */
import { getDb } from './db';
import { AgentEngine, AgentConfig, ProviderConfig } from '../agent';
import { ChatMessage, ToolDefinition, ToolCall } from '../adapter/types';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../logger';
import { getWorkspaceRoot, fsRead, fsGrep, fsEdit, fsWrite } from '../fs-tools';
import { trimMarkers, extractMemos, FsToolCall } from './parsers';
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
export async function runFileTool(host: NativeToolsHost, sessionId: string, call: FsToolCall, trace: any): Promise<string> {
  const stepId = uuidv4();
  const span = trace?.startChild('tool.call', 'tool', { tool: call.action, path: call.path });
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
    span?.end();
    host.emit('step', { sessionId, step: { stepId, status: 'done', endedAt: Date.now(), result: result.slice(0, 200) } });
    return result;
  } catch (err: any) {
    span?.setError?.(err.message || '');
    span?.end();
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
export async function executeNativeToolCall(host: NativeToolsHost, sessionId: string, call: ToolCall, searchConfig: SearchConfig, trace: any): Promise<string> {
  const stepId = uuidv4();
  const span = trace?.startChild('tool.call', 'tool', { tool: call.name, args: call.arguments });
  const args: any = (() => { try { return JSON.parse(call.arguments || '{}'); } catch { return {}; } })();
  const label: Record<string, string> = { search_web: '联网搜索', fetch_page: '抓取网页', fs_read: '读取文件', fs_grep: '搜索文件', fs_edit: '编辑文件', fs_write: '写入文件' };
  const kind = call.name.startsWith('fs_') ? 'fs' : call.name === 'fetch_page' ? 'fetch' : 'search';
  host.emit('step', { sessionId, step: { stepId, name: label[call.name] || call.name, tool: kind, status: 'running', args: [call.arguments], startedAt: Date.now() } });
  try {
    let result = '';
    if (call.name === 'search_web') {
      host.tickRunning(sessionId, 'searching');
      result = await performSearches(Array.isArray(args.queries) ? args.queries : [], searchConfig);
    } else if (call.name === 'fetch_page') {
      host.tickRunning(sessionId, 'fetching');
      result = await performFetches(Array.isArray(args.urls) ? args.urls : []);
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
    span?.end();
    host.emit('step', { sessionId, step: { stepId, status: 'done', endedAt: Date.now(), result: result.slice(0, 200) } });
    return result;
  } catch (err: any) {
    span?.setError?.(err.message || '');
    span?.end();
    host.emit('step', { sessionId, step: { stepId, status: 'error', error: err.message, endedAt: Date.now() } });
    return `【${call.name}】失败：${err.message}`;
  }
}

/**
 * 原生 function call 工具循环:模型带 tools 请求 → 若返回 tool_calls → 逐个执行 →
 * 以 tool 角色消息回灌结果 → 再请求 → 直到无 tool_calls 或达到 MAX_TOOL_TURNS。
 * 与现有「文本标记([SEARCH:]/[FS])」路径并行:仅当工具启用且模型实际返回原生 tool_calls 时生效;
 * 模型不返回 tool_calls(走文本标记或直接回答)时返回 null,由调用方回退原路径。
 */
export async function runNativeToolLoop(host: NativeToolsHost, params: {
  provider: ProviderConfig; agent: AgentConfig; convHistory: ChatMessage[]; temperature?: number;
  controller: AbortController; checkAborted: () => void; sessionId: string; trace: any;
  searchConfig: SearchConfig; systemPrompt: string; history: ChatMessage[]; model: string;
}): Promise<string | null> {
  const { provider, agent, convHistory, temperature, controller, checkAborted, sessionId, trace, searchConfig, systemPrompt, history, model } = params;
  const db = getDb();
  const workspaceConfigured = !!getWorkspaceRoot();
  const tools = buildNativeTools(searchConfig.enabled, workspaceConfigured);
  if (tools.length === 0) return null; // 无可用工具,走原路径

  let messages: ChatMessage[] = [...convHistory];
  let reasoningFull = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let executedAny = false; // 是否执行过至少一次原生 tool_calls

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
      const toolResults: string[] = [];
      for (const tc of turnToolCalls) {
        const res = await executeNativeToolCall(host, sessionId, tc, searchConfig, trace);
        toolResults.push(res);
      }
      messages = [
        ...messages,
        { role: 'assistant' as const, content: turnText, toolCalls: turnToolCalls },
      ];
      for (let i = 0; i < turnToolCalls.length; i++) {
        messages.push({ role: 'tool' as const, toolCallId: turnToolCalls[i].id, content: toolResults[i] });
      }
      continue;
    }

    // 模型从未调用原生工具(可能走 [SEARCH:]/[FS] 文本标记或直接回答):交还文本标记路径
    if (!executedAny) return null;

    // 已执行过工具:本轮为最终回答,落库收尾
    const cleaned = trimMarkers(turnText);
    const estPrompt = estimateTokens(systemPrompt + '\n' + history.map(m => m.role + ':' + m.content).join('\n'));
    const estCompletion = estimateTokens(cleaned);
    const recPrompt = promptTokens || estPrompt;
    const recCompletion = completionTokens || estCompletion;
    db.prepare("INSERT INTO messages (session_id,role,content,tokens,reasoning,model) VALUES (?,'assistant',?,?,?,?)").run(sessionId, cleaned, recCompletion, reasoningFull, model);
    db.prepare('INSERT INTO token_usage (agent_id,provider_id,model,prompt_tokens,completion_tokens) VALUES (?,?,?,?,?)').run(agent.id, provider.id, agent.model, recPrompt, recCompletion);
    host.emit('token', { sessionId, content: '', done: true, model, tokens: recCompletion });
    host.finishRunning(sessionId, true);
    host.publishArtifacts(sessionId, cleaned);
    host.extractMemories(history, cleaned, sessionId);
    return sessionId;
  }

  // 达到 MAX_TOOL_TURNS 仍未结束:强制收尾,提示用户
  const msg = `工具调用已达上限(${MAX_TOOL_TURNS} 轮),已停止。请考虑让模型直接回答或调整需求。`;
  trace?.setError?.(msg);
  host.emit('chat-error', { sessionId, error: msg });
  host.finishRunning(sessionId, false, msg);
  return sessionId;
}
