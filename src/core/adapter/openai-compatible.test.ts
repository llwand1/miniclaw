import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAICompatibleAdapter } from './openai-compatible';
import { ChatRequest } from './types';

// 构造一个 mock SSE 流响应体(逐行 data: JSON)
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
    model: 'gpt-4o-mini',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    messages: [{ role: 'user', content: 'hi' }],
    ...overrides,
  };
}

async function collect(gen: AsyncIterable<any>): Promise<any[]> {
  const out: any[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

describe('adapter/openai-compatible', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('ADP-01 SSE 流解析:逐片 yield token,最终 done', async () => {
    const resp = sseResponse([
      'data: {"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"content":"世界"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp));

    const adapter = new OpenAICompatibleAdapter();
    const chunks = await collect(adapter.chat(makeReq()));
    expect(chunks.map(c => c.content).join('')).toBe('你好世界');
    expect(chunks.some(c => c.done)).toBe(true);
  });

  it('ADP-02 reasoning 字段解析(兼容 reasoning_content/reasoning/thinking)', async () => {
    const resp = sseResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"思考中..."},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"content":"答案"},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp));

    const adapter = new OpenAICompatibleAdapter();
    const chunks = await collect(adapter.chat(makeReq()));
    const reasoning = chunks.map(c => c.reasoning || '').join('');
    expect(reasoning).toContain('思考中');
  });

  it('ADP-02 usage 字段透传(include_usage)', async () => {
    const resp = sseResponse([
      'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}',
      'data: [DONE]',
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp));

    const adapter = new OpenAICompatibleAdapter();
    const chunks = await collect(adapter.chat(makeReq()));
    const withUsage = chunks.find(c => c.usage);
    expect(withUsage?.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
  });

  it('ADP-03 脏数据容错:非法 JSON 行跳过不崩', async () => {
    const resp = sseResponse([
      'data: {broken json',
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp));

    const adapter = new OpenAICompatibleAdapter();
    const chunks = await collect(adapter.chat(makeReq()));
    expect(chunks.map(c => c.content).join('')).toBe('ok');
  });

  it('ADP-04 abort 信号桥接:外部 abort 中断流', async () => {
    const controller = new AbortController();
    const resp = sseResponse([
      'data: {"choices":[{"delta":{"content":"a"},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"content":"b"},"finish_reason":null}]}',
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp));

    const adapter = new OpenAICompatibleAdapter();
    const it = adapter.chat(makeReq({ signal: controller.signal }))[Symbol.asyncIterator]();
    const first = await it.next();
    expect(first.value.content).toBe('a');
    controller.abort(); // 触发内部 controller.abort,fetch 读流抛错/中断
    // 不抛未处理异常即可(迭代提前结束或抛 abort 错误都由上层 catch)
  });

  it('ADP-04 无外部信号时启用 120s 兜底超时定时器', async () => {
    const resp = sseResponse([
      'data: {"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp));
    const timerSpy = vi.spyOn(globalThis, 'setTimeout');

    const adapter = new OpenAICompatibleAdapter();
    await collect(adapter.chat(makeReq())); // 无 signal
    const call = timerSpy.mock.calls.find(c => c[1] === 120_000);
    expect(call).toBeTruthy();
    timerSpy.mockRestore();
  });

  it('ADP-06 原生 tool_calls:增量 delta 合并为完整 ToolCall(含 tools 参数透传)', async () => {
    const resp = sseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"search_web","arguments":""}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"queries\\":"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"[\\"苹果\\"]}"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
    ]);
    const fetchMock = vi.fn().mockResolvedValue(resp);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAICompatibleAdapter();
    const chunks = await collect(adapter.chat(makeReq({
      tools: [{
        type: 'function',
        function: {
          name: 'search_web',
          description: '联网搜索',
          parameters: { type: 'object', properties: { queries: { type: 'array', items: { type: 'string' } } } },
        },
      }],
    })));

    // 请求体带 tools + tool_choice
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].function.name).toBe('search_web');
    expect(body.tool_choice).toBe('auto');

    // 产出完整 toolCalls:arguments 为跨 delta 拼接的 JSON 字符串
    const tc = chunks.find(c => c.toolCalls);
    expect(tc?.toolCalls).toHaveLength(1);
    expect(tc?.toolCalls![0].id).toBe('call_abc');
    expect(tc?.toolCalls![0].name).toBe('search_web');
    expect(JSON.parse(tc!.toolCalls![0].arguments)).toEqual({ queries: ['苹果'] });
    expect(tc?.finishReason).toBe('tool_calls');
  });

  it('ADP-08 tool loop 回灌消息序列化:tool_call_id + assistant tool_calls 线上格式', async () => {
    const resp = sseResponse(['data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}', 'data: [DONE]']);
    const fetchMock = vi.fn().mockResolvedValue(resp);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAICompatibleAdapter();
    await collect(adapter.chat(makeReq({
      messages: [
        { role: 'user', content: '查天气' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'search_web', arguments: '{"queries":["天气"]}' }] },
        { role: 'tool', toolCallId: 'call_1', content: '晴,25°C' },
      ],
    })));

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    // assistant 消息:toolCalls 转为 OpenAI tool_calls 线上格式
    const assistant = body.messages[1];
    expect(assistant.role).toBe('assistant');
    expect(assistant.toolCalls).toBeUndefined();
    expect(assistant.tool_calls).toHaveLength(1);
    expect(assistant.tool_calls[0]).toEqual({
      id: 'call_1',
      type: 'function',
      function: { name: 'search_web', arguments: '{"queries":["天气"]}' },
    });
    // tool 消息:toolCallId 转为 tool_call_id
    const tool = body.messages[2];
    expect(tool.role).toBe('tool');
    expect(tool.tool_call_id).toBe('call_1');
    expect(tool.content).toBe('晴,25°C');
  });

  it('ADP-07 未传 tools 时不带 tools 参数(兼容纯文本标记路径)', async () => {
    const resp = sseResponse(['data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}', 'data: [DONE]']);
    const fetchMock = vi.fn().mockResolvedValue(resp);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAICompatibleAdapter();
    await collect(adapter.chat(makeReq()));
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.tools).toBeUndefined();
  });

  it('非 200 响应抛 OpenAI API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad key', { status: 401 })));
    const adapter = new OpenAICompatibleAdapter();
    await expect(collect(adapter.chat(makeReq()))).rejects.toThrow(/OpenAI API error 401/);
  });
});
