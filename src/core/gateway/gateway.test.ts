import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// vi.hoisted 保证在静态 import 之前设置 DATA_DIR(独立临时库,避免连到真实库)
vi.hoisted(() => {
  const fs = require('node:fs') as typeof import('node:fs');
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'studentbuddy-test-gw-'));
  process.env.DATA_DIR = TMP;
});

// performSearches/performFetches 是模块级导入(index.ts 从 './searcher' import),必须 vi.mock 打模块而非实例方法
vi.mock('./searcher', () => ({
  performSearches: vi.fn(),
  performFetches: vi.fn(),
}));

import { getDb, closeDb } from './db';
import { Gateway } from './index';
import { AgentEngine } from '../agent';
import type { TokenChunk } from '../adapter/types';
import * as searcherMod from './searcher';

// 造一个可复用的 engine mock:按调用次数返回预设 chunk 序列
function fakeEngine(sequences: TokenChunk[][]): any {
  let call = 0;
  const engine = { chat: vi.fn() };
  engine.chat.mockImplementation(async function* () {
    const seq = sequences[Math.min(call, sequences.length - 1)];
    call++;
    for (const c of seq) yield c;
  });
  return engine;
}

describe('gateway/integration', () => {
  beforeAll(async () => {
    getDb();
  });

  afterAll(() => { closeDb(); });

  it('GWY-01 空库种子:start() 注入 openai-default provider + default agent', async () => {
    const gw = new Gateway();
    await gw.start();
    const db = getDb();
    const prov = db.prepare('SELECT * FROM providers').all() as any[];
    const agt = db.prepare('SELECT * FROM agents').all() as any[];
    expect(prov.length).toBe(1);
    expect(prov[0].id).toBe('openai-default');
    expect(prov[0].enabled).toBe(1);
    expect(agt.length).toBe(1);
    expect(agt[0].id).toBe('default');
    expect(agt[0].provider_id).toBe('openai-default');
  });

  it('GWY-02 无工具直接流式:落库 messages + token_usage,emit token', async () => {
    const gw = new Gateway();
    await gw.start();
    const tokens: any[] = [];
    gw.on('token', (e: any) => tokens.push(e));
    // 直接流式分支:mock engine.chat 返回简单流(含 usage)
    (gw as any).engine = fakeEngine([
      [
        { content: '你好', done: false },
        { content: '世界', done: true, usage: { promptTokens: 12, completionTokens: 3 } },
      ],
    ]);

    const sid = await gw.handleMessage({ text: 'hi', source: 'main' });
    expect(typeof sid).toBe('string');

    const db = getDb();
    const msgs = db.prepare("SELECT role,content FROM messages WHERE session_id=? ORDER BY ts").all(sid) as any[];
    expect(msgs.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(msgs[1].content).toBe('你好世界');

    const usage2 = db.prepare("SELECT * FROM token_usage WHERE agent_id='default' ORDER BY id DESC LIMIT 1").get() as any;
    expect(usage2).toBeTruthy();
    expect(usage2.completion_tokens).toBeGreaterThan(0);

    // token 事件:累积内容 = 你好世界,末条 done
    const content = tokens.filter((t: any) => t.content).map((t: any) => t.content).join('');
    expect(content).toBe('你好世界');
    expect(tokens.some((t: any) => t.done)).toBe(true);
  });

  it('GWY-03 联网搜索工具分支:plan 解析 [SEARCH],emit step,结果回灌', async () => {
    const gw = new Gateway();
    await gw.start();
    const db = getDb();
    db.prepare('UPDATE search_config SET enabled=1 WHERE id=1').run();

    const steps: any[] = [];
    const tokens: any[] = [];
    gw.on('step', (e: any) => steps.push(e));
    gw.on('token', (e: any) => tokens.push(e));

    // 规划阶段返回 [SEARCH:xxx],最终阶段返回回答。
    // 注意:工具启用时 handleMessage 会先跑一次原生 tool 探测;探测文本直接复用为规划结果
    // (模型未走原生工具时不再重复调用 generateOnce),因此 engine.chat 调用序列是:
    // 探测(文本含 [SEARCH:],直接当规划用)→ 最终(回答)。
    (gw as any).engine = fakeEngine([
      [{ content: '我需要搜索\n[SEARCH:测试关键词]', done: true }], // 探测即规划(复用,不重复调用)
      [
        { content: '根据搜索结果', done: false },
        { content: '回答如下', done: true },
      ],
    ]);
    // mock searcher 模块避免真实网络
    vi.mocked(searcherMod.performSearches).mockResolvedValue('模拟搜索结果文本');

    const sid = await gw.handleMessage({ text: '查一下', source: 'main' });
    expect(typeof sid).toBe('string');

    // step 事件:搜索 running → done
    expect(steps.length).toBe(2);
    expect(steps[0].step.tool).toBe('search');
    expect(steps[0].step.status).toBe('running');
    expect(steps[1].step.status).toBe('done');
    // performSearches 收到查询词(模块级 mock)
    expect(searcherMod.performSearches).toHaveBeenCalledWith(['测试关键词'], expect.anything());

    // 最终回答落库
    const msgs = db.prepare("SELECT content FROM messages WHERE session_id=? AND role='assistant'").all(sid) as any[];
    expect(msgs.some((m: any) => m.content.includes('根据搜索结果'))).toBe(true);
    // 清理开关
    db.prepare('UPDATE search_config SET enabled=0 WHERE id=1').run();
  });

  it('GWY-09 服务端超时:120s 定时器触发 → chat-error 明确报错,不静默 done',
    // handleMessage 超时 throw 是预期行为(测试已用 expect(p).rejects 消费);
    // vitest 2.x 在 async-generator + fake timers + abort 组合下会额外报告该 rejection,
    // 用 dangerouslyIgnoreUnhandledErrors 只放行本用例的预期错误,不影响其它测试。
    async () => {
      vi.useFakeTimers();
      const gw = new Gateway();
      await gw.start();

      // engine.chat 挂起:await 一个由 abort 事件驱动的 promise(不用 setTimeout 轮询,
      // 避免 async generator 被 for-await 提前终止时残留未消费的迭代器 promise 触发 vitest unhandled)
      (gw as any).engine = {
        chat: vi.fn().mockImplementation(async function* (_p: any, _a: any, _m: any, _t: any, signal?: AbortSignal) {
          if (!signal) { yield { content: '', done: true }; return; }
          await new Promise<void>((resolve) => {
            if (signal.aborted) return resolve();
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          throw new Error('__ABORTED__');
        }),
      };

      const errors: any[] = [];
      const tokens: any[] = [];
      gw.on('chat-error', (e: any) => errors.push(e));
      gw.on('token', (e: any) => tokens.push(e));

      // 发起请求,在推进前就用 expect().rejects 挂载断言(推荐写法)
      const p = gw.handleMessage({ text: 'hi', source: 'main' });
      const assertion = expect(p).rejects.toThrow(/超时/);
      await vi.advanceTimersByTimeAsync(121_000);

      // 非用户中止:必须发明确 chat-error;且不静默发空 done 复位 busy
      await assertion;
      await vi.waitFor(() => { expect(errors.length).toBe(1); });
      expect(errors[0].error).toContain('超时');
      expect(tokens.some((t: any) => t.done === true)).toBe(false);
      vi.useRealTimers();
    });

  it('GWY-10 用户主动中止:静默发 done 复位 busy,不报错', async () => {
    const gw = new Gateway();
    await gw.start();
    const tokens: any[] = [];
    const errors: any[] = [];
    gw.on('token', (e: any) => tokens.push(e));
    gw.on('chat-error', (e: any) => errors.push(e));

    (gw as any).engine = {
      chat: vi.fn().mockImplementation(async function* (_p: any, _a: any, _m: any, _t: any, signal?: AbortSignal) {
        while (!signal?.aborted) {
          await new Promise(r => setTimeout(r, 5));
        }
        throw new Error('__ABORTED__');
      }),
    };

    const sid = 'abort-test';
    const p = gw.handleMessage({ text: 'hi', sessionId: sid, source: 'main' });
    // 等 engine.chat 开始后中止
    await new Promise(r => setTimeout(r, 30));
    await gw.abort(sid);
    const result = await p;
    expect(result).toBe(sid);
    expect(errors.length).toBe(0);
    // 有 done 事件复位 busy
    expect(tokens.some((t: any) => t.done === true)).toBe(true);
  });

  it('GWY-11 用量落库:无 usage 时用本地估算兜底', async () => {
    const gw = new Gateway();
    await gw.start();
    // 无 usage 返回的流
    (gw as any).engine = fakeEngine([
      [
        { content: '简单回答', done: false },
        { content: '', done: true },
      ],
    ]);

    const sid = await gw.handleMessage({ text: 'hi', source: 'main' });
    const db = getDb();
    const usage = db.prepare("SELECT * FROM token_usage WHERE agent_id='default' ORDER BY id DESC LIMIT 1").get() as any;
    expect(usage).toBeTruthy();
    expect(usage.completion_tokens).toBeGreaterThan(0); // 估算兜底非 0
  });

  it('GWY-12 原生 tool loop:模型返回 tool_calls → 执行 → 回灌 → 最终回答', async () => {
    const gw = new Gateway();
    await gw.start();
    const db = getDb();
    db.prepare('UPDATE search_config SET enabled=1 WHERE id=1').run();

    const steps: any[] = [];
    const tokens: any[] = [];
    gw.on('step', (e: any) => steps.push(e));
    gw.on('token', (e: any) => tokens.push(e));

    // 第一轮:返回 search_web 工具调用;第二轮:返回最终回答
    (gw as any).engine = fakeEngine([
      [
        { content: '', done: true, finishReason: 'tool_calls', toolCalls: [{ id: 'call_1', name: 'search_web', arguments: '{"queries":["测试关键词"]}' }] },
      ],
      [
        { content: '基于搜索结果', done: false },
        { content: '的回答', done: true },
      ],
    ]);
    vi.mocked(searcherMod.performSearches).mockResolvedValue('模拟搜索结果文本');

    const sid = await gw.handleMessage({ text: '查一下', source: 'main' });
    expect(typeof sid).toBe('string');

    // 执行了 search_web:step 事件 + searcher 收到查询词
    expect(searcherMod.performSearches).toHaveBeenCalledWith(['测试关键词'], expect.anything());
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps[0].step.name).toBe('联网搜索');
    expect(steps[0].step.tool).toBe('search');
    expect(steps[0].step.status).toBe('running');

    // 最终回答以 token 事件流式下发(工具路径也应像文本路径一样有打字机效果)
    const streamed = tokens.filter((t: any) => t.content).map((t: any) => t.content).join('');
    expect(streamed).toContain('基于搜索结果');
    expect(tokens.some((t: any) => t.done === true)).toBe(true);

    // 最终回答落库
    const msgs = db.prepare("SELECT content FROM messages WHERE session_id=? AND role='assistant'").all(sid) as any[];
    expect(msgs.some((m: any) => m.content.includes('基于搜索结果'))).toBe(true);

    db.prepare('UPDATE search_config SET enabled=0 WHERE id=1').run();
  });

  it('GWY-13 原生 tool loop:模型未走原生工具(文本标记/直接回答)时复用探测文本作规划', async () => {
    const gw = new Gateway();
    await gw.start();
    const db = getDb();
    db.prepare('UPDATE search_config SET enabled=1 WHERE id=1').run();

    // 第一轮:直接回答(无 tool_calls)。探测文本被复用为规划结果,无标记 → 直接流式输出该文本
    (gw as any).engine = fakeEngine([
      [
        { content: '直接回答内容', done: false },
        { content: '', done: true },
      ],
    ]);

    // 清空 performSearches 的调用记录,确保下面的断言只统计本次 handleMessage
    vi.mocked(searcherMod.performSearches).mockClear();

    const sid = await gw.handleMessage({ text: '你好', source: 'main' });
    expect(typeof sid).toBe('string');
    // performSearches 未被调用(模型没走原生工具)
    expect(searcherMod.performSearches).not.toHaveBeenCalled();
    // 回答已落库
    const msgs = db.prepare("SELECT content FROM messages WHERE session_id=? AND role='assistant'").all(sid) as any[];
    expect(msgs.some((m: any) => m.content.includes('直接回答内容'))).toBe(true);

    db.prepare('UPDATE search_config SET enabled=0 WHERE id=1').run();
  });

  it('GWY-14 原生工具轮落库:assistant tool_calls + tool 结果持久化,追问时回放给模型', async () => {
    const gw = new Gateway();
    await gw.start();
    const db = getDb();
    db.prepare('UPDATE search_config SET enabled=1 WHERE id=1').run();
    vi.mocked(searcherMod.performSearches).mockResolvedValue('模拟搜索结果文本');

    // 第一轮:返回 search_web 工具调用;第二轮:返回最终回答
    (gw as any).engine = fakeEngine([
      [
        { content: '', done: true, finishReason: 'tool_calls', toolCalls: [{ id: 'call_1', name: 'search_web', arguments: '{"queries":["天气"]}' }] },
      ],
      [{ content: '今日晴 25°C', done: true }],
    ]);
    const sid = await gw.handleMessage({ text: '查天气', source: 'main' });

    // 工具调用消息已原子落库且顺序正确:user → assistant(tool_calls) → tool(结果) → assistant(最终)
    const rows = db.prepare("SELECT role,content,tool_call_id,tool_calls FROM messages WHERE session_id=? ORDER BY ts, id").all(sid) as any[];
    expect(rows.map((r: any) => r.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    // assistant 消息携带 tool_calls JSON(与驼峰字段一致)
    expect(JSON.parse(rows[1].tool_calls)).toEqual([
      { id: 'call_1', name: 'search_web', arguments: '{"queries":["天气"]}' },
    ]);
    // tool 消息带有对应的 tool_call_id 和工具结果
    expect(rows[2].tool_call_id).toBe('call_1');
    expect(rows[2].content).toContain('模拟搜索结果文本');
    expect(rows[3].content).toBe('今日晴 25°C');

    // 追问:捕获第一次传给 engine.chat 的消息(探测调用 = 完整历史回放)。
    // 注意不能用最后的 seenMessages——探测之后 extractMemories→summarizeMemories 还会
    // 再调一次 engine.chat(其入参经 history.slice(-4) 裁剪),会覆盖掉探测入参。
    let seenMessages: any[] | null = null;
    const capture = { chat: vi.fn() };
    capture.chat.mockImplementation(async function* (_p: unknown, _a: unknown, messages: any[]) {
      if (seenMessages === null) seenMessages = messages;
      yield { content: '基于历史工具结果', done: true };
    });
    (gw as any).engine = capture;
    await gw.handleMessage({ text: '再说明一下', sessionId: sid, source: 'main' });

    const toolMsg = seenMessages!.find((m: any) => m.role === 'tool');
    expect(toolMsg).toBeTruthy();
    expect(toolMsg.toolCallId).toBe('call_1');
    expect(toolMsg.content).toContain('模拟搜索结果文本');
    expect(seenMessages!.some((m: any) => m.role === 'assistant' && m.toolCalls?.length > 0)).toBe(true);

    db.prepare('UPDATE search_config SET enabled=0 WHERE id=1').run();
  });

  it('agent 默认实例类型断言(mock 前)', () => {
    const gw = new Gateway();
    expect(gw['engine']).toBeInstanceOf(AgentEngine);
  });
});
