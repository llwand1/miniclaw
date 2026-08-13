import { LLMAdapter, ChatRequest, TokenChunk, ToolCall, ModelListRequest } from './types';
import { createLogger } from '../logger';
const log = createLogger('adapter:openai');

export class OpenAICompatibleAdapter implements LLMAdapter {
  type: 'openai' = 'openai';

  async *chat(req: ChatRequest): AsyncIterable<TokenChunk> {
    const baseUrl = req.baseUrl || 'https://api.openai.com/v1';
    const url = `${baseUrl}/chat/completions`;

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
        messages: req.messages,
        temperature: req.temperature ?? 0.7,
        stream: true,
        // 要求流式返回 usage（OpenAI 兼容服务商默认不返回，需显式开启），
        // 这样 Trace 瀑布的 LLM span 才能展示真实 prompt/completion tokens。
        stream_options: { include_usage: true },
      };
      // 原生 function calling:仅当调用方传入 tools 时带上(未传则走纯文本标记路径)
      if (req.tools && req.tools.length > 0) {
        body.tools = req.tools;
        body.tool_choice = 'auto';
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${req.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${errText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      // 流式 tool_calls 累积:OpenAI 按 index 分片下发 id/name/arguments
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
            const choice = parsed.choices?.[0];
            const deltaObj = choice?.delta || {};
            const delta = deltaObj.content || '';
            // 兼容多种推理字段名：DeepSeek-R1(reasoning_content)、部分网关(reasoning)、
            // Claude thinking 经 OpenAI 兼容层(thinking)、以及 reasoning_details.content 等。
            const reasoning =
              deltaObj.reasoning_content ||
              deltaObj.reasoning ||
              deltaObj.thinking ||
              (deltaObj.reasoning_details && deltaObj.reasoning_details.content) ||
              '';
            const finishReason = choice?.finish_reason || undefined;
            const usage = parsed.usage
              ? {
                  promptTokens: parsed.usage.prompt_tokens || 0,
                  completionTokens: parsed.usage.completion_tokens || 0,
                }
              : undefined;

            // 原生 tool_calls 增量:合并同一 index 的 id/name/arguments 片段
            if (Array.isArray(deltaObj.tool_calls)) {
              for (const tc of deltaObj.tool_calls) {
                const idx = typeof tc.index === 'number' ? tc.index : toolAccum.size;
                const cur = toolAccum.get(idx) || { id: '', name: '', arguments: '' };
                if (tc.id) cur.id = tc.id;
                if (tc.function?.name) cur.name = tc.function.name;
                if (tc.function?.arguments) cur.arguments += tc.function.arguments;
                toolAccum.set(idx, cur);
              }
            }

            const chunk: TokenChunk = {
              content: delta,
              done: !!finishReason,
              finishReason,
              reasoning,
              usage,
            };

            // 本轮结束且存在 tool_calls:一次性产出完整工具调用列表(供 gateway tool loop)
            if (finishReason && toolAccum.size > 0) {
              const toolCalls: ToolCall[] = [...toolAccum.values()]
                .filter(t => t.name)
                .map(t => ({ id: t.id || `call_${toolAccum.size}_${Math.random().toString(36).slice(2, 8)}`, name: t.name, arguments: t.arguments || '{}' }));
              if (toolCalls.length > 0) chunk.toolCalls = toolCalls;
            }

            yield chunk;

            if (finishReason) return;
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

  async listModels(config?: ModelListRequest): Promise<string[]> {
    try {
      const baseUrl = config?.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
      const apiKey = config?.apiKey || process.env.OPENAI_API_KEY || '';
      const response = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) return [];
      const modelsRes = await response.json() as { data?: { id: string }[] };
      return (modelsRes.data || []).map((m) => m.id);
    } catch {
      return [];
    }
  }
}
