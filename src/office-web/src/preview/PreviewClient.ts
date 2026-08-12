// PreviewClient —— 渲染进程侧的预览子系统 SDK。
//
// 职责：
// 1) 订阅主进程经 SSE 广播的 artifact 事件（/api/stream?sessionId=*），维护内存列表；
// 2) 把「打开 / 编辑 / 关闭 / 重载 / 布局 / 模式」等控制封装成对 /api/preview/* 的调用，
//    让页面代码（ChatPage / PreviewPanel / 悬浮窗）只面向这个 SDK，不直接 fetch。
//
// 与正式版对接：未来若预览服务改为远端 / 多窗口，只需改这里，页面零改动。
import type { Artifact, PreviewMode, PreviewLayout } from '../../../shared/preview-types';

export interface RunningTaskFront {
  sessionId: string;
  title: string;
  providerId: string;
  model: string;
  phase: 'thinking' | 'searching' | 'fetching' | 'writing' | 'done' | 'error';
  startedAt: number;
  chars: number;
  done?: boolean;
  error?: string;
}

type Listener = (artifacts: Artifact[]) => void;
type RunningListener = (task: { type: 'run-state'; sessionId: string; task?: RunningTaskFront; done?: boolean; error?: string; removed?: boolean }) => void;

async function post(url: string, body: unknown): Promise<void> {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    /* 预览是非关键路径，失败静默 */
  }
}

class PreviewClient {
  private artifacts: Artifact[] = [];
  private listeners = new Set<Listener>();
  private runningListeners = new Set<RunningListener>();
  private es: EventSource | null = null;

  /** 启动 SSE 订阅（应在 App 挂载时调用一次）。 */
  start(): void {
    if (this.es) return;
    this.list().catch(() => {});
    this.es = new EventSource('/api/stream?sessionId=*');
    this.es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d && d.type === 'artifact' && d.artifact) {
          this.upsert(d.artifact as Artifact);
        } else if (d && d.type === 'run-state') {
          this.notifyRunning(d as Parameters<RunningListener>[0]);
        }
      } catch {
        /* ignore malformed */
      }
    };
  }

  stop(): void {
    this.es?.close();
    this.es = null;
  }

  private upsert(a: Artifact): void {
    const idx = this.artifacts.findIndex((x) => x.id === a.id);
    if (idx >= 0) this.artifacts[idx] = a;
    else this.artifacts.unshift(a);
    this.notify();
  }

  private notify(): void {
    for (const l of this.listeners) l(this.artifacts);
  }

  /** 订阅 artifact 列表变化；立即回灌当前快照。返回取消订阅函数。 */
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.artifacts);
    return () => {
      this.listeners.delete(l);
    };
  }

  /** 订阅后台任务 run-state 事件。返回取消订阅函数。 */
  subscribeRunning(l: RunningListener): () => void {
    this.runningListeners.add(l);
    return () => {
      this.runningListeners.delete(l);
    };
  }

  private notifyRunning(d: Parameters<RunningListener>[0]): void {
    for (const l of this.runningListeners) l(d);
  }

  getArtifacts(): Artifact[] {
    return this.artifacts;
  }

  /** 首屏 / 刷新后从服务端拉取已存在的 artifact。 */
  async list(): Promise<void> {
    try {
      const r = await fetch('/api/preview/list');
      const d = await r.json();
      if (Array.isArray(d.artifacts)) {
        this.artifacts = d.artifacts;
        this.notify();
      }
    } catch {
      /* ignore */
    }
  }

  // ─── 控制契约（封装 /api/preview/*）───
  open(id: string): Promise<void> {
    return post('/api/preview/open', { id });
  }
  update(id: string, patch: Partial<Artifact>): Promise<void> {
    return post('/api/preview/update', { id, ...patch });
  }
  close(id: string): Promise<void> {
    return post('/api/preview/close', { id });
  }
  /** 从本地列表移除（关闭后调用，保持 UI 与服务端一致）。 */
  remove(id: string): void {
    this.artifacts = this.artifacts.filter((a) => a.id !== id);
    this.notify();
  }
  reload(id?: string): Promise<void> {
    return post('/api/preview/reload', { id });
  }
  setLayout(r: PreviewLayout): Promise<void> {
    return post('/api/preview/layout', r);
  }
  setMode(id: string, mode: PreviewMode): Promise<void> {
    return post('/api/preview/setMode', { id, mode });
  }
  /** 在系统浏览器中打开（走 /api/preview/file/:id，返回完整 HTML）。 */
  openExternal(id: string): void {
    window.open(`/api/preview/file/${encodeURIComponent(id)}`, '_blank');
  }
  /** 离开预览页：隐藏所有原生视图。 */
  hide(): Promise<void> {
    return post('/api/preview/hide', {});
  }
  /** 直接推一段 HTML，内部转成临时 artifact；推完后从服务端刷新列表。 */
  async pushHtml(html: string): Promise<void> {
    await post('/api/preview/html', { html });
    await this.list();
  }
}

export const previewClient = new PreviewClient();
