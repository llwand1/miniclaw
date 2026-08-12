import { LLMAdapter, ChatRequest, TokenChunk, ModelListRequest } from './types';
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
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': req.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: req.model,
          messages: nonSystemMsgs.map(m => ({ role: m.role, content: m.content })),
          system: systemMsg?.content,
          temperature: req.temperature ?? 0.7,
          stream: true,
        }),
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
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              yield { content: parsed.delta.text, done: false };
            }
            if (parsed.type === 'message_delta' && parsed.delta?.stop_reason) {
              yield {
                content: '',
                done: true,
                finishReason: parsed.delta.stop_reason,
              };
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
