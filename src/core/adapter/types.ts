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
}

export interface TokenChunk {
  content: string;
  done: boolean;
  finishReason?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface LLMAdapter {
  type: 'openai' | 'anthropic';
  chat(req: ChatRequest): AsyncIterable<TokenChunk>;
  listModels(): Promise<string[]>;
}
