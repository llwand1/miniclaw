import { LLMAdapter, TokenChunk, ChatMessage, ToolDefinition } from '../adapter/types';
import { OpenAICompatibleAdapter } from '../adapter/openai-compatible';
import { AnthropicAdapter } from '../adapter/anthropic';
import { createLogger } from '../logger';
import { tracer } from '../trace/tracer';
const log = createLogger('agent');

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  providerId: string;
  model: string;
  systemPrompt: string;
  enabled: boolean;
}

export interface ProviderConfig {
  id: string;
  type: 'openai' | 'anthropic';
  name: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  enabled: boolean;
}

export class AgentEngine {
  private adapters = new Map<string, LLMAdapter>();

  constructor() {
    this.adapters.set('openai', new OpenAICompatibleAdapter());
    this.adapters.set('anthropic', new AnthropicAdapter());
  }

  async listModels(provider: ProviderConfig): Promise<string[]> {
    const adapter = this.adapters.get(provider.type);
    if (!adapter) return [];
    try {
      const list = await adapter.listModels({ baseUrl: provider.baseUrl, apiKey: provider.apiKey });
      const clean = (list || []).filter(Boolean);
      if (!clean.includes(provider.defaultModel)) clean.unshift(provider.defaultModel);
      return clean;
    } catch {
      return [provider.defaultModel];
    }
  }

  async *chat(
    provider: ProviderConfig,
    agent: AgentConfig,
    messages: ChatMessage[],
    temperature?: number,
    signal?: AbortSignal,
    tools?: ToolDefinition[],
  ): AsyncIterable<TokenChunk> {
    // 简易 Trace：把本次 LLM 调用作为当前 Trace 的子 Span（从 gateway 注入的上下文取）
    const trace = tracer.active();
    const span = trace?.startChild('llm.completion', 'llm', {
      model: agent.model || provider.defaultModel,
      provider: provider.type,
    });
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      const adapter = this.adapters.get(provider.type);
      if (!adapter) {
        throw new Error(`Unsupported provider type: ${provider.type}`);
      }

      const fullMessages: ChatMessage[] = [];
      if (agent.systemPrompt) {
        fullMessages.push({ role: 'system', content: agent.systemPrompt });
      }
      fullMessages.push(...messages);

      log.info(`Starting chat with ${provider.type}/${agent.model}`);

      const stream = adapter.chat({
        model: agent.model || provider.defaultModel,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        messages: fullMessages,
        stream: true,
        temperature,
        signal,
        tools,
      });

      for await (const chunk of stream) {
        if (chunk.usage) {
          promptTokens += chunk.usage.promptTokens || 0;
          completionTokens += chunk.usage.completionTokens || 0;
        }
        yield chunk;
      }

      log.info('Chat completed');
    } catch (e: any) {
      span?.setError(e?.message);
      throw e;
    } finally {
      span?.end({ promptTokens, completionTokens });
    }
  }
}
