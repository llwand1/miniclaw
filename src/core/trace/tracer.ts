import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { getDb } from '../gateway/db';
import { createLogger } from '../logger';

const log = createLogger('trace');

export type SpanKind = 'root' | 'llm' | 'tool' | 'db' | 'stream' | 'other';

export interface SpanData {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: SpanKind;
  startedAt: number;
  endedAt: number | null;
  status: 'ok' | 'error' | 'aborted';
  attrs: Record<string, any>;
}

export interface TracePayload {
  traceId: string;
  sessionId: string | null;
  rootName: string;
  startedAt: number;
  endedAt: number | null;
  status: 'ok' | 'error' | 'aborted';
  spans: SpanData[];
}

// 一次请求 = 一棵 Span 树。Span 记录起止时间、类型与属性（model/tokens/error…）。
class Span {
  public spanId = randomUUID();
  public startedAt = Date.now();
  public endedAt: number | null = null;
  public status: 'ok' | 'error' | 'aborted' = 'ok';
  public attrs: Record<string, any>;

  constructor(
    public trace: Trace,
    public parentSpanId: string | null,
    public name: string,
    public kind: SpanKind,
    attrs?: Record<string, any>,
  ) {
    this.attrs = attrs || {};
  }

  end(attrs?: Record<string, any>, status?: 'ok' | 'error'): void {
    if (this.endedAt != null) return; // 幂等：避免子 span 被重复结束
    this.endedAt = Date.now();
    if (attrs) this.attrs = { ...this.attrs, ...attrs };
    if (status) this.status = status;
    this.trace.notifySpanEnd(this);
    // 实时广播：每个 Span 结束 → 推增量事件，前端边收边画瀑布
    this.trace.emit('span', { phase: 'end', span: this.toData() });
  }

  setError(msg?: string): void {
    this.status = 'error';
    if (msg) this.attrs.error = msg;
  }

  toData(): SpanData {
    return {
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      kind: this.kind,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      status: this.status,
      attrs: this.attrs,
    };
  }
}

class Trace extends EventEmitter {
  public traceId = randomUUID();
  public startedAt = Date.now();
  public endedAt: number | null = null;
  public status: 'ok' | 'error' | 'aborted' = 'ok';
  public spans: Span[] = [];
  private root: Span;
  private current: Span | null = null;

  constructor(
    public sessionId: string | null,
    rootName: string,
    attrs?: Record<string, any>,
  ) {
    super();
    this.root = new Span(this, null, rootName, 'root', attrs);
    this.spans.push(this.root);
    this.current = this.root;
  }

  // 挂一个子 Span，自动挂到「当前未结束的 Span」之下，维持调用嵌套。
  startChild(name: string, kind: SpanKind = 'other', attrs?: Record<string, any>): Span {
    const parent = this.current?.spanId ?? this.root.spanId;
    const s = new Span(this, parent, name, kind, attrs);
    this.spans.push(s);
    this.current = s;
    // 实时广播：每个子 Span 开始 → 推增量事件
    this.emit('span', { phase: 'start', span: s.toData() });
    return s;
  }

  notifySpanEnd(span: Span): void {
    if (this.current === span) {
      this.current = span.parentSpanId
        ? this.spans.find((x) => x.spanId === span.parentSpanId) || this.root
        : this.root;
    }
  }

  setError(msg?: string): void {
    this.status = 'error';
    this.root.setError(msg);
  }

  /** 用户主动停止：Trace 标记为「已中止」（区别于出错），瀑布面据此显示「已停止」。 */
  setAborted(): void {
    this.status = 'aborted';
    this.root.status = 'aborted';
  }

  end(attrs?: Record<string, any>): void {
    if (this.endedAt != null) return;
    this.endedAt = Date.now();
    if (attrs) this.root.attrs = { ...this.root.attrs, ...attrs };
    this.root.end();
    // 兜底：结束任何未显式结束的子 Span，避免瀑布出现「无穷长」条
    for (const s of this.spans) if (s.endedAt == null) s.end();
    // 防御性重置 ALS：Node 22 的 exit() 必须带回调，这里用 enterWith(undefined)
    // 清空当前异步路径的 store（本请求结束后该 async 链不再有 tracer.active() 调用）。
    tracerAls.enterWith(undefined as unknown as Trace);
    persistTrace(this);
    // 请求结束：兜底结束的 Span 已通过 end() 广播，这里清理监听，避免泄漏
    this.removeAllListeners();
  }

  toPayload(): TracePayload {
    return {
      traceId: this.traceId,
      sessionId: this.sessionId,
      rootName: this.root.name,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      status: this.status,
      spans: this.spans.map((s) => s.toData()),
    };
  }
}

const tracerAls = new AsyncLocalStorage<Trace>();

class Tracer {
  // 开启一次 Trace 并把上下文注入 AsyncLocalStorage，
  // 这样下游（适配器里的 LLM 调用）无需层层传参即可挂子 Span。
  startTrace(sessionId: string | null, name: string, attrs?: Record<string, any>): Trace {
    const t = new Trace(sessionId, name, attrs);
    tracerAls.enterWith(t);
    return t;
  }

  active(): Trace | undefined {
    return tracerAls.getStore();
  }
}

export const tracer = new Tracer();

// ── 持久化：复用项目已有的 better-sqlite3，幂等写入 traces / spans ──
function persistTrace(trace: Trace): void {
  try {
    const db = getDb();
    const p = trace.toPayload();
    db.prepare(
      'INSERT OR REPLACE INTO traces (trace_id,session_id,root_name,started_at,ended_at,status) VALUES (?,?,?,?,?,?)',
    ).run(p.traceId, p.sessionId, p.rootName, p.startedAt, p.endedAt, p.status);

    const ins = db.prepare(
      'INSERT OR REPLACE INTO spans (span_id,trace_id,parent_span_id,name,kind,started_at,ended_at,status,attrs) VALUES (?,?,?,?,?,?,?,?,?)',
    );
    const tx = db.transaction((spans: SpanData[]) => {
      for (const s of spans) {
        ins.run(s.spanId, p.traceId, s.parentSpanId, s.name, s.kind, s.startedAt, s.endedAt, s.status, JSON.stringify(s.attrs || {}));
      }
    });
    tx(p.spans);
  } catch (e) {
    // 追踪写库失败绝不拖累主流程
    log.warn({ error: (e as Error).message }, 'persistTrace failed');
  }
}
