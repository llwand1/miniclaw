import { getDb } from './db';
import { AgentEngine, AgentConfig, ProviderConfig } from '../agent';
import { ChatMessage } from '../adapter/types';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../logger';
import { EventEmitter } from 'node:events';
import { extractArtifacts } from '../artifact';
import { ensureDefaultWorkspace } from '../fs-tools';
import { extractMemos } from './parsers';
import {
  getDefaultProvider, getProviderById, getSelectedModel, getSearchConfig,
  setSelectedModel as setSelectedModelImpl,
  selectProvider as selectProviderImpl, listModelOptions as listModelOptionsImpl,
  getCustomSystemPrompt as getCustomSystemPromptImpl, setCustomSystemPrompt as setCustomSystemPromptImpl,
} from './providers';
import { saveMemo } from './memory';
import { seedMemorizeIfEmpty } from './memorize-seed';
import {
  estimateTokens, estimateSessionContext as estimateSessionContextImpl,
  getContextLimit as getContextLimitImpl,
} from './context';
import { DEFAULT_SYSTEM_PROMPT, buildSystemPrompt as buildSystemPromptImpl } from './prompts';
import {
  listScheduledTasks as listScheduledTasksImpl,
  createScheduledTask as createScheduledTaskImpl, updateScheduledTask as updateScheduledTaskImpl,
  deleteScheduledTask as deleteScheduledTaskImpl,
} from './scheduler';
import { RunStateTracker } from './run-state';
import type { RunningTask, RunningTaskPhase } from './run-state';
import { runChatFlow } from './chat-flow';
import type { ChatFlowHost, PendingClarifyContext } from './chat-flow';
import { SchedulerHost } from './scheduler-host';

const log = createLogger('gateway');

// 门面：把拆分后的领域模块符号原样导回，保持原有「import from core/gateway」的公共 API 不变。
export { DEFAULT_SYSTEM_PROMPT } from './prompts';
export { MemoryMode, MEMORY_MODES } from './memory';
export type { InboundAttachment } from './prompts';
export { RunStateTracker } from './run-state';
export type { RunningTask, RunningTaskPhase } from './run-state';

export interface InboundMessage {
  source: 'main' | 'floating';
  sessionId?: string;
  text: string;
  ts?: Date;
  temperature?: number;
  providerId?: string;
  model?: string;
  resend?: boolean;
  /** 前端对话栏手动勾选、要求本次对话强制注入的技能名（不受 enabled 开关限制） */
  skillNames?: string[];
  /** 前端「+」引用的文件（本地文件 / 对话中提到的文件）。inline=前端已读内容；path=后端安全读取。 */
  attachments?: { name: string; path?: string; content?: string; mode?: 'inline' | 'path' }[];
}

/**
 * Gateway —— 编排层：对外提供对话/会话/模型/任务 API，
 * 内部把重逻辑委托给拆分的领域模块（chat-flow / native-tools / scheduler-host / run-state / providers / memory ...）。
 */
export class Gateway extends EventEmitter implements ChatFlowHost {
  engine = new AgentEngine();

  /** 后台任务表：sessionId -> 进行中任务（含阶段，前端任务栏实时刷新），逻辑见 run-state.ts */
  private runState = new RunStateTracker(this);

  /** 定时任务调度器（轮询 scheduled_tasks，见 scheduler-host.ts） */
  private schedulerHost = new SchedulerHost({
    runTask: (input) => this.handleMessage({ ...input, source: 'main' }),
  });

  /** 需求澄清（grill-me）：sessionId -> 挂起的澄清上下文，等用户选择后再恢复生成 */
  pendingClarify = new Map<string, PendingClarifyContext>();

  /** 当前活跃的请求 AbortController（sessionId -> controller） */
  activeControllers = new Map<string, AbortController>();
  /** 标记「用户主动中止」的会话，用于区分超时中止（需明确报错）与用户停止（静默收尾） */
  userAbortedSessions = new Set<string>();

  /** 启动一个后台任务，并立即广播阶段 */
  startRunning(sessionId: string, title: string, providerId: string, model: string): void {
    this.runState.start(sessionId, title, providerId, model);
  }

  /** 更新任务阶段/字数并广播（done/error 用 finished 语义，失联客户端重连后回放） */
  tickRunning(sessionId: string, phase: RunningTaskPhase, chars?: number): void {
    this.runState.tick(sessionId, phase, chars);
  }

  /** 结束任务：广播 done/error/aborted 后移除（done/aborted 保留 8s，error 保留 60s+供点掉） */
  finishRunning(sessionId: string, done: boolean, error?: string, aborted?: boolean): void {
    this.runState.finish(sessionId, done, error, aborted);
  }

  /** 当前全部进行中任务快照（供前端刷新/重连时对齐） */
  getRunningTasks(): RunningTask[] {
    return this.runState.getAll();
  }

  async start(): Promise<void> {
    // 首次启动自动创建默认工作区，省去手动配置（用户仍可在 UI 改到自己的项目目录）
    ensureDefaultWorkspace();
    // P0-1：空库种子——providers/agents 为空表时注入默认服务商 + 默认 Agent，
    // 全新机器开箱即可发起对话（配置 API Key 后真正可用），不再抛「No default agent」500。
    this.seedIfEmpty();
    // 背背背默认词库：memorize 表为空时注入 CET4/CET6 词库（约 3900 词），见 memorize-seed.ts
    seedMemorizeIfEmpty();
    log.info('Gateway started');
    this.schedulerHost.start();
  }

  /**
   * 空库种子（健壮性修复）：按主键幂等确保「默认 provider + 默认 agent」存在，
   * 而非仅在表为空时插入。这样即便用户已手动添加了其它 provider、或库处于中途
   * 崩溃残留状态，默认 agent 也始终能引用到一个真实存在的 provider，避免
   * FOREIGN KEY 约束失败导致 Gateway 启动即崩（开箱 500）。
   * api_key 留空由用户在设置页填写（加密由 migrateSecrets 兜底）。
   */
  private seedIfEmpty(): void {
    const db = getDb();
    const defaultProvId = 'openai-default';

    // 1) 确保默认 provider 存在（按 id 幂等，已存在则跳过）
    const provExists = db.prepare('SELECT 1 FROM providers WHERE id=?').get(defaultProvId);
    if (!provExists) {
      db.prepare('INSERT INTO providers (id,type,name,base_url,api_key,default_model,enabled) VALUES (?,?,?,?,?,?,?)')
        .run(defaultProvId, 'openai', 'OpenAI', 'https://api.openai.com/v1', '', '', 1);
      log.info('Seeded default provider (openai-default)');
    }

    // 2) 确保默认 agent 存在，且 provider_id 指向真实存在的 provider
    //    （优先默认 provider；若被意外删除则回退到任意现有 provider）
    const agentExists = db.prepare('SELECT 1 FROM agents WHERE id=?').get('default');
    if (!agentExists) {
      const targetProv = (db.prepare('SELECT id FROM providers WHERE id=?').get(defaultProvId)
        || db.prepare('SELECT id FROM providers LIMIT 1').get()) as { id: string } | undefined;
      if (targetProv) {
        db.prepare('INSERT INTO agents (id,name,role,provider_id,model,system_prompt,enabled) VALUES (?,?,?,?,?,?,?)')
          .run('default', '默认助手', 'assistant', targetProv.id, '', DEFAULT_SYSTEM_PROMPT, 1);
        log.info('Seeded default agent (default)');
      }
    }
  }

  getDefaultProvider(): ProviderConfig | null {
    return getDefaultProvider();
  }

  getProviderById(id: string): ProviderConfig | null {
    return getProviderById(id);
  }

  /** 已选择 + 校验后的 provider/model（供前端下拉展示当前选中） */
  getSelectedModel(): { providerId: string; model: string } | null {
    return getSelectedModel();
  }

  setSelectedModel(providerId: string, model: string): void {
    return setSelectedModelImpl(providerId, model);
  }

  /**
   * 单选当前服务商：同时只能用一个模型，所以同一时刻只允许一个服务商处于启用状态。
   * 启用所选、禁用其它，并把「当前模型」切换到该服务商的默认模型。
   */
  selectProvider(id: string): void {
    return selectProviderImpl(id);
  }

  /** 列出所有启用服务商的可用模型（供模型切换下拉，opencode/workbuddy 风） */
  async listModelOptions(): Promise<{
    providerId: string;
    providerName: string;
    type: string;
    defaultModel: string;
    models: string[];
  }[]> {
    return listModelOptionsImpl(this.engine);
  }

  buildSystemPrompt(query?: string, sessionId?: string): string {
    return buildSystemPromptImpl(query, sessionId);
  }

  /** 用户自定义系统提示词（设置页可编辑；空则用内置默认） */
  getCustomSystemPrompt(): string {
    return getCustomSystemPromptImpl();
  }

  setCustomSystemPrompt(content: string): void {
    return setCustomSystemPromptImpl(content);
  }

  /** Generate a response from the AI (collects full text, doesn't stream) */
  async generateOnce(provider: ProviderConfig, agent: AgentConfig, messages: ChatMessage[], temperature?: number, signal?: AbortSignal): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
    let text = '';
    let pt = 0;
    let ct = 0;
    const collect = async () => {
      text = ''; pt = 0; ct = 0;
      for await (const chunk of this.engine.chat(provider, agent, messages, temperature, signal)) {
        text += chunk.content;
        if (chunk.usage) { pt = chunk.usage.promptTokens; ct = chunk.usage.completionTokens; }
      }
    };
    try {
      await collect();
    } catch (err: any) {
      // 瞬时网络错误自动重试一次（fetch failed / 超时 / 连接重置等），避免
      // 「用户消息已落库但回复未生成」的静默失败；非网络错误或用户中止直接抛出。
      const msg = String(err?.message || '');
      const transient = /fetch failed|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|timeout|aborted due to timeout/i.test(msg);
      if (transient && !(signal?.aborted)) {
        log.warn({ error: msg }, 'LLM call transient failure, retrying once');
        await collect();
      } else {
        throw err;
      }
    }
    return { text, promptTokens: pt, completionTokens: ct };
  }

  /** 当前模型上下文窗口上限（tokens）：按模型名映射，未知模型给保守默认值 */
  getContextLimit(providerId?: string, model?: string): number {
    return getContextLimitImpl(providerId, model);
  }

  /**
   * 估算会话真实上下文用量（服务端权威值，替代前端写死的 8000）：
   * - limit：当前模型 context window
   * - sys：系统提示（buildSystemPrompt 拼接后的估算）
   * - hist：对话历史（messages 表 tokens 字段优先，缺失则本地估算）
   * - tools：含 [SEARCH:/[FETCH:/[FS] 工具标记的回复体量
   * - files：含【文件…】工具结果的回复体量
   */
  estimateSessionContext(sessionId: string): { limit: number; used: number; sys: number; hist: number; tools: number; files: number; model: string } {
    return estimateSessionContextImpl(sessionId);
  }

  private async summarizeMemories(provider: ProviderConfig, history: ChatMessage[]): Promise<void> {
    const sumPrompt = '仅根据以上对话，提取值得记住的用户信息（名字、偏好、习惯、当前关注等）或任务经验（方案、踩坑、可复用代码片段/结论）。有就按格式输出，一条一行。没有值得记的内容就输出 NONE。\n格式：\n[MEMO:内容|A]\nA=长期重要（身份/偏好/习惯），B=短期重要（当前话题/需求），C=任务经验（方案/踩坑/可复用结论）。';
    const sumHistory: ChatMessage[] = [{ role: 'system', content: sumPrompt }, ...history.slice(-4)];
    const sumAgent: AgentConfig = { id: 'default', name: '助手', role: 'assistant', providerId: provider.id, model: provider.defaultModel, systemPrompt: '', enabled: true };
    const { text } = await this.generateOnce(provider, sumAgent, sumHistory);
    const memos = extractMemos(text);
    for (const memo of memos) {
      saveMemo(memo.content, memo.category);
      log.info({ content: memo.content, category: memo.category }, 'Memory saved via summarization');
    }
  }

  /**
   * 按会话维护已广播的 artifact id，保证同一个 artifact 在流式多次提取时只发一次。
   * id 由内容指纹生成（见 artifact.ts），所以「相同内容」天然去重，重复 emit 自动跳过。
   */
  artifactSeenIds = new Map<string, Set<string>>();

  /**
   * 从 AI 回复中提取 artifact 并通过事件总线广播，驱动预览子系统。
   * 仅负责「提取 + 发射」；消费方（服务端 PreviewService / 渲染进程 PreviewClient）
   * 各自订阅 gateway 的 'artifact' 事件，互不直接依赖。
   * 幂等：已广播过的 id 不再重复 emit，因此可在流式过程中反复调用（实现「实时预览」）。
   */
  publishArtifacts(sessionId: string, text: string): void {
    try {
      let seen = this.artifactSeenIds.get(sessionId);
      if (!seen) { seen = new Set<string>(); this.artifactSeenIds.set(sessionId, seen); }
      const arts = extractArtifacts(text, sessionId);
      for (const artifact of arts) {
        if (seen.has(artifact.id)) continue;
        seen.add(artifact.id);
        this.emit('artifact', { type: 'artifact', sessionId, artifact });
      }
    } catch (err: any) {
      log.warn({ error: err.message }, 'publishArtifacts failed');
    }
  }

  /** 同一会话的串行队列：sessionId -> 正在/即将执行的 Promise。保证「读历史→生成→写回」原子。 */
  private sessionLocks = new Map<string, Promise<unknown>>();

  /**
   * 对外入口：同一会话串行化。
   * 把「读历史 → 生成 → 写回」整段流程按 sessionId 串成队列，保证任意时刻每个会话
   * 只有一个请求在进行，杜绝快速连发/重连导致的多轮流式互相穿插、AbortController 互相覆盖。
   */
  async handleMessage(inbound: InboundMessage): Promise<string> {
    const sessionId = inbound.sessionId || uuidv4();
    inbound.sessionId = sessionId; // 固定，确保队列内后续读取一致
    const prev = this.sessionLocks.get(sessionId) ?? Promise.resolve();
    const run = prev.then(() => runChatFlow(this, inbound));
    const stored = run.catch(() => {}); // 吞掉异常，避免单次失败卡死后续消息
    this.sessionLocks.set(sessionId, stored);
    // 清理队列锁：用 then(cleanup, cleanup) 而非 finally——finally 会派生一个
    // 会 reject 且无人消费的新 promise，导致超时/失败场景出现 unhandled rejection。
    const cleanup = () => {
      if (this.sessionLocks.get(sessionId) === stored) this.sessionLocks.delete(sessionId);
    };
    run.then(cleanup, cleanup);
    return run;
  }

  /**
   * 需求澄清回复（grill-me 风格）：用户从澄清卡片选择/输入后调用。
   * 把用户的选择作为一条带格式的 user 消息入库，然后复用 handleMessage 完整流程
   * （重新规划 → 工具执行 → 最终生成），模型基于「原需求 + 用户选择」继续干活。
   */
  async answerClarify(sessionId: string, answer: string): Promise<string> {
    const ctx = this.pendingClarify.get(sessionId);
    if (!ctx) return sessionId;
    this.pendingClarify.delete(sessionId);
    const db = getDb();
    // 用户选择作为 user 消息入库（角色序列正确，前端正常渲染成用户气泡）；
    // 另写一条 system 消息框定「这是上一步澄清的选择」，供模型理解上下文，
    // 避免把选择当成孤立 system 注入导致重放历史时角色错乱。
    db.prepare("INSERT INTO messages (session_id,role,content) VALUES (?,?,?)")
      .run(sessionId, 'system', `【需求确认】${ctx.clarify.question}\n（用户已在下方以用户消息给出选择，请据此继续）`);
    db.prepare("INSERT INTO messages (session_id,role,content) VALUES (?,?,?)")
      .run(sessionId, 'user', answer);
    return this.handleMessage({
      source: ctx.source,
      sessionId,
      text: answer,
      providerId: ctx.provider.id,
      model: ctx.model,
      temperature: ctx.temp,
      resend: true,
    });
  }

  extractMemories(history: ChatMessage[], reply: string, source?: string): void {
    const provider = getDefaultProvider();
    if (!provider) return;
    const memos = extractMemos(reply);
    if (memos.length > 0) {
      for (const memo of memos) {
        saveMemo(memo.content, memo.category, source);
        log.info({ content: memo.content, category: memo.category, source }, 'Memory saved from reply');
      }
    } else {
      try {
        const sumHistory = [...history, { role: 'assistant' as const, content: reply }];
        this.summarizeMemories(provider, sumHistory).catch((err: any) => log.warn({ error: err.message }, 'Memory summarization failed'));
      } catch {}
    }
  }

  /** 中止指定会话的活跃请求 */
  abort(sessionId: string): boolean {
    const controller = this.activeControllers.get(sessionId);
    if (controller) {
      this.userAbortedSessions.add(sessionId); // 标记为用户主动中止，catch 分支据此静默收尾
      controller.abort();
      this.activeControllers.delete(sessionId);
      log.info({ sessionId }, 'Request aborted');
      return true;
    }
    return false;
  }

  /** 任务列表（含归属会话标题，供前端直接展示/跳转） */
  listScheduledTasks(): any[] {
    return listScheduledTasksImpl();
  }

  /** 新建定时任务：mode=once 用 at（ISO 时间），mode=interval 用 intervalMinutes（自 now 起） */
  createScheduledTask(input: {
    name: string; prompt: string; mode: 'once' | 'interval';
    at?: string; intervalMinutes?: number; providerId?: string; model?: string;
  }): any {
    return createScheduledTaskImpl(input);
  }

  /** 更新任务（名称/内容/启停/time/间隔） */
  updateScheduledTask(id: string, patch: {
    name?: string; prompt?: string; enabled?: boolean; at?: string; intervalMinutes?: number;
  }): any {
    return updateScheduledTaskImpl(id, patch);
  }

  /** 删除任务：同时软删除归属会话（保留历史，不物理删） */
  deleteScheduledTask(id: string): boolean {
    return deleteScheduledTaskImpl(id);
  }

  async stop(): Promise<void> {
    this.schedulerHost.stop();
    // 中止所有活跃请求
    for (const [sid, controller] of this.activeControllers) {
      controller.abort();
    }
    this.activeControllers.clear();
    this.removeAllListeners();
    log.info('Gateway stopped');
  }
}
