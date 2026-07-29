import { LLMAdapter, TokenChunk, ChatMessage } from '../adapter/types';
import { OpenAICompatibleAdapter } from '../adapter/openai-compatible';
import { AnthropicAdapter } from '../adapter/anthropic';
import { createLogger } from '../logger';
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

  async *chat(
    provider: ProviderConfig,
    agent: AgentConfig,
    messages: ChatMessage[],
    temperature?: number,
  ): AsyncIterable<TokenChunk> {
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
    });

    for await (const chunk of stream) {
      yield chunk;
    }

    log.info('Chat completed');
  }
}
