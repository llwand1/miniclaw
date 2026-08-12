import { LLMAdapter, ChatRequest, TokenChunk, ModelListRequest } from './types';
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
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${req.apiKey}`,
        },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          temperature: req.temperature ?? 0.7,
          stream: true,
          // 要求流式返回 usage（OpenAI 兼容服务商默认不返回，需显式开启），
          // 这样 Trace 瀑布的 LLM span 才能展示真实 prompt/completion tokens。
          stream_options: { include_usage: true },
        }),
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

            yield {
              content: delta,
              done: !!finishReason,
              finishReason,
              reasoning,
              usage,
            };

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
