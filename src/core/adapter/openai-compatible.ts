import { LLMAdapter, ChatRequest, TokenChunk } from './types';
import { createLogger } from '../logger';
const log = createLogger('adapter:openai');

export class OpenAICompatibleAdapter implements LLMAdapter {
  type: 'openai' = 'openai';

  async *chat(req: ChatRequest): AsyncIterable<TokenChunk> {
    const baseUrl = req.baseUrl || 'https://api.openai.com/v1';
    const url = `${baseUrl}/chat/completions`;

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
      }),
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
          const delta = parsed.choices?.[0]?.delta?.content || '';
          const finishReason = parsed.choices?.[0]?.finish_reason || undefined;
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
            usage,
          };

          if (finishReason) return;
        } catch {
          log.warn({ data }, 'Failed to parse SSE chunk');
        }
      }
    }

    yield { content: '', done: true };
  }

  async listModels(): Promise<string[]> {
    try {
      const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
      const apiKey = process.env.OPENAI_API_KEY || '';
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
