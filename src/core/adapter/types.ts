export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatRequest {
  model: string;
  apiKey: string;
  baseUrl?: string;
  messages: ChatMessage[];
  temperature?: number;
  stream?: boolean;
  signal?: AbortSignal;
}

export interface TokenChunk {
  content: string;
  done: boolean;
  finishReason?: string;
  reasoning?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface ModelListRequest {
  baseUrl?: string;
  apiKey?: string;
}

export interface LLMAdapter {
  type: 'openai' | 'anthropic';
  chat(req: ChatRequest): AsyncIterable<TokenChunk>;
  listModels(config?: ModelListRequest): Promise<string[]>;
}
