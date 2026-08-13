/**
 * 对话主流程（从 gateway/index.ts 拆出）：handleMessageImpl 的独立实现。
 *
 * 职责：读历史 → 规划/工具执行（原生 function call 与文本标记双路径）→ 最终生成 → 落库。
 * 通过 ChatFlowHost 接口访问 Gateway 能力（避免循环依赖），Gateway.handleMessageImpl 仅一行委托。
 */
import { getDb } from './db';
import { AgentEngine, AgentConfig, ProviderConfig } from '../agent';
import { ChatMessage } from '../adapter/types';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../logger';
import { tracer } from '../trace/tracer';
import { getWorkspaceRoot } from '../fs-tools';
import {
  trimMarkers, extractFsTools, extractSearchQueries, extractUrls, extractMemoryTriggers,
  extractTodos, extractClarify, extractSkillTriggers,
} from './parsers';
import {
  getDefaultProvider, getProviderById, getSelectedModel, getSearchConfig,
  getEnabledSkills, loadSkillBodies,
} from './providers';
import { resolveMemoryModes, loadModeMemories } from './memory';
import { estimateTokens } from './context';
import { buildSystemPrompt as buildSystemPromptImpl, buildAttachmentContext } from './prompts';
import { performSearches, performFetches } from './searcher';
import { runNativeToolLoop, runFileTool } from './native-tools';
import type { RunningTaskPhase } from './run-state';
import type { InboundMessage } from './index';

const log = createLogger('gateway:chat-flow');

/** 流式回复超时（ms）：超过此时间未收到完整回复则自动中止。 */
const STREAM_TIMEOUT_MS = 120_000;

/** 需求澄清（grill-me）挂起上下文。 */
export interface PendingClarifyContext {
  provider: ProviderConfig;
  agent: AgentConfig;
  history: ChatMessage[];
  sessionId: string;
  model: string;
  temp?: number;
  source: 'main' | 'floating';
  clarify: { question: string; options: string[]; allowCustom: boolean };
}

/** chat-flow 需要的 Gateway 能力（由 Gateway 实例满足）。 */
export interface ChatFlowHost {
  engine: AgentEngine;
  emit(event: string, payload: any): void;
  artifactSeenIds: Map<string, Set<string>>;
  activeControllers: Map<string, AbortController>;
  userAbortedSessions: Set<string>;
  pendingClarify: Map<string, PendingClarifyContext>;
  startRunning(sessionId: string, title: string, providerId: string, model: string): void;
  tickRunning(sessionId: string, phase: RunningTaskPhase, chars?: number): void;
  finishRunning(sessionId: string, done: boolean, error?: string, aborted?: boolean): void;
  generateOnce(provider: ProviderConfig, agent: AgentConfig, messages: ChatMessage[], temperature?: number, signal?: AbortSignal): Promise<{ text: string; promptTokens: number; completionTokens: number }>;
  publishArtifacts(sessionId: string, text: string): void;
  extractMemories(history: ChatMessage[], reply: string, source?: string): void;
}

/** handleMessageImpl 的独立实现（原 Gateway 私有方法，拆出后由 Gateway 一行委托）。 */
export async function runChatFlow(host: ChatFlowHost, inbound: InboundMessage): Promise<string> {
  // 优先用前端指定的 provider/model；否则回退到「已选模型」；最后回退默认服务商
  let provider: ProviderConfig | null = null;
  let chosenModel: string | null = null;

  if (inbound.providerId) {
    provider = getProviderById(inbound.providerId);
  } else {
    const selected = getSelectedModel();
    if (selected) {
      provider = getProviderById(selected.providerId);
      chosenModel = selected.model;
    }
  }
  if (!provider) provider = getDefaultProvider();
  if (!provider) throw new Error('请先在设置页添加 API 服务商');

  const model = inbound.model || chosenModel || provider.defaultModel;

  const db = getDb();
  const sessionId = inbound.sessionId || uuidv4();
  // 新一轮对话：清空该会话已广播的 artifact id，使相同内容在新消息里能重新预览
  host.artifactSeenIds.delete(sessionId);
  const isNew = !db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);

  if (isNew) {
    db.prepare('INSERT INTO sessions (id,agent_id,source,title) VALUES (?,?,?,?)').run(sessionId, 'default', inbound.source, inbound.text.slice(0, 50) || '新对话');
  } else {
    db.prepare("UPDATE sessions SET updated_at=datetime('now') WHERE id=?").run(sessionId);
  }

  // 重试（resend）时复用既有用户消息，避免重复入库
  if (!inbound.resend) {
    db.prepare('INSERT INTO messages (session_id,role,content) VALUES (?,?,?)').run(sessionId, 'user', inbound.text);
  }

  const history = db.prepare("SELECT role,content FROM messages WHERE session_id=? ORDER BY ts").all(sessionId) as ChatMessage[];
  // 用户从对话栏「+」引用的文件：拼成系统上下文注入给模型（inline 直接带内容；path 由后端安全读取）。
  // 单独构造 convHistory，避免污染用于记忆抽取/摘要的 history。
  const attachmentCtx = buildAttachmentContext(inbound.attachments);
  const convHistory: ChatMessage[] = attachmentCtx ? [{ role: 'system', content: attachmentCtx }, ...history] : history;
  const systemPrompt = buildSystemPromptImpl(inbound.text, sessionId);
  const agent: AgentConfig = { id: 'default', name: '助手', role: 'assistant', providerId: provider.id, model, systemPrompt, enabled: true };

  const searchConfig = getSearchConfig();
  const temp = inbound.temperature;

  // 创建 AbortController 支持中止（超时自动中止）
  const controller = new AbortController();
  host.activeControllers.set(sessionId, controller);
  const timeout = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

  const checkAborted = () => { if (controller.signal.aborted) throw new Error('__ABORTED__'); };

  // 后台任务：记录本次生成，阶段实时广播给任务栏
  host.startRunning(sessionId, inbound.text.slice(0, 50) || '新对话', provider.id, model);

  // 简易 Trace：以本次请求为根 Span，下游 LLM 调用会作为子 Span 挂上来
  const trace = tracer.startTrace(sessionId, 'chat', { model: model || '', provider: provider.id });
  // 实时 Trace：请求开始即推送初始 payload（含未结束的 root span），
  // 之后每个 Span 的 start/end 增量推送 trace-span，前端边收边画、支持展开详情。
  host.emit('trace-start', { sessionId, trace: trace.toPayload() });
  trace.on('span', (ev: any) => {
    host.emit('trace-span', { sessionId, phase: ev.phase, span: ev.span });
  });

  try {
    let reasoningFull = '';

    // 统一工具开关：联网搜索 或 工作区文件工具 任一启用，就走「规划阶段 → 执行工具 → 最终阶段」；
    // 都没启用则直接流式输出（最省 token）。
    const workspaceConfigured = !!getWorkspaceRoot();
    const toolsEnabled = searchConfig.enabled || workspaceConfigured;
    // 用户在前端对话栏手动勾选、要求本次强制注入的技能（不受 enabled 开关限制），与「已启用技能」合并考量
    const manualSkills = (inbound.skillNames || []).map(s => String(s).trim()).filter(Boolean);
    // 存在已启用技能，或用户本次手动勾选了技能，就进入「规划阶段」按需加载（WorkBuddy 式）
    const skillsEnabled = getEnabledSkills().length > 0 || manualSkills.length > 0;

    // 原生 function call：工具启用时优先走「模型原生 tools 参数 → tool_calls → 执行 → 回灌」，
    // 与下方文本标记路径（[SEARCH:]/[FS]）并行。模型实际返回 tool_calls 时整轮在
    // runNativeToolLoop 内完成并返回 sessionId；模型没走原生工具（可能用文本标记或直接回答）
    // 时返回 null，交还下方原有规划→工具→最终路径，保证对不支持原生 tools 的模型完全兼容。
    if (toolsEnabled) {
      const nativeDone = await runNativeToolLoop(host, {
        provider, agent, convHistory, temperature: temp, controller, checkAborted,
        sessionId, trace, searchConfig, systemPrompt, history, model,
      });
      if (nativeDone) return nativeDone;
    }

    if (toolsEnabled || skillsEnabled) {
      checkAborted();
      const { text: plan, promptTokens: pt1, completionTokens: ct1 } = await host.generateOnce(provider, agent, convHistory, temp, controller.signal);
      checkAborted();

      const searchQueries = extractSearchQueries(plan);
      const fetchUrls = extractUrls(plan);
      const fsToolCalls = extractFsTools(plan);
      const skillTriggers = extractSkillTriggers(plan);
      // 合并「LLM 自动触发」与「用户手动勾选」的技能：手动勾选的强制注入，不会被 LLM 忽略
      const allSkillTriggers = [...new Set([...skillTriggers, ...manualSkills])];
      // 记忆模式：模型在规划阶段用 <<MEM:...>> 显式选择要加载的记忆模式（多重记忆架构）。
      // 未输出标记时按「复杂任务」默认加载全模式；<<MEM:none>> 表示本任务不需要额外记忆。
      const memTriggers = extractMemoryTriggers(plan);
      // 任务规划清单（WorkBuddy 式）：解析 [TODO:...] 步骤清单并立即经 SSE 下发，
      // 前端实时展示「任务清单」并随 step 完成逐个打勾。无论是否触发工具都下发。
      const todos = extractTodos(plan);
      if (todos.length > 0) {
        host.emit('todos', { sessionId, todos });
      }

      // 需求澄清（grill-me 风格）：模型在规划阶段输出 [ASK:{json}] 时，挂起本次生成，
      // 经 SSE 下发澄清问题与选项，等用户选择后再恢复（见 answerClarify）。
      const clarify = extractClarify(plan);
      if (clarify) {
        host.pendingClarify.set(sessionId, {
          provider, agent, history, sessionId, model, temp, source: inbound.source, clarify,
        });
        host.tickRunning(sessionId, 'writing'); // 阶段推进提示（澄清中）
        host.emit('clarify', { sessionId, question: clarify.question, options: clarify.options, allowCustom: clarify.allowCustom });
        // 不继续执行工具/最终生成，等待用户选择
        return sessionId;
      }

      if (searchQueries.length > 0 || fetchUrls.length > 0 || fsToolCalls.length > 0 || allSkillTriggers.length > 0) {
        const toolResults: string[] = [];

        // 联网搜索
        if (searchQueries.length > 0) {
          host.tickRunning(sessionId, 'searching');
          const stepId = uuidv4();
          const span = trace?.startChild('tool.call', 'tool', { tool: 'search', queries: searchQueries });
          host.emit('step', { sessionId, step: { stepId, name: '联网搜索', tool: 'search', status: 'running', args: searchQueries, startedAt: Date.now() } });
          const results = await performSearches(searchQueries, searchConfig);
          host.emit('step', { sessionId, step: { stepId, status: 'done', endedAt: Date.now(), result: `已搜索 ${searchQueries.length} 个关键词` } });
          span?.end();
          toolResults.push(results);
        }

        // 抓取网页
        if (fetchUrls.length > 0) {
          host.tickRunning(sessionId, 'fetching');
          const stepId = uuidv4();
          const span = trace?.startChild('tool.call', 'tool', { tool: 'fetch', urls: fetchUrls });
          host.emit('step', { sessionId, step: { stepId, name: '抓取网页', tool: 'fetch', status: 'running', args: fetchUrls, startedAt: Date.now() } });
          const results = await performFetches(fetchUrls);
          host.emit('step', { sessionId, step: { stepId, status: 'done', endedAt: Date.now(), result: `已抓取 ${fetchUrls.length} 个网页` } });
          span?.end();
          toolResults.push(results);
        }

        // 文件工具（read/grep/edit/write）
        if (fsToolCalls.length > 0) {
          for (const call of fsToolCalls) {
            const res = await runFileTool(host, sessionId, call, trace);
            toolResults.push(res);
          }
        }

        checkAborted();

        const toolContext = toolResults.join('\n').slice(0, 14000);
        const skillBodies = loadSkillBodies(allSkillTriggers);
        // 记忆模式注入：模型选了哪些模式就召回哪些；没选时按复杂任务默认全模式（profile+recent+episodic）。
        // <<MEM:none>> → 空列表，本任务不带额外记忆（省 token）。
        const memKeys = memTriggers.length > 0
          ? (memTriggers.includes('none') ? [] : memTriggers)
          : resolveMemoryModes({ complex: true });
        const memBlocks = loadModeMemories(memKeys, inbound.text, sessionId);
        const sysParts: string[] = [];
        if (memBlocks.length > 0) {
          const memLines: string[] = ['以下是根据你选择的记忆模式加载的记忆，请结合这些记忆回答用户问题：', ''];
          for (const block of memBlocks) {
            memLines.push(`### ${block.name}`);
            memLines.push(...block.items);
            memLines.push('');
          }
          sysParts.push(memLines.join('\n'));
        }
        if (toolResults.length > 0) {
          sysParts.push('以下是工具执行结果，请基于这些内容回答用户问题：', '', toolContext);
        }
        if (skillBodies) {
          sysParts.push('以下是已启用技能的完整指引，请严格遵循其工作流与产出形态来组织你的回答与行动：', '', skillBodies);
        }
        const augmented: ChatMessage[] = [
          ...convHistory,
          { role: 'assistant', content: trimMarkers(plan) },
        ];
        if (sysParts.length > 0) {
          augmented.push({ role: 'system', content: sysParts.join('\n') });
        }

        let finalText = '';
        let finalPt = 0;
        let finalCt = 0;
        host.tickRunning(sessionId, 'writing');
        for await (const chunk of host.engine.chat(provider, agent, augmented, temp, controller.signal)) {
          checkAborted();
          if (chunk.reasoning) { reasoningFull += chunk.reasoning; host.emit('reasoning', { sessionId, content: chunk.reasoning }); }
          finalText += chunk.content;
          // 实时预览：token 流里出现围栏/标签边界时增量提取 artifact（幂等去重，只发新增）
          if (/[\n`<>]/.test(chunk.content)) host.publishArtifacts(sessionId, trimMarkers(finalText));
          if (chunk.usage) { finalPt = chunk.usage.promptTokens; finalCt = chunk.usage.completionTokens; }
          host.emit('token', { sessionId, content: chunk.content, done: false });
        }

        const cleaned = trimMarkers(finalText);
        // 兜底：未返回 usage 时用本地估算（规划阶段 + 最终阶段分别估算）
        const planPromptText = systemPrompt + '\n' + history.map(m => m.role + ':' + m.content).join('\n');
        const estPlanPrompt = estimateTokens(planPromptText);
        const estPlanCompletion = estimateTokens(plan);
        const estFinalPrompt = estimateTokens(systemPrompt + '\n' + augmented.map(m => m.role + ':' + m.content).join('\n'));
        const estFinalCompletion = estimateTokens(finalText);
        const recPt1 = pt1 || estPlanPrompt;
        const recCt1 = ct1 || estPlanCompletion;
        const recFinalPt = finalPt || estFinalPrompt;
        const recFinalCt = finalCt || estFinalCompletion;
        db.prepare("INSERT INTO messages (session_id,role,content,tokens,reasoning,model) VALUES (?,'assistant',?,?,?,?)").run(sessionId, cleaned, recFinalCt, reasoningFull, model);
        db.prepare('INSERT INTO token_usage (agent_id,provider_id,model,prompt_tokens,completion_tokens) VALUES (?,?,?,?,?)').run(agent.id, provider.id, agent.model, recPt1 + recFinalPt, recCt1 + recFinalCt);
        host.emit('token', { sessionId, content: '', done: true, model, tokens: recFinalCt });
        host.finishRunning(sessionId, true);

        host.publishArtifacts(sessionId, cleaned);
        host.extractMemories(history, cleaned, sessionId);
        return sessionId;
      }

      // 规划阶段没产出任何工具调用：直接把规划当作最终回答流式输出
      const cleaned = trimMarkers(plan);
      const CHUNK_SIZE = 3;
      host.tickRunning(sessionId, 'writing');
      for (let i = 0; i < cleaned.length; i += CHUNK_SIZE) {
        host.emit('token', { sessionId, content: cleaned.slice(i, i + CHUNK_SIZE), done: false });
        // 实时预览：分块到达围栏/标签边界时增量提取 artifact
        if (/[\n`<>]/.test(cleaned.slice(i, i + CHUNK_SIZE))) host.publishArtifacts(sessionId, cleaned.slice(0, i + CHUNK_SIZE));
      }
      // 兜底：未返回 usage 时用本地估算（规划即最终回答）
      const planPromptText2 = systemPrompt + '\n' + history.map(m => m.role + ':' + m.content).join('\n');
      const recPt1b = pt1 || estimateTokens(planPromptText2);
      const recCt1b = ct1 || estimateTokens(plan);
      db.prepare("INSERT INTO messages (session_id,role,content,tokens,reasoning,model) VALUES (?,'assistant',?,?,?,?)").run(sessionId, cleaned, recCt1b, reasoningFull, model);
      db.prepare('INSERT INTO token_usage (agent_id,provider_id,model,prompt_tokens,completion_tokens) VALUES (?,?,?,?,?)').run(agent.id, provider.id, agent.model, recPt1b, recCt1b);
      host.emit('token', { sessionId, content: '', done: true, model, tokens: recCt1b });
      host.finishRunning(sessionId, true);

      host.publishArtifacts(sessionId, cleaned);
      host.extractMemories(history, cleaned, sessionId);
      return sessionId;
    }

    // 未启用任何工具（无联网搜索且无工作区）：直接流式输出
    let full = '';
    let promptTokens = 0;
    let completionTokens = 0;
    host.tickRunning(sessionId, 'writing');
    for await (const chunk of host.engine.chat(provider, agent, convHistory, temp, controller.signal)) {
      checkAborted();
      if (chunk.reasoning) host.emit('reasoning', { sessionId, content: chunk.reasoning });
      full += chunk.content;
      // 实时预览：token 流里出现围栏/标签边界时增量提取 artifact
      if (/[\n`<>]/.test(chunk.content)) host.publishArtifacts(sessionId, full);
      if (chunk.usage) { promptTokens = chunk.usage.promptTokens; completionTokens = chunk.usage.completionTokens; }
      host.emit('token', { sessionId, content: chunk.content, done: chunk.done });
      if (chunk.done) break;
    }

    // 兜底：服务商未返回 usage 时，用本地估算，避免 token 统计恒为 0
    const estPrompt0 = estimateTokens(systemPrompt + '\n' + history.map(m => m.role + ':' + m.content).join('\n'));
    const estCompletion0 = estimateTokens(full);
    const recPrompt0 = promptTokens || estPrompt0;
    const recCompletion0 = completionTokens || estCompletion0;
    db.prepare("INSERT INTO messages (session_id,role,content,tokens,reasoning,model) VALUES (?,'assistant',?,?,?,?)").run(sessionId, full, recCompletion0, reasoningFull, model);
    db.prepare('INSERT INTO token_usage (agent_id,provider_id,model,prompt_tokens,completion_tokens) VALUES (?,?,?,?,?)').run(agent.id, provider.id, agent.model, recPrompt0, recCompletion0);

    host.emit('token', { sessionId, content: '', done: true, model, tokens: recCompletion0 });
    host.finishRunning(sessionId, true);

    host.publishArtifacts(sessionId, full);
    host.extractMemories(history, full, sessionId);
    return sessionId;
  } catch (err: any) {
    if (err.message === '__ABORTED__' || controller.signal.aborted) {
      if (host.userAbortedSessions.has(sessionId)) {
        // 用户主动停止：广播「已停止」事件并标记 Trace 为已中止，让前端给出明确反馈
        // （而非静默收尾），同时保留已产出的过程信息（步骤/清单/思考/部分回复）仍可见。
        trace.setAborted();
        host.emit('chat-stopped', { sessionId });
        host.emit('token', { sessionId, content: '', done: true });
        host.finishRunning(sessionId, true, undefined, true);
      } else {
        // 服务端超时中止：必须明确报错，否则前端只收到空回复、用户完全不知道发生了什么
        const msg = '请求超时：服务端在 ' + Math.round(STREAM_TIMEOUT_MS / 1000) + ' 秒内未收到完整回复，已自动中止。可点重试，或换用响应更快的模型 / 关闭联网搜索。';
        trace.setError(msg);
        host.emit('chat-error', { sessionId, error: msg });
        host.finishRunning(sessionId, false, msg);
        host.userAbortedSessions.delete(sessionId);
        throw new Error(msg);
      }
      host.userAbortedSessions.delete(sessionId);
      return sessionId;
    }
    // 广播错误事件，驱动前端给出明确的失败反馈（而非一直转圈）
    trace.setError(err.message || '未知错误');
    host.emit('chat-error', { sessionId, error: err.message || '未知错误' });
    host.finishRunning(sessionId, false, err.message || '未知错误');
    log.error({ sessionId, error: err.message }, 'Chat failed');
    throw err;
  } finally {
    clearTimeout(timeout);
    host.activeControllers.delete(sessionId);
    // 结束本次 Trace 并广播给前端（瀑布面板实时刷新；同时已落库可历史回查）
    trace.end();
    host.emit('trace', trace.toPayload());
  }
}
