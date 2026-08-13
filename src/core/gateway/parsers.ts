import { v4 as uuidv4 } from 'uuid';

/**
 * 从最终回答里清除各类规划/工具标记，避免把内部指令残留给用户。
 */
export function trimMarkers(text: string): string {
  let out = text.replace(/\[SEARCH:[^\]]*\]/g, '').replace(/\[FETCH:[^\]]*\]/g, '');
  // 去掉 [FS]...[/FS] 文件工具块（含内部多行 JSONL 指令，最终回答里不应出现）。
  // 容错：模型可能漏写闭合 [/FS]（生成中断/省略），此时删到文本末尾，避免工具标记原文泄漏给用户。
  out = out.replace(/\[FS\][\s\S]*?(?:\[\/FS\]|$)/gi, '');
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
export interface FsToolCall {
  action: 'read' | 'grep' | 'edit' | 'write';
  path: string;
  pattern?: string;
  old?: string;
  new?: string;
  content?: string;
  occurrence?: 'first' | 'all';
}

export function extractFsTools(text: string): FsToolCall[] {
  const calls: FsToolCall[] = [];
  // 容错：模型可能漏写闭合 [/FS]（生成中断/省略），此时匹配到文本末尾也要解析出工具调用。
  const re = /\[FS\]\s*([\s\S]*?)(?:\[\/FS\]|$)/gi;
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

/** 解析规划文本里的 [SEARCH:关键词] 联网搜索标记 */
export function extractSearchQueries(text: string): string[] {
  const queries: string[] = [];
  const regex = /\[SEARCH:(.+?)\]/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const q = m[1].trim();
    if (q) queries.push(q);
  }
  return queries;
}

/** 解析规划文本里的 [FETCH:url] 网页抓取标记 */
export function extractUrls(text: string): string[] {
  const urls: string[] = [];
  const regex = /\[FETCH:(https?:\/\/[^\]]+?)\]/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const url = m[1].trim();
    if (url) urls.push(url);
  }
  return urls;
}

/** 解析规划文本里的 <<MEM:key1,key2>> 标记，返回选中的记忆模式 key 列表 */
export function extractMemoryTriggers(text: string): string[] {
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
export function extractTodos(text: string): { id: string; content: string }[] {
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
export function extractClarify(text: string): { question: string; options: string[]; allowCustom: boolean } | null {
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

/** 解析规划阶段里 LLM 标记的技能触发：`<<SKILL:name>>` */
export function extractSkillTriggers(text: string): string[] {
  const names: string[] = [];
  const regex = /<<SKILL:([\w\-]+)>>/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const n = m[1].trim();
    if (n) names.push(n);
  }
  return names;
}

/** 解析回复里的 [MEMO:内容|A/B/C] 记忆沉淀标记 */
export function extractMemos(text: string): { content: string; category: 'A' | 'B' | 'C' }[] {
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