import { describe, it, expect, vi } from 'vitest';
import {
  trimMarkers,
  extractFsTools,
  extractSearchQueries,
  extractUrls,
  extractMemoryTriggers,
  extractTodos,
  createTodoTracker,
  extractClarify,
  extractSkillTriggers,
  extractMemos,
} from './parsers';

describe('parsers/trimMarkers', () => {
  it('清除全部规划/工具标记,保留正文', () => {
    const input = [
      '先搜索一下',
      '[SEARCH:天气]',
      '[FETCH:https://example.com/a]',
      '[TODO:第一步]',
      '<<MEM:profile,recent>>',
      '<<SKILL:quiz-generator>>',
      '最终回答正文',
      '[FS]{"action":"read","path":"a.ts"}[/FS]',
    ].join('\n');
    const out = trimMarkers(input);
    expect(out).toContain('先搜索一下');
    expect(out).toContain('最终回答正文');
    expect(out).not.toContain('[SEARCH:');
    expect(out).not.toContain('[FETCH:');
    expect(out).not.toContain('[TODO:');
    expect(out).not.toContain('<<MEM:');
    expect(out).not.toContain('<<SKILL:');
    expect(out).not.toContain('[FS]');
    expect(out).not.toContain('[/FS]');
  });

  it('容错:漏写闭合 [/FS] 时删到文本末尾,不残留工具标记', () => {
    const out = trimMarkers('正文\n[FS]{"action":"read","path":"x.ts"}');
    expect(out).toBe('正文');
  });

  it('容错:[ASK:{json}] 多行对象也能清除', () => {
    const out = trimMarkers('正文\n[ASK:{"question":"q","options":["a"]}]');
    expect(out).toBe('正文');
  });
});

describe('parsers/extractFsTools', () => {
  it('解析单块 JSONL 文件工具调用', () => {
    const text = '规划\n[FS]\n{"action":"read","path":"src/a.ts"}\n{"action":"write","path":"b.ts","content":"x"}\n[/FS]';
    const calls = extractFsTools(text);
    expect(calls).toHaveLength(2);
    expect(calls[0].action).toBe('read');
    expect(calls[0].path).toBe('src/a.ts');
    expect(calls[1].action).toBe('write');
    expect(calls[1].content).toBe('x');
  });

  it('容错:漏写闭合 [/FS] 也能解析;非 JSON 行忽略', () => {
    const text = '[FS]\n{"action":"grep","path":"a","pattern":"x"}\n这是说明文字\n';
    const calls = extractFsTools(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].action).toBe('grep');
  });

  it('无工具块返回空数组', () => {
    expect(extractFsTools('直接回答')).toEqual([]);
  });
});

describe('parsers/extractSearchQueries', () => {
  it('解析多个 [SEARCH:] 并 trim', () => {
    expect(extractSearchQueries('[SEARCH:天气] [SEARCH:  油价  ]')).toEqual(['天气', '油价']);
  });
  it('无标记返回空数组', () => {
    expect(extractSearchQueries('直接回答')).toEqual([]);
  });
});

describe('parsers/extractUrls', () => {
  it('解析 http/https [FETCH:]', () => {
    expect(extractUrls('[FETCH:https://a.com/x][FETCH:http://b.cn]')).toEqual(['https://a.com/x', 'http://b.cn']);
  });
  it('非 URL 或缺失返回空', () => {
    expect(extractUrls('[FETCH:not-a-url]')).toEqual([]);
    expect(extractUrls('直接回答')).toEqual([]);
  });
});

describe('parsers/extractMemoryTriggers', () => {
  it('解析逗号分隔模式并去重、小写化', () => {
    expect(extractMemoryTriggers('<<MEM:profile,recent,PROFILE>>')).toEqual(['profile', 'recent']);
  });
  it('无标记返回空', () => {
    expect(extractMemoryTriggers('直接回答')).toEqual([]);
  });
});

describe('parsers/extractTodos', () => {
  it('按序解析 [TODO:],生成带 id 条目', () => {
    const todos = extractTodos('[TODO:第一步] [TODO:第二步]');
    expect(todos).toHaveLength(2);
    expect(todos[0].content).toBe('第一步');
    expect(todos[1].content).toBe('第二步');
    expect(typeof todos[0].id).toBe('string');
    expect(todos[0].id.length).toBeGreaterThan(0);
  });
});

describe('parsers/createTodoTracker', () => {
  it('空清单返回 null(调用方直接跳过)', () => {
    expect(createTodoTracker(vi.fn(), 's1', [])).toBeNull();
  });

  it('complete() 逐个打勾并广播状态', () => {
    const emit = vi.fn();
    const tracker = createTodoTracker(emit, 's1', [
      { id: '1', content: '查资料' },
      { id: '2', content: '写答案' },
    ])!;
    expect(tracker).not.toBeNull();
    // 创建不广播,首次 emit() 下发初始快照
    expect(emit).not.toHaveBeenCalled();
    tracker.emit();
    expect(emit).toHaveBeenCalledTimes(1);

    expect(tracker.todos[0].status).toBe('running');
    tracker.complete();
    expect(tracker.todos[0].status).toBe('done');
    expect(tracker.todos[1].status).toBe('running');
    expect(emit).toHaveBeenCalledTimes(2);

    tracker.finishAll();
    expect(tracker.todos.every((t) => t.status === 'done')).toBe(true);
    expect(emit).toHaveBeenCalledTimes(3);
  });

  it('stop() 标记当前项为 stopped', () => {
    const emit = vi.fn();
    const tracker = createTodoTracker(emit, 's1', [{ id: '1', content: 'x' }])!;
    tracker.stop();
    expect(tracker.todos[0].status).toBe('stopped');
  });

  it('广播载荷携带 sessionId 与全量快照', () => {
    const emit = vi.fn();
    const tracker = createTodoTracker(emit, 'sess-9', [{ id: '1', content: 'x' }])!;
    tracker.emit(); // 手动触发广播
    const payload = emit.mock.calls[0][1];
    expect(payload.sessionId).toBe('sess-9');
    expect(Array.isArray(payload.todos)).toBe(true);
  });
});

describe('parsers/extractClarify', () => {
  it('解析 [ASK:{json}] 返回问题/选项/自定义开关', () => {
    const c = extractClarify('[ASK:{"question":"选哪个?","options":["A","B"],"allowCustom":false}]');
    expect(c).not.toBeNull();
    expect(c!.question).toBe('选哪个?');
    expect(c!.options).toEqual(['A', 'B']);
    expect(c!.allowCustom).toBe(false);
  });

  it('allowCustom 缺省为 true;非法 JSON 返回 null', () => {
    const c = extractClarify('[ASK:{"question":"q","options":["a"]}]');
    expect(c!.allowCustom).toBe(true);
    expect(extractClarify('[ASK:not-json]')).toBeNull();
    expect(extractClarify('无标记')).toBeNull();
  });
});

describe('parsers/extractSkillTriggers', () => {
  it('解析 <<SKILL:name>>', () => {
    expect(extractSkillTriggers('<<SKILL:quiz-generator>> 和 <<SKILL:doc-writer>>')).toEqual([
      'quiz-generator',
      'doc-writer',
    ]);
  });
});

describe('parsers/extractMemos', () => {
  it('解析每行 [MEMO:内容|类别],仅接受 A/B/C', () => {
    const memos = extractMemos(
      ['[MEMO:喜欢做题|A]', '[MEMO:近一周学数学|B]', '[MEMO:任务经验|C]', '[MEMO:非法类别|D]', '普通行'].join('\n'),
    );
    expect(memos).toHaveLength(3);
    expect(memos[0]).toEqual({ content: '喜欢做题', category: 'A' });
    expect(memos[1].category).toBe('B');
    expect(memos[2].category).toBe('C');
  });
});
