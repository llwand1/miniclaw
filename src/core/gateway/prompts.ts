import fs from 'node:fs';
import path from 'node:path';
import { getWorkspaceRoot } from '../fs-tools';
import { getPolicy } from '../security/policy';
import { getSearchConfig, getCustomSystemPrompt, getEnabledSkills } from './providers';
import { MEMORY_MODES, retrieveMemories } from './memory';

// 默认系统提示词：借鉴主流开源项目（Claude Code / Cline / OpenCode 等）的写法，
// 以「身份 + 准则 + 行为 + 记忆」四段式组织，结构化、可执行，便于各模型稳定遵循。
// 用户可在「设置 → 系统提示词」中自定义覆盖；未配置时使用本默认值。
export const DEFAULT_SYSTEM_PROMPT = [
  '你是 studentbuddy，一个运行在用户本机、由用户自己配置的大模型驱动的**中文桌面 AI 助手**。你的目标是成为用户可信赖的全能工作搭档，而非只会聊天的机器人。',
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
 * 组装本次请求最终使用的系统提示词：用户自定义（或内置默认） + 自动注入的工具说明与记忆。
 * 由 gateway 调用（buildSystemPrompt），与记忆/技能/搜索/工作区状态联动。
 */
export function buildSystemPrompt(query?: string, sessionId?: string): string {
  const searchEnabled = getSearchConfig().enabled;
  const parts: string[] = [];

  const custom = getCustomSystemPrompt().trim();
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
      parts.push('- **写入审批机制已开启**：你发起的 write/edit 不会直接修改用户文件，而是先暂存到沙箱（.studentbuddy-sandbox/），进入审批队列。用户在设置页批准后才会真正写入。在回答里请如实告知「变更待审批」，不要声称已写入。');
    } else {
      parts.push('- 写入审批机制已关闭：你的 write/edit 会直接写入目标文件（但仍受路径/扩展名黑名单约束）。');
    }
  }

  // 记忆（多重模式架构）：长期画像保底注入 + 其余模式由模型按任务难度/类型选择。
  // 有 query 时按 相关性×重要性×时间衰减 取最相关；无 query 时退化为按重要性+时间排序。
  const ranked = retrieveMemories(query);
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
  const enabledSkills = getEnabledSkills();
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
export interface InboundAttachment { name: string; path?: string; content?: string; mode?: 'inline' | 'path' }

/** 附件总注入字符上限，防爆上下文（buildAttachmentContext 与 readAttachmentFile 共用）。 */
const MAX_TOTAL = 200_000;

export function buildAttachmentContext(attachments?: InboundAttachment[], opts?: { maxChars?: number }): string | null {
  if (!Array.isArray(attachments) || attachments.length === 0) return null;
  // 默认 200KB；调用方可按模型窗口预算收紧（chat-flow 传入 maxChars）
  const maxChars = opts?.maxChars ?? MAX_TOTAL;
  const parts: string[] = ['以下是用户在本轮对话中引用的文件，请结合这些文件的内容来回答用户的问题（引用内容仅供本次对话使用）：', ''];
  let total = 0;
  for (const a of attachments) {
    if (!a || !a.name) continue;
    let body = '';
    if (typeof a.content === 'string' && a.content) {
      body = a.content;
    } else if (a.path) {
      body = readAttachmentFile(a.path);
    }
    if (!body) {
      parts.push(`- ${a.name}${a.path ? `（路径：${a.path}）` : ''}：（无法读取内容，可能文件过大、受保护或不存在）`);
      continue;
    }
    if (total + body.length > maxChars) {
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

/** 安全读取用户引用的本地文件（path 模式）。拒绝受保护路径与超大文件。
 *  优先读提取伴生文件（upload.ts 上传时生成的 `<原路径>.txt` 纯文本，PDF/DOCX/PPTX 提取结果），
 *  没有伴生文件（工作区引用等）才读原文件。 */
function readAttachmentFile(p: string): string {
  try {
    const abs = path.resolve(p);
    const forbidden = ['.env', '.ssh', '.aws', '.git', 'node_modules', 'id_rsa', 'private_key'];
    if (forbidden.some(f => abs.toLowerCase().includes(f.toLowerCase()))) return '';
    // 1) 优先读提取伴生文件（上传的 PDF/DOCX/PPTX 已异步提取为纯文本）
    const textPath = abs + '.txt';
    if (fs.existsSync(textPath) && fs.statSync(textPath).isFile()) {
      const t = fs.statSync(textPath);
      if (t.size > MAX_TOTAL) return fs.readFileSync(textPath, 'utf-8').slice(0, MAX_TOTAL);
      return fs.readFileSync(textPath, 'utf-8');
    }
    // 2) 否则读原文件（工作区文本引用；单文件 20MB 上限，防超大 payload）
    const st = fs.statSync(abs);
    if (!st.isFile()) return '';
    if (st.size > 20 * 1024 * 1024) return ''; // 单文件 > 20MB 不读
    return fs.readFileSync(abs, 'utf-8');
  } catch {
    return '';
  }
}