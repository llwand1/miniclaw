import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import { createLogger } from '../logger';
import { SearchResponse, FetchedPage } from './types';

/**
 * Python 联网强化服务桥接层（子进程 + stdio JSON-RPC）。
 *
 * - 懒启动：首次调用时 spawn `python services/py-search/main.py`，常驻复用；
 * - 崩溃自动重启：进程异常退出后，下次调用自动拉起新进程；
 * - 超时保护：单个请求超时 reject，不阻塞对话主流程；
 * - 不可用时（无 python / 启动失败）抛错，由上层降级回 Node 直连实现。
 */
const log = createLogger('search:pybridge');

const PY_SEARCH_DIR = path.resolve(__dirname, '..', '..', '..', 'services', 'py-search');
const REQUEST_TIMEOUT = 25000;
const MAX_RESTARTS = 3;

interface PendingRequest {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class PythonSearchBridge {
  private proc: ChildProcess | null = null;
  private buffer = '';
  private pending = new Map<number, PendingRequest>();
  private seq = 0;
  private restarts = 0;
  private lastError: string | null = null;

  /** 桥接是否可用（进程已启动且未退出） */
  get available(): boolean {
    return this.proc !== null && this.proc.exitCode === null && !this.proc.killed;
  }

  /** 上次失败原因（供日志/诊断） */
  get error(): string | null {
    return this.lastError;
  }

  private ensureProc(): void {
    if (this.available) return;
    this.restarts += 1;
    if (this.restarts > MAX_RESTARTS) {
      this.lastError = `python 服务重启超过 ${MAX_RESTARTS} 次，已停用`;
      throw new Error(this.lastError);
    }
    this.buffer = '';
    this.proc = spawn('python', ['-u', path.join(PY_SEARCH_DIR, 'main.py')], {
      cwd: PY_SEARCH_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    // python 不存在 / 启动失败：记错并让 available 变 false，上层自动降级
    this.proc.on('error', (err) => {
      log.warn({ error: err.message }, 'py-search spawn error');
      this.lastError = `python 启动失败: ${err.message}`;
      this.rejectAll(new Error(this.lastError!));
      this.proc = null;
    });
    this.proc.stderr?.on('data', (d: Buffer) => {
      const s = d.toString();
      if (s.trim()) log.warn({ stderr: s.trim().slice(0, 500) }, 'py-search stderr');
    });
    this.proc.on('exit', (code, signal) => {
      log.warn({ code, signal }, 'py-search exited');
      this.rejectAll(new Error(`py-search 进程退出 code=${code} signal=${signal}`));
      this.proc = null;
    });
    this.proc.stdout?.on('data', (d: Buffer) => this.onData(d));
  }

  private onData(chunk: Buffer): void {
    // 进程成功启动并有输出:重置重启计数,避免「临时故障 → 计数累积 → 永久停用」。
    // restarts 只对 spawn 失败/启动即崩(无输出)累积,成功运行过的进程崩溃后可再次拉起。
    if (this.restarts > 0) {
      this.restarts = 0;
      this.lastError = null;
    }
    this.buffer += chunk.toString('utf-8');
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        const p = this.pending.get(msg.id);
        if (!p) continue;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.result);
      } catch (e: any) {
        log.warn({ line: line.slice(0, 200), error: e.message }, 'py-search bad JSON');
      }
    }
  }

  private rejectAll(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  /** 请求-响应：写一行 JSON 到 stdin，等待同 id 响应。超时 reject。 */
  private request<T = any>(method: string, params: Record<string, unknown>): Promise<T> {
    this.ensureProc();
    if (!this.proc?.stdin?.writable) {
      this.lastError = 'py-search stdin 不可写';
      return Promise.reject(new Error(this.lastError));
    }
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`py-search ${method} 超时(${REQUEST_TIMEOUT}ms)`));
      }, REQUEST_TIMEOUT);
      this.pending.set(id, { resolve, reject, timer });
      this.proc!.stdin!.write(JSON.stringify({ id, method, params }) + '\n', (e) => {
        if (e) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(e);
        }
      });
    });
  }

  /** 多引擎搜索。engines 省略时 Python 侧默认 bing+baidu+ddg。 */
  async search(query: string, engines?: string[]): Promise<SearchResponse> {
    const r = await this.request<any>('search', { query, engines });
    const results = Array.isArray(r?.results) ? r.results : [];
    return {
      results: results.map((x: any) => ({ title: x.title ?? '', url: x.url ?? '', snippet: x.snippet ?? '' })),
      source: r?.source ?? 'py-search',
    };
  }

  /** 抓取网页（Python 侧：playwright 可用则 JS 渲染，否则静态）。 */
  async fetch(url: string): Promise<FetchedPage> {
    const r = await this.request<any>('fetch', { url, use_js: true });
    return { url: r?.url ?? url, title: r?.title ?? url, text: r?.text ?? '' };
  }

  /** 显式关闭子进程（服务关闭时调用）。 */
  stop(): void {
    if (this.proc && this.proc.exitCode === null) {
      this.proc.kill();
    }
    this.proc = null;
    this.rejectAll(new Error('py-search stopped'));
  }
}

/** 全局单例，供 searchWeb/fetchPage 复用同一常驻进程。 */
export const pythonSearchBridge = new PythonSearchBridge();
