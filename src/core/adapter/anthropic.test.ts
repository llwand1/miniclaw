import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnthropicAdapter } from './anthropic';
import { ChatRequest } from './types';

function sseResponse(chunks: string[]): Response {
  const body = chunks.join('\n') + '\n';
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  }), { status: 200 });
}

function makeReq(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: 'claude-3-haiku-20240307',
    apiKey: 'sk-ant-test',
    baseUrl: 'https://api.anthropic.com/v1',
    messages: [
      { role: 'system', content: '你是助手' },
      { role: 'user', content: 'hi' },
    ],
    ...overrides,
  };
}

async function collect(gen: AsyncIterable<any>): Promise<any[]> {
  const out: any[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

describe('adapter/anthropic', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('ADP-05 content_block_delta 文本流式解析', async () => {
    const resp = sseResponse([
      'data: {"type":"content_block_delta","delta":{"text":"你好"}}',
      'data: {"type":"content_block_delta","delta":{"text":"世界"}}',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
      'data: [DONE]',
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp));

    const adapter = new AnthropicAdapter();
    const chunks = await collect(adapter.chat(makeReq()));
    expect(chunks.map(c => c.content).join('')).toBe('你好世界');
    expect(chunks.some(c => c.done && c.finishReason === 'end_turn')).toBe(true);
  });

  it('ADP-05 请求体:system 拆分、messages 去 system', async () => {
    const resp = sseResponse(['data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}', 'data: [DONE]']);
    const fetchMock = vi.fn().mockResolvedValue(resp);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new AnthropicAdapter();
    await collect(adapter.chat(makeReq()));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(init.body);
    expect(body.system).toBe('你是助手');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(init.headers['x-api-key']).toBe('sk-ant-test');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('ADP-04 abort 信号桥接:外部 abort 不抛未处理异常', async () => {
    const controller = new AbortController();
    const resp = sseResponse(['data: {"type":"content_block_delta","delta":{"text":"a"}}']);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp));

    const adapter = new AnthropicAdapter();
    const it = adapter.chat(makeReq({ signal: controller.signal }))[Symbol.asyncIterator]();
    const first = await it.next();
    expect(first.value.content).toBe('a');
    controller.abort();
  });

  it('ADP-06 原生 tool_use:content_block_start + input_json_delta 合并为 ToolCall', async () => {
    const resp = sseResponse([
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_01","name":"search_web","input":{}}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"queries\\":"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"[\\"苹果\\"]}"}}',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
      'data: [DONE]',
    ]);
    const fetchMock = vi.fn().mockResolvedValue(resp);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new AnthropicAdapter();
    const chunks = await collect(adapter.chat(makeReq({
      tools: [{
        type: 'function',
        function: { name: 'search_web', description: '联网搜索', parameters: { type: 'object', properties: {} } },
      }],
    })));

    // 请求体 tools 转 Anthropic 格式(name/input_schema)
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe('search_web');
    expect(body.tools[0].input_schema).toBeTruthy();

    const tc = chunks.find(c => c.toolCalls);
    expect(tc?.toolCalls).toHaveLength(1);
    expect(tc?.toolCalls![0].id).toBe('toolu_01');
    expect(tc?.toolCalls![0].name).toBe('search_web');
    expect(JSON.parse(tc!.toolCalls![0].arguments)).toEqual({ queries: ['苹果'] });
    expect(tc?.finishReason).toBe('tool_use');
  });

  it('ADP-07 tool 角色消息转 user(tool_result) 回灌格式', async () => {
    const resp = sseResponse(['data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}', 'data: [DONE]']);
    const fetchMock = vi.fn().mockResolvedValue(resp);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new AnthropicAdapter();
    await collect(adapter.chat(makeReq({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'toolu_01', name: 'search_web', arguments: '{"queries":["a"]}' }] },
        { role: 'tool', toolCallId: 'toolu_01', content: '搜索结果' },
      ],
    })));

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    const last = body.messages[body.messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.content[0].type).toBe('tool_result');
    expect(last.content[0].tool_use_id).toBe('toolu_01');
    expect(last.content[0].content).toBe('搜索结果');
  });

  it('非 200 响应抛 Anthropic API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })));
    const adapter = new AnthropicAdapter();
    await expect(collect(adapter.chat(makeReq()))).rejects.toThrow(/Anthropic API error 401/);
  });
});
