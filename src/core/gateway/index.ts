import { getDb } from './db';
import { AgentEngine, AgentConfig, ProviderConfig } from '../agent';
import { ChatMessage } from '../adapter/types';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../logger';
import { EventEmitter } from 'node:events';
import { searchWeb, fetchPage, formatSearchResults, SearchConfig } from '../search';
import { extractArtifacts } from '../artifact';
import { tracer } from '../trace/tracer';
import { getWorkspaceRoot, fsList, fsRead, fsGrep, fsWrite, fsEdit, ensureDefaultWorkspace, FsNode } from '../fs-tools';
import { readSkillFile } from '../skills';
import { decryptSecret } from '../security/crypto';
import { getPolicy } from '../security/policy';
import fs from 'node:fs';
import path from 'node:path';

const log = createLogger('gateway');

// 默认系统提示词：借鉴主流开源项目（Claude Code / Cline / OpenCode 等）的写法，
// 以「身份 + 准则 + 行为 + 记忆」四段式组织，结构化、可执行，便于各模型稳定遵循。
// 用户可在「设置 → 系统提示词」中自定义覆盖；未配置时使用本默认值。
export const DEFAULT_SYSTEM_PROMPT = [
  '你是 MiniClaw，一个运行在用户本机、由用户自己配置的大模型驱动的**中文桌面 AI 助手**。你的目标是成为用户可信赖的全能工作搭档，而非只会聊天的机器人。',
  '',
  '## 核心能力（请主动运用，不要只靠通用知识回答）',
  '你具备以下能力，遇到对应场景应主动启用：',
  '- **长期记忆与个性化**：系统会自动注入用户的长期画像（身份/偏好/习惯），你应据此保持回答的一致与个性化。',
  '- **技能系统（按需加载）**：当用户需求匹配某个已启用技能时，用 `<<SKILL:名称>>` 触发，系统会加载该技能的完整指引后再由你执行——不要自行重写技能流程。',
  '- **联网搜索与网页抓取**：当你需要实时/最新信息、需验证事实、或用户要求查网页时，用 `[SEARCH:关键词]` / `[FETCH:网页URL]` 获取真实资料后再回答。',
  '- **工作区文件工具**：当用户涉及项目文件（查看/搜索/修改/创建）时，用 `[FS]...[/FS]` 块操作真实文件，而不是凭空编造路径或内容。',
  '- **内容预览**：需要向用户展示可交互/可视化的成果（HTML demo、图表、报告）时，输出完整 HTML 代码块，系统会提供预览。',
  '- **结构化表达**：复杂内容用 Markdown（标题/列表/表格/代码块）组织。',
  '',
  '## 回答准则',
  '1. **主动用工具与能力**：信息可能过时或不确定 → 搜索；涉及用户文件 → 文件工具；匹配技能 → 触发技能；需要个性化 → 参考长期画像。能用能力解决的不靠记忆编造。',
  '2. **准确**：不确定的信息要明确说明，绝不编造数据、人名、引用或链接；引用时尽量给出出处。',
  '3. **简洁且结构化**：优先直接答案；展开时用清晰层级；长内容用表格/列表。',
  '4. **中文优先**：默认简体中文，除非用户要求其他语言。',
  '5. **安全合规**：不提供违法、有害或侵犯他人权利的内容；不绕过系统的安全/审批约束。',
  '',
  '## 对话行为',
  '- 用户追问时先回应新问题，不重复已说结论。',
  '- 需求模糊时，先给推荐假设并说明，而非反复追问细节。',
  '- 需要用户执行的操作，用简短步骤列出。',
  '',
  '## 记忆与个性化',
  '- 始终参考系统注入的「关于用户的重要信息」，保持个性化一致。',
  '- 当对话出现值得长期记住的用户信息时，按格式单独输出一行：',
  '[MEMO:内容|A]   （A=长期重要：身份/偏好/习惯）',
  '[MEMO:内容|B]   （B=短期重要：当前话题/需求）',
  '[MEMO:内容|C]   （C=任务经验：方案/踩坑/代码片段）',
  '- 不要在一次回复里刷大量 MEMO；只记录真正有价值的。',
].join('\n');

/**
 * 记忆模式注册表（多重记忆架构）：
 * 系统同时维护多种记忆模式，模型在「规划阶段」根据任务难度与类型，用 <<MEM:key1,key2>> 标记
 * 选择要加载的模式；网关按所选模式从 memories 表按需召回并注入最终生成阶段。
 * - 不输出 <<MEM:...>> 时走默认策略（按任务复杂度自动决定，见 resolveMemoryModes）。
 * - 输出 <<MEM:none>> 表示本任务不需要任何记忆（省 token）。
 */
export interface MemoryMode {
  key: string;              // <<MEM:...>> 标记里用的 key
  category: string | null;  // 对应 memories.category（null = 不来自 memories 表）
  name: string;             // 中文名（注入提示用）
  desc: string;             // 内容说明（给模型看）
  when: string;             // 适用场景（模型判断依据）
  limit: number;            // 最多召回条数
}

export const MEMORY_MODES: MemoryMode[] = [
  {
    key: 'profile',
    category: 'A',
    name: '长期画像',
    desc: '用户的身份、职业、偏好、习惯等稳定信息',
    when: '任何需要个性化回答的任务；简单任务也建议带',
    limit: 6,
  },
  {
    key: 'recent',
    category: 'B',
    name: '近期关注',
    desc: '用户最近关注的话题、进行中的需求、当前项目上下文',
    when: '延续性对话，或用户提到"上次/刚才/最近/这个项目"时',
    limit: 5,
  },
  {
    key: 'episodic',
    category: 'C',
    name: '任务经验',
    desc: '历史任务中沉淀的方案、踩坑、代码片段、可复用结论',
    when: '复杂任务、重复性任务（编程/分析/写作），需要复用历史经验时',
    limit: 5,
  },
];

// 当前活跃的请求 AbortController（sessionId -> controller）
const activeControllers = new Map<string, AbortController>();
// 标记「用户主动中止」的会话，用于区分超时中止（需明确报错）与用户停止（静默收尾）
const userAbortedSessions = new Set<string>();

// 常见模型的上下文窗口（tokens）映射：context 用量 UI 的「真实上限」。
// 未知模型走 DEFAULT_CONTEXT_LIMIT 保守默认；命中按模型名精确或前缀匹配。
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // GPT 系列（OpenAI 兼容中转常见）
  'gpt-5.6': 200000, 'gpt-5.5': 200000, 'gpt-5.4': 200000, 'gpt-5.2': 200000, 'gpt-5.1': 200000, 'gpt-5': 200000,
  'gpt-4.1': 1047576, 'gpt-4o': 128000, 'gpt-4o-mini': 128000, 'gpt-4': 8192, 'gpt-3.5-turbo': 16385,
  // DeepSeek 系列
  'deepseek-v4': 65536, 'deepseek-v3.2': 65536, 'deepseek-r1': 65536, 'deepseek-chat': 65536, 'deepseek-reasoner': 65536,
  // 其他常见
  'agnes': 128000, 'claude': 200000, 'qwen': 131072, 'glm': 131072, 'kimi': 131072, 'gemini': 1048576,
};
const DEFAULT_CONTEXT_LIMIT = 65536; // 未知模型保守默认

/** 后台任务阶段：供前端「底部任务栏」持续显示进度，会话切走也不打断 */
export type RunningTaskPhase = 'thinking' | 'searching' | 'fetching' | 'writing' | 'done' | 'error';
export interface RunningTask {
  sessionId: string;
  title: string;
  providerId: string;
  model: string;
  phase: RunningTaskPhase;
  startedAt: number;
  chars: number;
}

// 流式回复超时（ms）：超过此时间未收到完整回复则自动中止。
// 之前 60s 偏短，联网搜索 + 思考场景易误杀；放宽到 120s，且超时改为明确报错（不再静默）。
const STREAM_TIMEOUT_MS = 120_000;

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

function trimMarkers(text: string): string {
  let out = text.replace(/\[SEARCH:[^\]]*\]/g, '').replace(/\[FETCH:[^\]]*\]/g, '');
  // 去掉 [FS]...[/FS] 文件工具块（含内部多行 JSONL 指令，最终回答里不应出现）
  out = out.replace(/\[FS\][\s\S]*?\[\/FS\]/gi, '');
  // 去掉技能触发标记 <<SKILL:name>>（已按需加载正文，最终回答里不应出现）
  out = out.replace(/<<SKILL:[\w\-]+>>/g, '');
  // 去掉记忆模式标记 <<MEM:...>>（已按需加载记忆，最终回答里不应出现）
  out = out.replace(/<<MEM:[^>]*>>/g, '');
  // 去掉任务规划清单标记 [TODO:...]（已作为清单实时展示，最终回答里不应出现）
  out = out.replace(/\[TODO:[^\]]*\]/g, '');
  // 去掉需求澄清标记 [ASK:{json}]（已作为澄清卡片展示/答案已回灌，最终回答里不应出现）
  out = out.replace(/\[ASK:\s*\{[\s\S]*?\}\s*\]/g, '');
  return out.trim();
}

/**
 * 解析 AI 在规划阶段产出的文件工具块 [FS]...[/FS]。
 * 内部为 JSONL：每行一个工具调用对象，支持 read/grep/edit/write。
 * 选择 JSON（而非纯文本分隔）是为了用标准转义安全承载多行内容与特殊字符。
 */
interface FsToolCall {
  action: 'read' | 'grep' | 'edit' | 'write';
  path: string;
  pattern?: string;
  old?: string;
  new?: string;
  content?: string;
  occurrence?: 'first' | 'all';
}

function extractFsTools(text: string): FsToolCall[] {
  const calls: FsToolCall[] = [];
  const re = /\[FS\]([\s\S]*?)\[\/FS\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const block = m[1];
    for (const line of block.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const obj = JSON.parse(t) as FsToolCall;
        if (obj && obj.action && obj.path) calls.push(obj);
      } catch {
        // 非 JSON 行（如模型夹带的说明文字）忽略
      }
    }
  }
  return calls;
}

export class Gateway extends EventEmitter {
  private engine = new AgentEngine();

  /** 后台任务表：sessionId -> 进行中任务（含阶段，前端任务栏实时刷新） */
  private runningTasks = new Map<string, RunningTask>();

  /** 定时任务调度器 */
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private doingTasks = new Set<string>();

  /** 需求澄清（grill-me）：sessionId -> 挂起的澄清上下文，等用户选择后再恢复生成 */
  private pendingClarify = new Map<string, {
    provider: ProviderConfig;
    agent: AgentConfig;
    history: ChatMessage[];
    sessionId: string;
    model: string;
    temp?: number;
    source: 'main' | 'floating';
    clarify: { question: string; options: string[]; allowCustom: boolean };
  }>();

  /** 启动一个后台任务，并立即广播阶段 */
  private startRunning(sessionId: string, title: string, providerId: string, model: string): void {
    const task: RunningTask = { sessionId, title, providerId, model, phase: 'thinking', startedAt: Date.now(), chars: 0 };
    this.runningTasks.set(sessionId, task);
    this.emitRunState(sessionId);
  }

  /** 更新任务阶段/字数并广播（done/error 用 finished 语义，失联客户端重连后回放） */
  private tickRunning(sessionId: string, phase: RunningTaskPhase, chars?: number): void {
    const t = this.runningTasks.get(sessionId);
    if (!t) return;
    t.phase = phase;
    if (typeof chars === 'number') t.chars = chars;
    this.emitRunState(sessionId);
  }

  /** 结束任务：广播 done/error 后移除（done 保留 8s 供任务栏展示"已完成"，error 保留 60s+供点掉） */
  private finishRunning(sessionId: string, done: boolean, error?: string): void {
    const t = this.runningTasks.get(sessionId);
    if (!t) return;
    t.phase = done ? 'done' : 'error';
    const data: any = { sessionId, task: { ...t }, done };
    if (error) data.error = error;
    this.emit('run-state', data);
    setTimeout(() => this.removeRunning(sessionId), done ? 8000 : 60_000);
  }
  private removeRunning(sessionId: string): void {
    if (this.runningTasks.delete(sessionId)) this.emit('run-state', { sessionId, done: true, removed: true });
  }
  private emitRunState(sessionId: string): void {
    const t = this.runningTasks.get(sessionId);
    if (!t) return;
    this.emit('run-state', { sessionId, task: { ...t } });
  }

  /** 当前全部进行中任务快照（供前端刷新/重连时对齐） */
  getRunningTasks(): RunningTask[] {
    return [...this.runningTasks.values()];
  }

  async start(): Promise<void> {
    // 首次启动自动创建默认工作区，省去手动配置（用户仍可在 UI 改到自己的项目目录）
    ensureDefaultWorkspace();
    // P0-1：空库种子——providers/agents 为空表时注入默认服务商 + 默认 Agent，
    // 全新机器开箱即可发起对话（配置 API Key 后真正可用），不再抛「No default agent」500。
    this.seedIfEmpty();
    log.info('Gateway started');
    this.startScheduler();
  }

  /** 空库种子：仅当表为空时注入，幂等。api_key 留空由用户在设置页填写（加密由 migrateSecrets 兜底）。 */
  private seedIfEmpty(): void {
    const db = getDb();
    const provCount = (db.prepare('SELECT COUNT(*) AS c FROM providers').get() as any).c as number;
    if (provCount === 0) {
      db.prepare('INSERT INTO providers (id,type,name,base_url,api_key,default_model,enabled) VALUES (?,?,?,?,?,?,?)')
        .run('openai-default', 'openai', 'OpenAI', 'https://api.openai.com/v1', '', 'gpt-4o-mini', 1);
      log.info('Seeded default provider (openai-default)');
    }
    const agentCount = (db.prepare('SELECT COUNT(*) AS c FROM agents').get() as any).c as number;
    if (agentCount === 0) {
      db.prepare('INSERT INTO agents (id,name,role,provider_id,model,system_prompt,enabled) VALUES (?,?,?,?,?,?,?)')
        .run('default', '默认助手', 'assistant', 'openai-default', 'gpt-4o-mini', DEFAULT_SYSTEM_PROMPT, 1);
      log.info('Seeded default agent (default)');
    }
  }

  getDefaultProvider(): ProviderConfig | null {
    const db = getDb();
    const p = db.prepare('SELECT * FROM providers WHERE enabled=1 LIMIT 1').get() as any;
    if (!p) return null;
    return { id: p.id, type: p.type, name: p.name, baseUrl: p.base_url, apiKey: decryptSecret(p.api_key), defaultModel: p.default_model, enabled: !!p.enabled };
  }

  getProviderById(id: string): ProviderConfig | null {
    const db = getDb();
    const p = db.prepare('SELECT * FROM providers WHERE id=?').get(id) as any;
    if (!p) return null;
    return { id: p.id, type: p.type, name: p.name, baseUrl: p.base_url, apiKey: decryptSecret(p.api_key), defaultModel: p.default_model, enabled: !!p.enabled };
  }

  /** 已选择 + 校验后的 provider/model（供前端下拉展示当前选中） */
  getSelectedModel(): { providerId: string; model: string } | null {
    const db = getDb();
    const row = db.prepare("SELECT value FROM app_settings WHERE key='selected_model'").get() as any;
    if (!row?.value) return null;
    try {
      const parsed = JSON.parse(row.value) as { providerId: string; model: string };
      if (!parsed.providerId || !parsed.model) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  setSelectedModel(providerId: string, model: string): void {
    const db = getDb();
    db.prepare("INSERT INTO app_settings (key,value) VALUES ('selected_model',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')")
      .run(JSON.stringify({ providerId, model }));
  }

  /**
   * 单选当前服务商：同时只能用一个模型，所以同一时刻只允许一个服务商处于启用状态。
   * 启用所选、禁用其它，并把「当前模型」切换到该服务商的默认模型。
   */
  selectProvider(id: string): void {
    const db = getDb();
    const p = db.prepare('SELECT id, default_model FROM providers WHERE id=?').get(id) as any;
    if (!p) throw new Error('服务商不存在');
db.transaction(() => {
      db.prepare("UPDATE providers SET enabled=0, updated_at=datetime('now')").run();
      db.prepare("UPDATE providers SET enabled=1, updated_at=datetime('now') WHERE id=?").run(id);
      if (p.default_model) {
        db.prepare("INSERT INTO app_settings (key,value) VALUES ('selected_model',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')")
          .run(JSON.stringify({ providerId: id, model: p.default_model }));
      }
    })();
    log.info({ providerId: id }, 'Provider selected as current');
  }

  /** 列出所有启用服务商的可用模型（供模型切换下拉，opencode/workbuddy 风） */
  async listModelOptions(): Promise<{
    providerId: string;
    providerName: string;
    type: string;
    defaultModel: string;
    models: string[];
  }[]> {
    const db = getDb();
    const providers = db.prepare('SELECT * FROM providers WHERE enabled=1 ORDER BY created_at ASC').all() as any[];
    const out: { providerId: string; providerName: string; type: string; defaultModel: string; models: string[] }[] = [];
    for (const p of providers) {
      const provider: ProviderConfig = { id: p.id, type: p.type, name: p.name, baseUrl: p.base_url, apiKey: decryptSecret(p.api_key), defaultModel: p.default_model, enabled: !!p.enabled };
      const models = await this.engine.listModels(provider).catch(() => [provider.defaultModel]);
      out.push({ providerId: p.id, providerName: p.name, type: p.type, defaultModel: p.default_model, models });
    }
    return out;
  }

  private getSearchConfig(): SearchConfig {
    const db = getDb();
    const row = db.prepare('SELECT * FROM search_config WHERE id = 1').get() as any;
    if (!row) return { enabled: false, provider: 'duckduckgo', customApiUrl: '', customApiKey: '' };
    return { enabled: !!row.enabled, provider: row.provider, customApiUrl: row.custom_api_url, customApiKey: row.custom_api_key };
  }

  private extractSearchQueries(text: string): string[] {
    const queries: string[] = [];
    const regex = /\[SEARCH:(.+?)\]/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const q = m[1].trim();
      if (q) queries.push(q);
    }
    return queries;
  }

  private extractUrls(text: string): string[] {
    const urls: string[] = [];
    const regex = /\[FETCH:(https?:\/\/[^\]]+?)\]/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const url = m[1].trim();
      if (url) urls.push(url);
    }
    return urls;
  }

  private async performSearches(queries: string[], config: SearchConfig): Promise<string> {
    const allLines: string[] = [];
    for (const q of queries) {
      try {
        const result = await searchWeb(q, config);
        allLines.push(`搜索 "${q}" 的结果：`);
        allLines.push(formatSearchResults(result));
        allLines.push('');
      } catch (err: any) {
        log.warn({ query: q, error: err.message }, 'Search failed');
        allLines.push(`搜索 "${q}" 失败：${err.message}`);
      }
    }
    return allLines.join('\n');
  }

  private async performFetches(urls: string[]): Promise<string> {
    const allLines: string[] = [];
    for (const url of urls) {
      try {
        const page = await fetchPage(url);
        allLines.push(`页面 "${page.title}" 的内容：`);
        allLines.push(page.text.slice(0, 3000));
        allLines.push('');
      } catch (err: any) {
        log.warn({ url, error: err.message }, 'Fetch failed');
        allLines.push(`获取 ${url} 失败：${err.message}`);
      }
    }
    return allLines.join('\n');
  }

  /**
   * 执行单个文件工具调用，并广播结构化的 step（工具栏展示）与 file-change
   * （驱动前端「文件变更」卡片，含 diff 与一键撤销）。
   * 返回一段「工具结果」文本，回灌给模型做最终回答。
   */
  private async runFileTool(sessionId: string, call: FsToolCall, trace: ReturnType<typeof tracer.startTrace> | null): Promise<string> {
    const actionLabel: Record<string, string> = { read: '读取文件', grep: '搜索文本', edit: '编辑文件', write: '写入文件' };
    const stepId = uuidv4();
    const span = trace?.startChild('tool.call', 'tool', { tool: 'fs', action: call.action, path: call.path });
    this.tickRunning(sessionId, 'writing');
    this.emit('step', { sessionId, step: { stepId, name: actionLabel[call.action] || call.action, tool: 'fs:' + call.action, status: 'running', args: [call.path], startedAt: Date.now() } });

    try {
      if (call.action === 'read') {
        const r = fsRead(call.path);
        const snippet = r.truncated ? r.content : r.content;
        this.emit('file-change', {
          sessionId,
          change: { action: 'read', path: call.path, changeId: '', revertible: false },
        });
        this.emit('step', { sessionId, step: { stepId, status: 'done', endedAt: Date.now(), result: `${call.path}（${r.size} 字节${r.truncated ? '，已截断' : ''}）` } });
        span?.end();
        return `【文件内容 ${call.path}】\n\`\`\`\n${snippet}\n\`\`\``;
      }

      if (call.action === 'grep') {
        const g = fsGrep(call.pattern || '', call.path || '.');
        const lines = g.matches.map(m => `${m.path}:${m.line}: ${m.text}`).join('\n');
        this.emit('step', { sessionId, step: { stepId, status: 'done', endedAt: Date.now(), result: `在 ${g.scanned} 个文件中命中 ${g.matches.length} 处${g.truncated ? '（已截断）' : ''}` } });
        span?.end();
        return `【grep 结果 模式="${call.pattern}"】\n${lines || '（无匹配）'}`;
      }

      if (call.action === 'edit') {
        const r = fsEdit(call.path, call.old || '', call.new || '', call.occurrence === 'all' ? 'all' : 'first', sessionId);
        this.emit('file-change', {
          sessionId,
          change: { action: 'edit', path: call.path, changeId: r.changeId, revertible: !r.sandboxed, old: r.before, new: r.after, replaced: r.replaced, sandboxed: r.sandboxed, approvalId: r.approvalId },
        });
        const statusMsg = r.sandboxed
          ? `已暂存到沙箱，等待用户审批：${call.path}（审批 ID: ${r.approvalId}）`
          : `已替换 ${r.replaced} 处：${call.path}`;
        this.emit('step', { sessionId, step: { stepId, status: 'done', endedAt: Date.now(), result: statusMsg } });
        span?.end();
        return r.sandboxed
          ? `【编辑已暂存 ${call.path}】变更已进入沙箱审批队列，需用户在设置页批准后才会写入目标文件。审批 ID: ${r.approvalId}`
          : `【编辑结果 ${call.path}】成功替换 ${r.replaced} 处，changeId=${r.changeId}（可在前端一键撤销）。`;
      }

      if (call.action === 'write') {
        const r = fsWrite(call.path, call.content || '', sessionId);
        this.emit('file-change', {
          sessionId,
          change: { action: 'write', path: call.path, changeId: r.changeId, revertible: !r.sandboxed, old: r.before, new: call.content || '', existed: r.before.length > 0, sandboxed: r.sandboxed, approvalId: r.approvalId },
        });
        const statusMsg = r.sandboxed
          ? `已暂存到沙箱，等待用户审批：${call.path}（审批 ID: ${r.approvalId}）`
          : `已写入 ${call.content?.length || 0} 字符：${call.path}`;
        this.emit('step', { sessionId, step: { stepId, status: 'done', endedAt: Date.now(), result: statusMsg } });
        span?.end();
        return r.sandboxed
          ? `【写入已暂存 ${call.path}】变更已进入沙箱审批队列，需用户在设置页批准后才会写入目标文件。审批 ID: ${r.approvalId}`
          : `【写入结果 ${call.path}】成功写入 ${call.content?.length || 0} 字符，changeId=${r.changeId}（可在前端一键撤销）。`;
      }

      this.emit('step', { sessionId, step: { stepId, status: 'done', endedAt: Date.now(), result: '未知操作' } });
      span?.end();
      return `【文件工具】未知操作：${call.action}`;
    } catch (err: any) {
      this.emit('step', { sessionId, step: { stepId, status: 'error', endedAt: Date.now(), result: err.message } });
      span?.end();
      return `【文件工具失败 ${call.action} ${call.path}】${err.message}`;
    }
  }

  private getMemories(): { content: string; category: string }[] {
    return getDb().prepare('SELECT content, category FROM memories ORDER BY category ASC, created_at ASC').all() as any[];
  }

  /** 轻量分词：英文/数字按词、中文逐字。用于记忆相关性召回（不引入向量库，简单好上手） */
  private tokenize(s: string): Set<string> {
    const lower = (s || '').toLowerCase();
    const tokens = new Set<string>();
    for (const m of lower.match(/[a-z0-9]+/g) || []) tokens.add(m);
    for (const m of lower.match(/[一-鿿]/g) || []) tokens.add(m);
    return tokens;
  }

  /**
   * 按需召回：根据当前用户输入对全部记忆打分（相关性 × 重要性 × 时间衰减），返回降序排列。
   * 记忆总量很小（A≤15/B≤10），全量读出后在 JS 里打分即可，无需向量库。
   * - category A = 长期个性化画像（身份/偏好/习惯），默认高 importance
   * - category B = 近期关注，默认中 importance
   */
  private retrieveMemories(query?: string): {
    id: number; content: string; category: string; importance: number;
    created_at: string; relevance: number; score: number;
  }[] {
    const all = getDb().prepare('SELECT id, content, category, importance, created_at FROM memories').all() as any[];
    const qTok = this.tokenize(query || '');
    const now = Date.now();
    return all.map((m: any) => {
      const mTok = this.tokenize(m.content);
      let overlap = 0;
      for (const t of qTok) if (mTok.has(t)) overlap++;
      const relevance = qTok.size ? overlap / Math.sqrt(qTok.size * mTok.size || 1) : 0;
      const createdMs = new Date((m.created_at || '').replace(' ', 'T') + 'Z').getTime() || now;
      const hours = Math.max(0, (now - createdMs) / 3600000);
      const decay = Math.exp(-0.01 * hours); // 温和时间衰减：约 1 天 0.96、7 天 0.75
      const importance = typeof m.importance === 'number' ? m.importance : 0.5;
      const score = relevance * importance * decay;
      return { ...m, relevance, score };
    }).sort((a, b) => b.score - a.score);
  }

  /** 解析规划文本里的 <<MEM:key1,key2>> 标记，返回选中的记忆模式 key 列表 */
  private extractMemoryTriggers(text: string): string[] {
    const keys: string[] = [];
    const regex = /<<MEM:([^>]+)>>/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      for (const k of m[1].split(',')) {
        const t = k.trim().toLowerCase();
        if (t && !keys.includes(t)) keys.push(t);
      }
    }
    return keys;
  }

  /** 解析规划文本里的 [TODO:步骤描述] 任务清单标记，返回按序的步骤列表 */
  private extractTodos(text: string): { id: string; content: string }[] {
    const todos: { id: string; content: string }[] = [];
    const regex = /\[TODO:([^\]]+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const content = m[1].trim();
      if (content) todos.push({ id: uuidv4(), content });
    }
    return todos;
  }

  /** 需求澄清（grill-me 风格）：解析规划文本里的 [ASK:{json}] 标记，返回澄清问题与选项 */
  private extractClarify(text: string): { question: string; options: string[]; allowCustom: boolean } | null {
    const m = text.match(/\[ASK:\s*(\{[\s\S]*?\})\s*\]/);
    if (!m) return null;
    try {
      const d = JSON.parse(m[1]);
      if (d && typeof d.question === 'string' && d.question.trim() && Array.isArray(d.options)) {
        return {
          question: d.question.trim(),
          options: d.options.map((o: any) => String(o)).filter(Boolean),
          allowCustom: d.allowCustom !== false,
        };
      }
    } catch { /* ignore */ }
    return null;
  }

  /**
   * 默认记忆模式策略（模型未输出 <<MEM:...>> 时使用）：
   * 简单任务（无工具、无技能、无工作区）= 仅长期画像（省 token）；
   * 复杂任务（有工具调用/技能/工作区，任务难度高）= 长期画像 + 近期关注 + 任务经验。
   */
  private resolveMemoryModes(opts: { complex: boolean }): string[] {
    return opts.complex ? ['profile', 'recent', 'episodic'] : ['profile'];
  }

  /**
   * 按选中的记忆模式召回并组装为提示块。
   * 返回 [{ name, items }]，调用方拼进 system prompt；召回逻辑复用 retrieveMemories 的
   * 相关性×重要性×时间衰减 打分，仅按 category 过滤对应模式。
   */
  private loadModeMemories(modeKeys: string[], query?: string): { name: string; items: string[] }[] {
    const blocks: { name: string; items: string[] }[] = [];
    const ranked = this.retrieveMemories(query);
    for (const key of modeKeys) {
      const mode = MEMORY_MODES.find(mm => mm.key === key);
      if (!mode || !mode.category) continue;
      const items = ranked
        .filter(m => m.category === mode.category)
        .slice(0, mode.limit)
        .map(m => `- ${m.content}`);
      if (items.length > 0) blocks.push({ name: mode.name, items });
    }
    return blocks;
  }

  /** 用户自定义系统提示词（设置页可编辑；空则用内置默认） */
  getCustomSystemPrompt(): string {
    const db = getDb();
    const row = db.prepare("SELECT value FROM app_settings WHERE key='system_prompt'").get() as any;
    return row?.value || '';
  }

  setCustomSystemPrompt(content: string): void {
    const db = getDb();
    db.prepare("INSERT INTO app_settings (key,value) VALUES ('system_prompt',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')")
      .run(content);
  }

  /** 组装本次请求最终使用的系统提示词：用户自定义（或内置默认） + 自动注入的工具说明与记忆 */
  /** 返回当前已启用的技能清单（名称/描述/路径），供目录注入与按需加载共用 */
  private getEnabledSkills(): { name: string; description: string; path: string }[] {
    try {
      return getDb().prepare('SELECT name,description,path FROM skills WHERE enabled=1').all() as any[];
    } catch {
      return [];
    }
  }

  /** 解析规划阶段里 LLM 标记的技能触发：`<<SKILL:name>>` */
  private extractSkillTriggers(text: string): string[] {
    const names: string[] = [];
    const regex = /<<SKILL:([\w\-]+)>>/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const n = m[1].trim();
      if (n) names.push(n);
    }
    return names;
  }

  /** 按名称按需加载技能正文（懒加载），返回拼接后的指引文本。
   *  解析范围覆盖全部技能（含未启用），以便前端手动勾选的技能即使未启用也能强制注入。 */
  private loadSkillBodies(names: string[]): string {
    if (names.length === 0) return '';
    let all: any[] = [];
    try {
      all = getDb().prepare('SELECT name,description,path FROM skills').all() as any[];
    } catch {
      return '';
    }
    const blocks: string[] = [];
    for (const n of names) {
      const sk = all.find(e => e.name.toLowerCase() === n.toLowerCase());
      if (!sk) continue;
      const meta = readSkillFile(sk.path);
      if (!meta || !meta.content) continue;
      blocks.push(`### 技能指引：${sk.name}\n${meta.content}`);
    }
    return blocks.join('\n\n');
  }

  buildSystemPrompt(query?: string): string {
    const searchEnabled = this.getSearchConfig().enabled;
    const parts: string[] = [];

    const custom = this.getCustomSystemPrompt().trim();
    parts.push(custom || DEFAULT_SYSTEM_PROMPT);

    // 任务规划清单（WorkBuddy 式）：多步骤任务先在规划阶段输出 [TODO:...] 清单，
    // 系统会实时展示给用户并随步骤推进打勾；简单问答不输出，省 token。
    parts.push('', '## 任务规划清单（按需输出）');
    parts.push('若当前任务需要多个步骤（搜索/抓取/读写文件/逐步推理等），在规划开头按执行顺序每行输出一条 `[TODO:步骤描述]`（例如 `[TODO:搜索行业新闻]`），系统会把清单实时展示给用户、随步骤推进自动打勾。若任务一步即可完成或只是闲聊，不要输出该标记。');

    // 需求澄清（grill-me 风格）：需求存在关键歧义/多选一场景时，先输出 [ASK:{json}] 让用户选择，
    // 系统会暂停生成并展示澄清卡片；用户选择后系统把答案回灌，你再继续执行任务。
    parts.push('', '## 需求澄清（关键歧义时使用）');
    parts.push('当用户需求存在**影响方案走向的关键歧义**（如技术栈/风格/范围/格式多选一，或选项会显著改变结果）时，在规划阶段输出 `[ASK:{"question":"待确认问题","options":["选项1","选项2"],"allowCustom":true}]`（一行 JSON，字段必须是英文双引号），系统会暂停本次生成、把问题和选项展示给用户选择；用户选定后系统把答案作为新消息回灌，你再基于澄清结果继续规划与执行。若需求足够明确、或歧义不影响结果，直接干活即可，不要输出该标记——同一轮最多澄清一次，避免反复打断用户。');
    parts.push('输出示例：`[ASK:{"question":"前端用哪个技术栈？","options":["React + Vite","Vue + Vite","原生 JS"],"allowCustom":true}]`');

    if (searchEnabled) {
      parts.push('', '## 工具说明（由系统自动注入）');
      parts.push('当你需要实时/最新信息、需验证事实、或用户要求查网页时，**必须**输出 [SEARCH:查询关键词] 或 [FETCH:网页URL] 来触发联网搜索/抓取；不要凭记忆编造时效性强或可能过时的内容。');
      parts.push('系统会先执行搜索/抓取，再把真实结果回灌给你，由你基于资料生成最终回答。');
    }

    const workspace = getWorkspaceRoot();
    if (workspace) {
      parts.push('', '## 工作区文件工具（由系统自动注入）');
      parts.push(`当前已配置工作区根目录：${workspace}`);
      parts.push('当用户要求查看、修改、搜索项目文件时，按下列格式在回答里输出文件工具块，系统会先执行、再把结果回灌给你生成最终回答：');
      parts.push('```');
      parts.push('[FS]');
      parts.push('{"action":"read","path":"相对工作区的路径，如 src/app.ts"}');
      parts.push('{"action":"grep","pattern":"正则表达式","path":"搜索范围，目录或文件，默认 "."}');
      parts.push('{"action":"edit","path":"文件","old":"待替换文本","new":"新文本","occurrence":"first 或 all"}');
      parts.push('{"action":"write","path":"文件","content":"完整文件内容"}');
      parts.push('[/FS]');
      parts.push('```');
      parts.push('- 路径一律相对于工作区根目录，不要写绝对路径。');
      parts.push('- 一次可放多个工具调用（每行一个 JSON 对象），但请按需调用、避免无谓的大文件读取。');
      parts.push('- edit 的 old 必须与文件内容逐字一致；找不到会报错，可先用 read/grep 确认。');
      parts.push('- 执行完工具后，系统会给出工具结果，你再基于结果用中文回答用户，并将 [FS] 块本身从最终回答中省略。');

      // 安全约束注入：让 AI 知道审批/沙箱机制，避免幻觉「已写入」
      const policy = getPolicy();
      parts.push('', '### 安全约束（由系统自动注入）');
      parts.push('- 以下路径/文件受保护，禁止读写：.env、.ssh、.aws、.git、node_modules、id_rsa、私钥与凭证文件。');
      parts.push('- 可执行文件（.exe/.dll/.bat/.ps1/.sh/.jar 等）禁止 AI 读写。');
      parts.push('- 写入受限流（每分钟上限）与单文件大小上限约束，超限会报错。');
      if (policy.approvalMode === 'require_approval') {
        parts.push('- **写入审批机制已开启**：你发起的 write/edit 不会直接修改用户文件，而是先暂存到沙箱（.miniclaw-sandbox/），进入审批队列。用户在设置页批准后才会真正写入。在回答里请如实告知「变更待审批」，不要声称已写入。');
      } else {
        parts.push('- 写入审批机制已关闭：你的 write/edit 会直接写入目标文件（但仍受路径/扩展名黑名单约束）。');
      }
    }

    // 记忆（多重模式架构）：长期画像保底注入 + 其余模式由模型按任务难度/类型选择。
    // 有 query 时按 相关性×重要性×时间衰减 取最相关；无 query 时退化为按重要性+时间排序。
    const ranked = this.retrieveMemories(query);
    // profile 模式（A 类）＝长期个性化画像：始终保底注入 top-6，确保用户身份/偏好不被检索淹没。
    const longTerm = ranked.filter(m => m.category === 'A').slice(0, 6);
    if (longTerm.length > 0) {
      parts.push('', '### 关于用户的重要信息');
      longTerm.forEach(m => parts.push(`- ${m.content}`));
    }

    // 记忆模式目录：让模型在规划阶段根据任务难度与类型自行选择要加载的记忆模式。
    // recent（近期关注）与 episodic（任务经验）默认不注入，只有模型显式输出 <<MEM:...>> 时才召回。
    parts.push('', '## 记忆模式（按需选择）');
    parts.push('系统维护多种记忆模式。请根据当前任务的难度与类型，在规划阶段自行判断是否需要加载额外记忆，需要时在规划开头输出 `<<MEM:模式1,模式2>>`（多个用英文逗号分隔），系统会按你的选择加载对应记忆，再让你生成最终回答。若任务简单或与过往记忆无关，不要输出该标记（默认仅保留上方长期画像，最省 token）。');
    for (const mode of MEMORY_MODES) {
      if (mode.key === 'profile') continue; // profile 已保底注入，无需选择
      parts.push(`- <<MEM:${mode.key}>> — ${mode.name}：${mode.desc}。适用：${mode.when}。`);
    }
    parts.push('输出示例：编程任务可输出 `<<MEM:recent,episodic>>` 以复用近期上下文与历史任务经验；简单问答不输出任何标记。');

    // 已启用技能：注入「技能目录」（仅名称 + 描述），而非全量正文。
    // LLM 在规划阶段用 <<SKILL:名称>> 标记要用的技能；网关再按需加载该技能正文进入最终生成——
    // 这就是 WorkBuddy 的「按需加载」模式：目录常驻、正文随用随取，token 友好且不污染上下文。
    // 仅字符串拼接，绝不执行技能代码。
    const enabledSkills = this.getEnabledSkills();
    if (enabledSkills.length > 0) {
      parts.push('', '## 可用技能（按需加载，与 WorkBuddy 一致）');
      parts.push('以下是已启用的技能清单。当用户的需求与某个技能匹配时，**必须**输出 `<<SKILL:技能名>>`（只用技能名，例如 `<<SKILL:concept-visual-demo>>`）来触发该技能；系统会自动加载其完整指引，再由你据此执行——不要自行重写技能的流程与产出形态。若不匹配任何技能，请正常回答、不要输出该标记。');
      parts.push('技能清单：');
      for (const sk of enabledSkills) {
        parts.push(`- ${sk.name}：${sk.description || '（无描述）'}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * 把用户从对话栏「+」引用的文件拼成系统上下文（注入给模型）。
   * - inline 模式：直接带前端已读取的文件内容（适合小文本）。
   * - path 模式：后端安全读取（复用文件工具的安全边界：拒绝受保护路径 + 单文件大小上限）。
   * 返回 null 表示没有附件，调用方无需注入。
   */
  private buildAttachmentContext(attachments?: { name: string; path?: string; content?: string; mode?: 'inline' | 'path' }[]): string | null {
    if (!Array.isArray(attachments) || attachments.length === 0) return null;
    const parts: string[] = ['以下是用户在本轮对话中引用的文件，请结合这些文件的内容来回答用户的问题（引用内容仅供本次对话使用）：', ''];
    const MAX_TOTAL = 200_000; // 总注入字符上限，防爆上下文
    let total = 0;
    for (const a of attachments) {
      if (!a || !a.name) continue;
      let body = '';
      if (typeof a.content === 'string' && a.content) {
        body = a.content;
      } else if (a.path) {
        body = this.readAttachmentFile(a.path);
      }
      if (!body) {
        parts.push(`- ${a.name}${a.path ? `（路径：${a.path}）` : ''}：（无法读取内容，可能文件过大、受保护或不存在）`);
        continue;
      }
      if (total + body.length > MAX_TOTAL) {
        parts.push(`- ${a.name}：（内容过大已省略，仅记录路径 ${a.path || ''}）`);
        continue;
      }
      total += body.length;
      parts.push(`### 文件：${a.name}${a.path ? `（${a.path}）` : ''}`);
      parts.push(body);
      parts.push('');
    }
    return parts.join('\n');
  }

  /** 安全读取用户引用的本地文件（path 模式）。拒绝受保护路径与超大文件。 */
  private readAttachmentFile(p: string): string {
    try {
      const abs = path.resolve(p);
      const forbidden = ['.env', '.ssh', '.aws', '.git', 'node_modules', 'id_rsa', 'private_key'];
      if (forbidden.some(f => abs.toLowerCase().includes(f.toLowerCase()))) return '';
      const st = fs.statSync(abs);
      if (!st.isFile()) return '';
      if (st.size > 2 * 1024 * 1024) return ''; // 单文件 > 2MB 不读
      return fs.readFileSync(abs, 'utf-8');
    } catch {
      return '';
    }
  }

  /** Generate a response from the AI (collects full text, doesn't stream) */
  private async generateOnce(provider: ProviderConfig, agent: AgentConfig, messages: ChatMessage[], temperature?: number, signal?: AbortSignal): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
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

  /**
   * 本地 token 估算（兜底）：当服务商不在流式响应里返回 usage 时，
   * 用「CJK 字符按 1 token、其余按空白词 1 token」的粗略规则估算，
   * 保证 token 统计不会因缺 usage 而恒为 0。
   * 若服务商正常返回 usage，则上层用真实值，不会走到这里。
   */
  private estimateTokens(text: string): number {
    if (!text) return 0;
    const cjk = (text.match(/[㐀-䶿一-鿿豈-﫿]/g) || []).length;
    const nonCjk = text.replace(/[㐀-䶿一-鿿豈-﫿]/g, ' ');
    const words = nonCjk.trim() ? nonCjk.trim().split(/\s+/).length : 0;
    return cjk + words;
  }

  /** 当前模型上下文窗口上限（tokens）：按模型名映射，未知模型给保守默认值 */
  getContextLimit(providerId?: string, model?: string): number {
    const m = (model || '').toLowerCase();
    if (MODEL_CONTEXT_LIMITS[m]) return MODEL_CONTEXT_LIMITS[m];
    // 尝试前缀/包含匹配（如 gpt-5.4-mini 命中 gpt-5.4）
    const keys = Object.keys(MODEL_CONTEXT_LIMITS).sort((a, b) => b.length - a.length);
    for (const k of keys) if (m.includes(k)) return MODEL_CONTEXT_LIMITS[k];
    return DEFAULT_CONTEXT_LIMIT;
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
    const db = getDb();
    const msgs = db.prepare('SELECT role, content, tokens FROM messages WHERE session_id=? ORDER BY ts').all(sessionId) as any[];
    const selected = this.getSelectedModel();
    const providerId = selected?.providerId || '';
    const model = selected?.model || '';
    const limit = this.getContextLimit(providerId, model);
    const sys = this.estimateTokens(this.buildSystemPrompt(''));
    let hist = 0, tools = 0, files = 0;
    for (const m of msgs) {
      const content = m.content || '';
      const t = (m.tokens && m.tokens > 0) ? m.tokens : this.estimateTokens(content);
      if (/\[SEARCH:|\[FETCH:|\[FS\]|<<SKILL:|<<MEM:/.test(content)) tools += t;
      else if (/【文件内容|【grep|【编辑结果|【写入结果|【文件工具/.test(content)) files += t;
      else hist += t;
    }
    const used = sys + hist + tools + files;
    return { limit, used, sys, hist, tools, files, model };
  }

  private extractMemos(text: string): { content: string; category: 'A' | 'B' | 'C' }[] {
    const memos: { content: string; category: 'A' | 'B' | 'C' }[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      const match = trimmed.match(/^\[MEMO:(.+?)\|([ABC])\]$/);
      if (match) {
        const content = match[1].trim();
        const cat = match[2].trim();
        if (content && (cat === 'A' || cat === 'B' || cat === 'C')) {
          memos.push({ content, category: cat });
        }
      }
    }
    return memos;
  }

  private async summarizeMemories(provider: ProviderConfig, history: ChatMessage[]): Promise<void> {
    const sumPrompt = '仅根据以上对话，提取值得记住的用户信息（名字、偏好、习惯、当前关注等）或任务经验（方案、踩坑、可复用代码片段/结论）。有就按格式输出，一条一行。没有值得记的内容就输出 NONE。\n格式：\n[MEMO:内容|A]\nA=长期重要（身份/偏好/习惯），B=短期重要（当前话题/需求），C=任务经验（方案/踩坑/可复用结论）。';
    const sumHistory: ChatMessage[] = [{ role: 'system', content: sumPrompt }, ...history.slice(-4)];
    const sumAgent: AgentConfig = { id: 'default', name: '助手', role: 'assistant', providerId: provider.id, model: provider.defaultModel, systemPrompt: '', enabled: true };
    const { text } = await this.generateOnce(provider, sumAgent, sumHistory);
    const memos = this.extractMemos(text);
    for (const memo of memos) {
      this.saveMemo(memo.content, memo.category);
      log.info({ content: memo.content, category: memo.category }, 'Memory saved via summarization');
    }
  }

  private saveMemo(content: string, category: string, source?: string): void {
    category = category.trim();
    if (!content || (category !== 'A' && category !== 'B' && category !== 'C')) return;
    const db = getDb();
    // A=长期个性化画像，默认重要性最高；B=近期关注，默认中等；C=任务经验，默认较高（复杂任务复用价值高）。
    // 来源用于溯源（来自哪次会话/摘要）
    const importance = category === 'A' ? 0.9 : category === 'C' ? 0.8 : 0.6;
    const existing = db.prepare('SELECT id, category, importance FROM memories WHERE content = ?').get(content) as any;
    if (existing) {
      if (existing.category !== category) {
        db.prepare('UPDATE memories SET category = ?, created_at = datetime("now"), importance = ?, source = COALESCE(source, ?) WHERE id = ?')
          .run(category, importance, source || null, existing.id);
      } else {
        // 刷新时间；仅在更高时提升 importance（避免被低权重覆盖）；补记来源
        db.prepare('UPDATE memories SET created_at = datetime("now"), importance = MAX(importance, ?), source = COALESCE(source, ?) WHERE id = ?')
          .run(importance, source || null, existing.id);
      }
      return;
    }
    const count = (db.prepare('SELECT COUNT(*) AS c FROM memories WHERE category = ?').get(category) as any).c;
    const limit = category === 'A' ? 15 : category === 'C' ? 15 : 10;
    if (count >= limit) {
      // 限流：优先删除「重要性最低且最旧」的一条（替代原纯 FIFO，更贴近衰减语义）
      db.prepare('DELETE FROM memories WHERE id IN (SELECT id FROM memories WHERE category = ? ORDER BY importance ASC, created_at ASC LIMIT 1)').run(category);
    }
    db.prepare('INSERT INTO memories (content, category, importance, source) VALUES (?, ?, ?, ?)')
      .run(content, category, importance, source || null);
  }

  /**
   * 按会话维护已广播的 artifact id，保证同一个 artifact 在流式多次提取时只发一次。
   * id 由内容指纹生成（见 artifact.ts），所以「相同内容」天然去重，重复 emit 自动跳过。
   */
  private artifactSeenIds = new Map<string, Set<string>>();

  /**
   * 从 AI 回复中提取 artifact 并通过事件总线广播，驱动预览子系统。
   * 仅负责「提取 + 发射」；消费方（主进程 PreviewService / 渲染进程 PreviewClient）
   * 各自订阅 gateway 的 'artifact' 事件，互不直接依赖。
   * 幂等：已广播过的 id 不再重复 emit，因此可在流式过程中反复调用（实现「实时预览」）。
   */
  private publishArtifacts(sessionId: string, text: string): void {
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

  async handleMessage(inbound: InboundMessage): Promise<string> {
    // 优先用前端指定的 provider/model；否则回退到「已选模型」；最后回退默认服务商
    let provider: ProviderConfig | null = null;
    let chosenModel: string | null = null;

    if (inbound.providerId) {
      provider = this.getProviderById(inbound.providerId);
    } else {
      const selected = this.getSelectedModel();
      if (selected) {
        provider = this.getProviderById(selected.providerId);
        chosenModel = selected.model;
      }
    }
    if (!provider) provider = this.getDefaultProvider();
    if (!provider) throw new Error('请先在设置页添加 API 服务商');

    const model = inbound.model || chosenModel || provider.defaultModel;

    const db = getDb();
    const sessionId = inbound.sessionId || uuidv4();
    // 新一轮对话：清空该会话已广播的 artifact id，使相同内容在新消息里能重新预览
    this.artifactSeenIds.delete(sessionId);
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
    const attachmentCtx = this.buildAttachmentContext(inbound.attachments);
    const convHistory: ChatMessage[] = attachmentCtx ? [{ role: 'system', content: attachmentCtx }, ...history] : history;
    const systemPrompt = this.buildSystemPrompt(inbound.text);
    const agent: AgentConfig = { id: 'default', name: '助手', role: 'assistant', providerId: provider.id, model, systemPrompt, enabled: true };

    const searchConfig = this.getSearchConfig();
    const temp = inbound.temperature;

    // 创建 AbortController 支持中止（超时自动中止）
    const controller = new AbortController();
    activeControllers.set(sessionId, controller);
    const timeout = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

    const checkAborted = () => { if (controller.signal.aborted) throw new Error('__ABORTED__'); };

    // 后台任务：记录本次生成，阶段实时广播给任务栏
    this.startRunning(sessionId, inbound.text.slice(0, 50) || '新对话', provider.id, model);

    // 简易 Trace：以本次请求为根 Span，下游 LLM 调用会作为子 Span 挂上来
    const trace = tracer.startTrace(sessionId, 'chat', { model: model || '', provider: provider.id });
    // 实时 Trace：请求开始即推送初始 payload（含未结束的 root span），
    // 之后每个 Span 的 start/end 增量推送 trace-span，前端边收边画、支持展开详情。
    this.emit('trace-start', { sessionId, trace: trace.toPayload() });
    trace.on('span', (ev: any) => {
      this.emit('trace-span', { sessionId, phase: ev.phase, span: ev.span });
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
      const skillsEnabled = this.getEnabledSkills().length > 0 || manualSkills.length > 0;

      if (toolsEnabled || skillsEnabled) {
        checkAborted();
        const { text: plan, promptTokens: pt1, completionTokens: ct1 } = await this.generateOnce(provider, agent, convHistory, temp, controller.signal);
        checkAborted();

        const searchQueries = this.extractSearchQueries(plan);
        const fetchUrls = this.extractUrls(plan);
        const fsToolCalls = extractFsTools(plan);
        const skillTriggers = this.extractSkillTriggers(plan);
        // 合并「LLM 自动触发」与「用户手动勾选」的技能：手动勾选的强制注入，不会被 LLM 忽略
        const allSkillTriggers = [...new Set([...skillTriggers, ...manualSkills])];
        // 记忆模式：模型在规划阶段用 <<MEM:...>> 显式选择要加载的记忆模式（多重记忆架构）。
        // 未输出标记时按「复杂任务」默认加载全模式；<<MEM:none>> 表示本任务不需要额外记忆。
        const memTriggers = this.extractMemoryTriggers(plan);
        // 任务规划清单（WorkBuddy 式）：解析 [TODO:...] 步骤清单并立即经 SSE 下发，
        // 前端实时展示「任务清单」并随 step 完成逐个打勾。无论是否触发工具都下发。
        const todos = this.extractTodos(plan);
        if (todos.length > 0) {
          this.emit('todos', { sessionId, todos });
        }

        // 需求澄清（grill-me 风格）：模型在规划阶段输出 [ASK:{json}] 时，挂起本次生成，
        // 经 SSE 下发澄清问题与选项，等用户选择后再恢复（见 answerClarify）。
        const clarify = this.extractClarify(plan);
        if (clarify) {
          this.pendingClarify.set(sessionId, {
            provider, agent, history, sessionId, model, temp, source: inbound.source, clarify,
          });
          this.tickRunning(sessionId, 'writing'); // 阶段推进提示（澄清中）
          this.emit('clarify', { sessionId, question: clarify.question, options: clarify.options, allowCustom: clarify.allowCustom });
          // 不继续执行工具/最终生成，等待用户选择
          return sessionId;
        }

        if (searchQueries.length > 0 || fetchUrls.length > 0 || fsToolCalls.length > 0 || allSkillTriggers.length > 0) {
          const toolResults: string[] = [];

          // 联网搜索
          if (searchQueries.length > 0) {
            this.tickRunning(sessionId, 'searching');
            const stepId = uuidv4();
            const span = trace?.startChild('tool.call', 'tool', { tool: 'search', queries: searchQueries });
            this.emit('step', { sessionId, step: { stepId, name: '联网搜索', tool: 'search', status: 'running', args: searchQueries, startedAt: Date.now() } });
            const results = await this.performSearches(searchQueries, searchConfig);
            this.emit('step', { sessionId, step: { stepId, status: 'done', endedAt: Date.now(), result: `已搜索 ${searchQueries.length} 个关键词` } });
            span?.end();
            toolResults.push(results);
          }

          // 抓取网页
          if (fetchUrls.length > 0) {
            this.tickRunning(sessionId, 'fetching');
            const stepId = uuidv4();
            const span = trace?.startChild('tool.call', 'tool', { tool: 'fetch', urls: fetchUrls });
            this.emit('step', { sessionId, step: { stepId, name: '抓取网页', tool: 'fetch', status: 'running', args: fetchUrls, startedAt: Date.now() } });
            const results = await this.performFetches(fetchUrls);
            this.emit('step', { sessionId, step: { stepId, status: 'done', endedAt: Date.now(), result: `已抓取 ${fetchUrls.length} 个网页` } });
            span?.end();
            toolResults.push(results);
          }

          // 文件工具（read/grep/edit/write）
          if (fsToolCalls.length > 0) {
            for (const call of fsToolCalls) {
              const res = await this.runFileTool(sessionId, call, trace);
              toolResults.push(res);
            }
          }

          checkAborted();

          const toolContext = toolResults.join('\n').slice(0, 14000);
          const skillBodies = this.loadSkillBodies(allSkillTriggers);
          // 记忆模式注入：模型选了哪些模式就召回哪些；没选时按复杂任务默认全模式（profile+recent+episodic）。
          // <<MEM:none>> → 空列表，本任务不带额外记忆（省 token）。
          const memKeys = memTriggers.length > 0
            ? (memTriggers.includes('none') ? [] : memTriggers)
            : this.resolveMemoryModes({ complex: true });
          const memBlocks = this.loadModeMemories(memKeys, inbound.text);
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
          this.tickRunning(sessionId, 'writing');
          for await (const chunk of this.engine.chat(provider, agent, augmented, temp, controller.signal)) {
            checkAborted();
            if (chunk.reasoning) { reasoningFull += chunk.reasoning; this.emit('reasoning', { sessionId, content: chunk.reasoning }); }
            finalText += chunk.content;
            // 实时预览：token 流里出现围栏/标签边界时增量提取 artifact（幂等去重，只发新增）
            if (/[\n`<>]/.test(chunk.content)) this.publishArtifacts(sessionId, trimMarkers(finalText));
            if (chunk.usage) { finalPt = chunk.usage.promptTokens; finalCt = chunk.usage.completionTokens; }
            this.emit('token', { sessionId, content: chunk.content, done: false });
          }

          const cleaned = trimMarkers(finalText);
          // 兜底：未返回 usage 时用本地估算（规划阶段 + 最终阶段分别估算）
          const planPromptText = systemPrompt + '\n' + history.map(m => m.role + ':' + m.content).join('\n');
          const estPlanPrompt = this.estimateTokens(planPromptText);
          const estPlanCompletion = this.estimateTokens(plan);
          const estFinalPrompt = this.estimateTokens(systemPrompt + '\n' + augmented.map(m => m.role + ':' + m.content).join('\n'));
          const estFinalCompletion = this.estimateTokens(finalText);
          const recPt1 = pt1 || estPlanPrompt;
          const recCt1 = ct1 || estPlanCompletion;
          const recFinalPt = finalPt || estFinalPrompt;
          const recFinalCt = finalCt || estFinalCompletion;
          db.prepare("INSERT INTO messages (session_id,role,content,tokens,reasoning,model) VALUES (?,'assistant',?,?,?,?)").run(sessionId, cleaned, recFinalCt, reasoningFull, model);
          db.prepare('INSERT INTO token_usage (agent_id,provider_id,model,prompt_tokens,completion_tokens) VALUES (?,?,?,?,?)').run(agent.id, provider.id, agent.model, recPt1 + recFinalPt, recCt1 + recFinalCt);
          this.emit('token', { sessionId, content: '', done: true, model, tokens: recFinalCt });
          this.finishRunning(sessionId, true);

          this.publishArtifacts(sessionId, cleaned);
          this.extractMemories(history, cleaned, sessionId);
          return sessionId;
        }

        // 规划阶段没产出任何工具调用：直接把规划当作最终回答流式输出
        const cleaned = trimMarkers(plan);
        const CHUNK_SIZE = 3;
        this.tickRunning(sessionId, 'writing');
        for (let i = 0; i < cleaned.length; i += CHUNK_SIZE) {
          this.emit('token', { sessionId, content: cleaned.slice(i, i + CHUNK_SIZE), done: false });
          // 实时预览：分块到达围栏/标签边界时增量提取 artifact
          if (/[\n`<>]/.test(cleaned.slice(i, i + CHUNK_SIZE))) this.publishArtifacts(sessionId, cleaned.slice(0, i + CHUNK_SIZE));
        }
        // 兜底：未返回 usage 时用本地估算（规划即最终回答）
        const planPromptText2 = systemPrompt + '\n' + history.map(m => m.role + ':' + m.content).join('\n');
        const recPt1b = pt1 || this.estimateTokens(planPromptText2);
        const recCt1b = ct1 || this.estimateTokens(plan);
        db.prepare("INSERT INTO messages (session_id,role,content,tokens,reasoning,model) VALUES (?,'assistant',?,?,?,?)").run(sessionId, cleaned, recCt1b, reasoningFull, model);
        db.prepare('INSERT INTO token_usage (agent_id,provider_id,model,prompt_tokens,completion_tokens) VALUES (?,?,?,?,?)').run(agent.id, provider.id, agent.model, recPt1b, recCt1b);
        this.emit('token', { sessionId, content: '', done: true, model, tokens: recCt1b });
        this.finishRunning(sessionId, true);

        this.publishArtifacts(sessionId, cleaned);
        this.extractMemories(history, cleaned, sessionId);
        return sessionId;
      }

      // 未启用任何工具（无联网搜索且无工作区）：直接流式输出
      let full = '';
      let promptTokens = 0;
      let completionTokens = 0;
      this.tickRunning(sessionId, 'writing');
      for await (const chunk of this.engine.chat(provider, agent, convHistory, temp, controller.signal)) {
        checkAborted();
        if (chunk.reasoning) this.emit('reasoning', { sessionId, content: chunk.reasoning });
        full += chunk.content;
        // 实时预览：token 流里出现围栏/标签边界时增量提取 artifact
        if (/[\n`<>]/.test(chunk.content)) this.publishArtifacts(sessionId, full);
        if (chunk.usage) { promptTokens = chunk.usage.promptTokens; completionTokens = chunk.usage.completionTokens; }
        this.emit('token', { sessionId, content: chunk.content, done: chunk.done });
        if (chunk.done) break;
      }

      // 兜底：服务商未返回 usage 时，用本地估算，避免 token 统计恒为 0
      const estPrompt0 = this.estimateTokens(systemPrompt + '\n' + history.map(m => m.role + ':' + m.content).join('\n'));
      const estCompletion0 = this.estimateTokens(full);
      const recPrompt0 = promptTokens || estPrompt0;
      const recCompletion0 = completionTokens || estCompletion0;
      db.prepare("INSERT INTO messages (session_id,role,content,tokens,reasoning,model) VALUES (?,'assistant',?,?,?,?)").run(sessionId, full, recCompletion0, reasoningFull, model);
      db.prepare('INSERT INTO token_usage (agent_id,provider_id,model,prompt_tokens,completion_tokens) VALUES (?,?,?,?,?)').run(agent.id, provider.id, agent.model, recPrompt0, recCompletion0);

      this.emit('token', { sessionId, content: '', done: true, model, tokens: recCompletion0 });
      this.finishRunning(sessionId, true);

      this.publishArtifacts(sessionId, full);
      this.extractMemories(history, full, sessionId);
      return sessionId;
    } catch (err: any) {
      if (err.message === '__ABORTED__' || controller.signal.aborted) {
        if (userAbortedSessions.has(sessionId)) {
          // 用户主动停止：前端已知，静默收尾（只发 done 复位 busy），不报错
          this.emit('token', { sessionId, content: '', done: true });
          this.finishRunning(sessionId, true);
        } else {
          // 服务端超时中止：必须明确报错，否则前端只收到空回复、用户完全不知道发生了什么
          const msg = '请求超时：服务端在 ' + Math.round(STREAM_TIMEOUT_MS / 1000) + ' 秒内未收到完整回复，已自动中止。可点重试，或换用响应更快的模型 / 关闭联网搜索。';
          trace.setError(msg);
          this.emit('chat-error', { sessionId, error: msg });
          this.finishRunning(sessionId, false, msg);
          userAbortedSessions.delete(sessionId);
          throw new Error(msg);
        }
        userAbortedSessions.delete(sessionId);
        return sessionId;
      }
      // 广播错误事件，驱动前端给出明确的失败反馈（而非一直转圈）
      trace.setError(err.message || '未知错误');
      this.emit('chat-error', { sessionId, error: err.message || '未知错误' });
      this.finishRunning(sessionId, false, err.message || '未知错误');
      log.error({ sessionId, error: err.message }, 'Chat failed');
      throw err;
    } finally {
      clearTimeout(timeout);
      activeControllers.delete(sessionId);
      // 结束本次 Trace 并广播给前端（瀑布面板实时刷新；同时已落库可历史回查）
      trace.end();
      this.emit('trace', trace.toPayload());
    }
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
    // 用户选择以 system 消息入库（模型 history 可见，但前端不渲染成用户气泡，
    // 保证「澄清卡片 → 选择 → AI 继续」在同一轮对话流内自然衔接，不割裂成新的一轮）。
    db.prepare("INSERT INTO messages (session_id,role,content) VALUES (?,?,?)")
      .run(sessionId, 'system', `【需求确认】${ctx.clarify.question}\n用户选择：${answer}`);
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

  private extractMemories(history: ChatMessage[], reply: string, source?: string): void {
    const provider = this.getDefaultProvider();
    if (!provider) return;
    const memos = this.extractMemos(reply);
    if (memos.length > 0) {
      for (const memo of memos) {
        this.saveMemo(memo.content, memo.category, source);
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
    const controller = activeControllers.get(sessionId);
    if (controller) {
      userAbortedSessions.add(sessionId); // 标记为用户主动中止，catch 分支据此静默收尾
      controller.abort();
      activeControllers.delete(sessionId);
      log.info({ sessionId }, 'Request aborted');
      return true;
    }
    return false;
  }

  private startScheduler(): void {
    if (this.schedulerTimer) return;
    this.schedulerTimer = setInterval(() => { this.checkDueTasks().catch(() => {}); }, 20_000);
    log.info('Scheduled task scheduler started (every 20s)');
  }

  /** 轮询：扫描到期任务，逐个触发（doingTasks 防同任务重叠） */
  private async checkDueTasks(): Promise<void> {
    const db = getDb();
    const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const due = db.prepare('SELECT * FROM scheduled_tasks WHERE enabled=1 AND next_run_at <= ? ORDER BY next_run_at ASC').all(nowStr) as any[];
    for (const t of due) {
      if (this.doingTasks.has(t.id)) continue;
      this.doingTasks.add(t.id);
      db.prepare("UPDATE scheduled_tasks SET last_status='running', updated_at=datetime('now') WHERE id=?").run(t.id);
      try {
        await this.handleMessage({
          source: 'main', sessionId: t.session_id, text: t.prompt,
          providerId: t.provider_id || undefined, model: t.model || undefined,
        });
        db.prepare("UPDATE scheduled_tasks SET last_status='ok', last_run_at=?, updated_at=datetime('now') WHERE id=?").run(nowStr, t.id);
      } catch (err: any) {
        db.prepare("UPDATE scheduled_tasks SET last_status='error', last_run_at=?, updated_at=datetime('now') WHERE id=?").run(nowStr, t.id);
        log.warn({ taskId: t.id, error: err.message }, 'Scheduled task run failed');
      } finally {
        this.doingTasks.delete(t.id);
      }
      // 推进下一次触发时间；once 任务执行后自动停用
      const nxt = this.nextRunAt(t);
      if (nxt) {
        db.prepare('UPDATE scheduled_tasks SET next_run_at=? WHERE id=?').run(nxt, t.id);
      } else {
        db.prepare("UPDATE scheduled_tasks SET enabled=0, updated_at=datetime('now') WHERE id=?").run(t.id);
      }
    }
  }

  /** 计算任务的下一步触发时间（SQLite 时间串），null 表示不再触发 */
  private nextRunAt(t: any): string | null {
    if (t.mode === 'interval' && t.interval_minutes > 0) {
      const base = new Date();
      base.setMinutes(base.getMinutes() + t.interval_minutes);
      return base.toISOString().slice(0, 19).replace('T', ' ');
    }
    return null; // once：执行一次后停用
  }

  /** 校验 providerId/model：显式指定 > 已选模型 > 默认服务商 */
  private resolveTaskModel(providerId?: string, model?: string): { providerId: string; model: string } {
    const selected = this.getSelectedModel();
    const p = (providerId ? this.getProviderById(providerId) : null)
      || (selected ? this.getProviderById(selected.providerId) : null)
      || this.getDefaultProvider();
    const m = model || selected?.model || p?.defaultModel || '';
    return { providerId: p?.id || '', model: m };
  }

  /** 任务列表（含归属会话标题，供前端直接展示/跳转） */
  listScheduledTasks(): any[] {
    const db = getDb();
    return db.prepare(`
      SELECT t.*, COALESCE(s.title, '') AS session_title
      FROM scheduled_tasks t
      LEFT JOIN sessions s ON s.id = t.session_id
      ORDER BY t.created_at ASC
    `).all() as any[];
  }

  /** 新建定时任务：mode=once 用 at（ISO 时间），mode=interval 用 intervalMinutes（自 now 起） */
  createScheduledTask(input: {
    name: string; prompt: string; mode: 'once' | 'interval';
    at?: string; intervalMinutes?: number; providerId?: string; model?: string;
  }): any {
    const db = getDb();
    if (!input.name?.trim()) throw new Error('任务名称不能为空');
    if (!input.prompt?.trim()) throw new Error('任务内容不能为空');
    if (input.mode === 'interval' && (!input.intervalMinutes || input.intervalMinutes <= 0)) throw new Error('间隔需为正数（分钟）');
    const id = uuidv4();
    const sessionId = uuidv4();
    const { providerId, model } = this.resolveTaskModel(input.providerId, input.model);
    const toSql = (d: Date | string) => new Date(d).toISOString().slice(0, 19).replace('T', ' ');
    let nextRun: string;
    if (input.mode === 'once') {
      if (!input.at) throw new Error('一次性任务需指定执行时间');
      nextRun = toSql(input.at);
    } else {
      nextRun = toSql(new Date(Date.now() + input.intervalMinutes! * 60_000));
    }
    db.prepare('INSERT INTO sessions (id,agent_id,source,title) VALUES (?,?,?,?)')
      .run(sessionId, 'default', 'main', `【定时】${input.name.trim()}`);
    db.prepare(`
      INSERT INTO scheduled_tasks (id,name,prompt,mode,next_run_at,interval_minutes,session_id,provider_id,model,enabled)
      VALUES (?,?,?,?,?,?,?,?,?,1)
    `).run(id, input.name.trim(), input.prompt.trim(), input.mode, nextRun, input.intervalMinutes || 0, sessionId, providerId, model);
    log.info({ taskId: id, mode: input.mode, nextRunAt: nextRun }, 'Scheduled task created');
    return this.listScheduledTasks().find(t => t.id === id) || null;
  }

  /** 更新任务（名称/内容/启停/time/间隔） */
  updateScheduledTask(id: string, patch: {
    name?: string; prompt?: string; enabled?: boolean; at?: string; intervalMinutes?: number;
  }): any {
    const db = getDb();
    const t = db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(id) as any;
    if (!t) return null;
    if (patch.name !== undefined && patch.name.trim()) {
      db.prepare("UPDATE scheduled_tasks SET name=?, updated_at=datetime('now') WHERE id=?").run(patch.name.trim(), id);
      db.prepare('UPDATE sessions SET title=? WHERE id=?').run(`【定时】${patch.name.trim()}`, t.session_id);
    }
    if (patch.prompt !== undefined && patch.prompt.trim()) {
      db.prepare("UPDATE scheduled_tasks SET prompt=?, updated_at=datetime('now') WHERE id=?").run(patch.prompt.trim(), id);
    }
    if (patch.enabled !== undefined) {
      db.prepare("UPDATE scheduled_tasks SET enabled=?, updated_at=datetime('now') WHERE id=?").run(patch.enabled ? 1 : 0, id);
    }
    if (patch.at) {
      db.prepare("UPDATE scheduled_tasks SET next_run_at=?, mode='once', updated_at=datetime('now') WHERE id=?")
        .run(new Date(patch.at).toISOString().slice(0, 19).replace('T', ' '), id);
    }
    if (patch.intervalMinutes !== undefined && patch.intervalMinutes > 0) {
      const nxt = new Date(Date.now() + patch.intervalMinutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
      db.prepare("UPDATE scheduled_tasks SET interval_minutes=?, mode='interval', next_run_at=?, updated_at=datetime('now') WHERE id=?")
        .run(patch.intervalMinutes, nxt, id);
    }
    return this.listScheduledTasks().find(x => x.id === id) || null;
  }

  /** 删除任务：同时软删除归属会话（保留历史，不物理删） */
  deleteScheduledTask(id: string): boolean {
    const db = getDb();
    const t = db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(id) as any;
    if (!t) return false;
    db.prepare("UPDATE sessions SET updated_at=datetime('now') WHERE id=?").run(t.session_id);
    db.prepare('DELETE FROM scheduled_tasks WHERE id=?').run(id);
    log.info({ taskId: id }, 'Scheduled task deleted');
    return true;
  }

  async stop(): Promise<void> {
    if (this.schedulerTimer) { clearInterval(this.schedulerTimer); this.schedulerTimer = null; }
    // 中止所有活跃请求
    for (const [sid, controller] of activeControllers) {
      controller.abort();
    }
    activeControllers.clear();
    this.removeAllListeners();
    log.info('Gateway stopped');
  }
}
