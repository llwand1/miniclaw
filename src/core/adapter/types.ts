export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  /** assistant 消息可携带原生 tool_calls(openai 兼容) */
  toolCalls?: ToolCall[];
  /** tool 角色消息:对应 tool_call 的 id */
  toolCallId?: string;
}

/** 原生工具定义(OpenAI function calling 格式) */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>; // JSON Schema
  };
}

/** 模型发起的工具调用 */
export interface ToolCall {
  id: string;
  name: string;
  /** JSON 字符串参数 */
  arguments: string;
}

export interface ChatRequest {
  model: string;
  apiKey: string;
  baseUrl?: string;
  messages: ChatMessage[];
  temperature?: number;
  stream?: boolean;
  signal?: AbortSignal;
  /** 原生工具清单(OpenAI function calling / Anthropic tools) */
  tools?: ToolDefinition[];
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
  /** 流式累积的原生工具调用(增量 delta 合并后整段产出) */
  toolCalls?: ToolCall[];
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
