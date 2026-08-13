import { getDb } from './db';
import { getSelectedModel } from './providers';
import { buildSystemPrompt } from './prompts';

// 常见模型的上下文窗口（tokens）映射：context 用量 UI 的「真实上限」。
// 未知模型走 DEFAULT_CONTEXT_LIMIT 保守默认；命中按模型名精确或前缀匹配。
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // GPT 系列（OpenAI 兼容中转常见）
  'gpt-5.6': 200000, 'gpt-5.5': 200000, 'gpt-5.4': 200000, 'gpt-5.2': 200000, 'gpt-5.1': 200000, 'gpt-5': 200000,
  'gpt-4.1': 1047576, 'gpt-4o': 128000, 'gpt-4o-mini': 128000, 'gpt-4': 8192, 'gpt-3.5-turbo': 16385,
  // DeepSeek 系列
  'deepseek-v4': 65536, 'deepseek-v3.2': 65536, 'deepseek-r1': 65536, 'deepseek-chat': 65536, 'deepseek-reasoner': 65536,
  // 其他常见
  'agnes': 128000, 'claude': 200000, 'qwen': 131072, 'glm': 131072, 'kimi': 131072, 'gemini': 1048576,
};
const DEFAULT_CONTEXT_LIMIT = 65536; // 未知模型保守默认

/**
 * 本地 token 估算（兜底）：当服务商不在流式响应里返回 usage 时，
 * 用「CJK 字符按 1 token、其余按空白词 1 token」的粗略规则估算，
 * 保证 token 统计不会因缺 usage 而恒为 0。
 * 若服务商正常返回 usage，则上层用真实值，不会走到这里。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[㐀-䶿一-鿿豈-﫿]/g) || []).length;
  const nonCjk = text.replace(/[㐀-䶿一-鿿豈-﫿]/g, ' ');
  const words = nonCjk.trim() ? nonCjk.trim().split(/\s+/).length : 0;
  return cjk + words;
}

/** 当前模型上下文窗口上限（tokens）：按模型名映射，未知模型给保守默认值 */
export function getContextLimit(providerId?: string, model?: string): number {
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
export function estimateSessionContext(sessionId: string): { limit: number; used: number; sys: number; hist: number; tools: number; files: number; model: string } {
  const db = getDb();
  const msgs = db.prepare('SELECT role, content, tokens FROM messages WHERE session_id=? ORDER BY ts').all(sessionId) as any[];
  const selected = getSelectedModel();
  const providerId = selected?.providerId || '';
  const model = selected?.model || '';
  const limit = getContextLimit(providerId, model);
  const sys = estimateTokens(buildSystemPrompt(''));
  let hist = 0, tools = 0, files = 0;
  for (const m of msgs) {
    const content = m.content || '';
    const t = (m.tokens && m.tokens > 0) ? m.tokens : estimateTokens(content);
    if (/\[SEARCH:|\[FETCH:|\[FS\]|<<SKILL:|<<MEM:/.test(content)) tools += t;
    else if (/【文件内容|【grep|【编辑结果|【写入结果|【文件工具/.test(content)) files += t;
    else hist += t;
  }
  const used = sys + hist + tools + files;
  return { limit, used, sys, hist, tools, files, model };
}