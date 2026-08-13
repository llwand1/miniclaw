import { LLMAdapter, ChatRequest, TokenChunk, ToolCall, ModelListRequest } from './types';
import { createLogger } from '../logger';
const log = createLogger('adapter:anthropic');

export class AnthropicAdapter implements LLMAdapter {
  type: 'anthropic' = 'anthropic';

  async *chat(req: ChatRequest): AsyncIterable<TokenChunk> {
    const baseUrl = req.baseUrl || 'https://api.anthropic.com/v1';
    const url = `${baseUrl}/messages`;

    const systemMsg = req.messages.find(m => m.role === 'system');
    const nonSystemMsgs = req.messages.filter(m => m.role !== 'system');

    const controller = new AbortController();
    // 外部中止信号（网关/用户「停止生成」）接管底层请求的取消：
    // 桥接 req.signal 的 abort 事件到内部 controller，用户点击停止时 fetch 立即中断。
    // 没有外部信号时退回内部兜底超时（120s，与网关 STREAM_TIMEOUT_MS 对齐），避免请求永久挂起。
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const onExternalAbort = () => controller.abort();
    if (req.signal) {
      if (req.signal.aborted) controller.abort();
      else req.signal.addEventListener('abort', onExternalAbort, { once: true });
    } else {
      fallback = setTimeout(() => controller.abort(), 120_000);
    }

    try {
      const body: Record<string, unknown> = {
        model: req.model,
        messages: nonSystemMsgs.map(m => {
          // 原生 tool 消息:assistant 带 tool_use 内容块 / tool 角色转成 user(tool_result)
          if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
            return {
              role: 'assistant',
              content: [
                ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
                ...m.toolCalls.map((tc: ToolCall) => ({
                  type: 'tool_use' as const,
                  id: tc.id,
                  name: tc.name,
                  input: safeParse(tc.arguments),
                })),
              ],
            };
          }
          if (m.role === 'tool') {
            return {
              role: 'user',
              content: [{ type: 'tool_result' as const, tool_use_id: m.toolCallId, content: m.content }],
            };
          }
          return { role: m.role, content: m.content };
        }),
        system: systemMsg?.content,
        temperature: req.temperature ?? 0.7,
        stream: true,
      };
      // 原生工具:仅当传入 tools 时带上(Anthropic 格式:name/description/input_schema)
      if (req.tools && req.tools.length > 0) {
        body.tools = req.tools.map(t => ({
          name: t.function.name,
          description: t.function.description || '',
          input_schema: t.function.parameters || { type: 'object', properties: {} },
        }));
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': req.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${errText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      // 流式 tool_use 累积:content_block_start(定义 id/name)+ input_json_delta(累积 arguments)
      const toolAccum = new Map<number, { id: string; name: string; arguments: string }>();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            yield { content: '', done: true };
            return;
          }
          try {
            const parsed = JSON.parse(data);
            // 文本增量(兼容带 type:text_delta 与不带 type 的两种网关)
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              yield { content: parsed.delta.text, done: false };
            }
            // tool_use 块开始:id + name
            if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
              const idx = typeof parsed.index === 'number' ? parsed.index : toolAccum.size;
              toolAccum.set(idx, {
                id: parsed.content_block.id || '',
                name: parsed.content_block.name || '',
                arguments: '',
              });
            }
            // tool_use 参数增量(JSON 片段累积)
            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'input_json_delta' && typeof parsed.delta.partial_json === 'string') {
              const idx = typeof parsed.index === 'number' ? parsed.index : toolAccum.size - 1;
              const cur = toolAccum.get(idx);
              if (cur) cur.arguments += parsed.delta.partial_json;
            }
            // 结束:stop_reason = tool_use → 产出完整 tool_calls
            if (parsed.type === 'message_delta' && parsed.delta?.stop_reason) {
              const chunk: TokenChunk = {
                content: '',
                done: true,
                finishReason: parsed.delta.stop_reason,
              };
              if (parsed.delta.stop_reason === 'tool_use' && toolAccum.size > 0) {
                const toolCalls: ToolCall[] = [...toolAccum.values()]
                  .filter(t => t.name)
                  .map(t => ({ id: t.id || `toolu_${Date.now().toString(36)}`, name: t.name, arguments: t.arguments || '{}' }));
                if (toolCalls.length > 0) chunk.toolCalls = toolCalls;
              }
              yield chunk;
              return;
            }
          } catch {
            log.warn({ data }, 'Failed to parse SSE chunk');
          }
        }
      }

      yield { content: '', done: true };
    } finally {
      if (fallback) clearTimeout(fallback);
      if (req.signal) req.signal.removeEventListener('abort', onExternalAbort);
    }
  }

  async listModels(_config?: ModelListRequest): Promise<string[]> {
    return ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'];
  }
}

/** 容错解析 tool arguments JSON(非法时返回空对象) */
function safeParse(s: string): Record<string, unknown> {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}
