// PreviewService —— 主进程内的「实时预览」子系统（正式契约版）。
//
// 设计要点（对照 2026-07-30 确定的 Preview Subsystem 契约）：
// - 内容源是本地可信 HTML（AI 产出 / 用户编写），用 WebContentsView 以 file:// 加载，
//   安全顾虑远低于「加载任意不可信网页」。
// - 顶部只依赖 node 内置模块 + 本项目纯模块；electron 在首次需要时懒加载，
//   避免 web-only 开发服务器（无 Electron 运行时）import 即崩溃。
// - 多视图：每个 artifact 一个 WebContentsView（Map<id, ViewState>），支持多 tab 并发预览。
// - 内存索引：artifacts Map 保存结构化内容；static 模式落盘 <id>.html 后 loadFile，
//   dev 模式（预留）直连本地 dev server 享受 HMR。
// - 视图以绝对窗口坐标覆盖在 mainWindow 内容区，矩形由渲染进程按占位 div 的
//   getBoundingClientRect 上报（见前端 PreviewPanel）。

import path from 'node:path';
import fs from 'node:fs';
import { Artifact, PreviewMode, PreviewLayout } from '../shared/preview-types';
import { renderArtifactToHtml } from './artifact';
import { defaultConfig, PreviewConfig } from '../shared/config';

type WebContentsViewLike = any;
type BrowserWindowLike = any;

interface ViewState {
  artifactId: string;
  mode: PreviewMode;
  view: WebContentsViewLike;
  attached: boolean;
}

class PreviewService {
  private WebContentsViewCtor: any = null;
  private previewDir = '';
  private win: BrowserWindowLike = null;

  /** 内存中的 artifact 索引（按 updatedAt 排序即时间线）。 */
  private artifacts = new Map<string, Artifact>();
  /** 每个 artifact 对应一个原生预览视图。 */
  private views = new Map<string, ViewState>();

  private layout: PreviewLayout | null = null;
  private activeId: string | null = null;
  private cfg: PreviewConfig = defaultConfig.features.preview;

  /** 由主进程在窗口就绪后调用：注入 WebContentsView 构造器与落盘目录。 */
  init(deps: { WebContentsView: any; previewDir: string }): void {
    this.WebContentsViewCtor = deps.WebContentsView;
    this.previewDir = deps.previewDir;
    if (this.previewDir && !fs.existsSync(this.previewDir)) {
      fs.mkdirSync(this.previewDir, { recursive: true });
    }
  }

  /** 运行时覆盖功能配置（对接正式版配置系统）。 */
  setConfig(patch: Partial<PreviewConfig>): void {
    this.cfg = { ...this.cfg, ...patch };
  }

  getConfig(): PreviewConfig {
    return this.cfg;
  }

  /** 绑定主窗口（窗口重建时再次调用即可，旧视图随旧窗口失效需重建）。 */
  setWindow(win: BrowserWindowLike): void {
    this.win = win;
    if (win) this.views.clear();
  }

  // ─── artifact 索引 ───────────────────────────────────────────────
  listArtifacts(): Artifact[] {
    return [...this.artifacts.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getArtifact(id: string): Artifact | undefined {
    return this.artifacts.get(id);
  }

  /** 注册 / 更新一个 artifact（AI 产出或用户导入）。返回是否首次创建。 */
  upsertArtifact(a: Artifact): boolean {
    const existed = this.artifacts.has(a.id);
    this.artifacts.set(a.id, a);
    // 超出上限：丢弃最旧者
    if (this.artifacts.size > this.cfg.maxArtifacts) {
      const oldest = [...this.artifacts.values()].sort((x, y) => x.updatedAt - y.updatedAt)[0];
      if (oldest) this.artifacts.delete(oldest.id);
    }
    return !existed;
  }

  /** 局部更新 artifact（如用户在前端改了内容），并刷新已打开的视图。 */
  async patchArtifact(id: string, patch: Partial<Artifact>): Promise<void> {
    const cur = this.artifacts.get(id);
    if (!cur) return;
    const next: Artifact = { ...cur, ...patch, updatedAt: Date.now() };
    this.artifacts.set(id, next);
    if (this.views.has(id)) await this.update(id);
  }

  // ─── 视图管理 ───────────────────────────────────────────────────
  private filePath(id: string): string {
    return path.join(this.previewDir, `${id}.html`);
  }

  private ensureView(artifactId: string): ViewState | null {
    const existing = this.views.get(artifactId);
    if (existing) return existing;
    if (!this.WebContentsViewCtor) return null;
    const view = new this.WebContentsViewCtor({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    const state: ViewState = { artifactId, mode: 'static', view, attached: false };
    this.views.set(artifactId, state);
    return state;
  }

  /** 挂载视图到主窗口内容区；幂等，自动应用已缓存的 layout。 */
  private doAttach(state: ViewState): void {
    if (!this.win) return;
    if (!state.attached) {
      this.win.contentView.addChildView(state.view);
      state.attached = true;
    }
    if (this.layout) state.view.setBounds(this.layout);
  }

  private async render(state: ViewState, a: Artifact): Promise<void> {
    if (state.mode === 'dev' && a.devServerUrl) {
      // dev 模式：直连本地 dev server（HMR），正式版接入
      this.doAttach(state);
      await state.view.webContents.loadURL(a.devServerUrl);
      return;
    }
    // static 模式：落盘后 file:// 加载
    const file = this.filePath(a.id);
    fs.writeFileSync(file, renderArtifactToHtml(a), 'utf-8');
    this.doAttach(state);
    await state.view.webContents.loadFile(file);
  }

  /** 打开（或聚焦）某个 artifact 的原生预览视图并渲染最新内容。 */
  async open(id: string): Promise<void> {
    const a = this.artifacts.get(id);
    if (!a) throw new Error(`artifact not found: ${id}`);
    const state = this.ensureView(id);
    if (!state) return;
    await this.render(state, a);
    this.activeId = id;
    this.doAttach(state);
  }

  /** 刷新已打开视图（内容/模式变化后）。 */
  async update(id: string): Promise<void> {
    const a = this.artifacts.get(id);
    if (!a) return;
    const state = this.views.get(id);
    if (!state) return;
    await this.render(state, a);
  }

  reload(id?: string): void {
    const target = id || this.activeId;
    if (!target) return;
    const state = this.views.get(target);
    if (state) state.view.webContents.reload();
  }

  close(id: string): void {
    const state = this.views.get(id);
    if (!state) return;
    if (this.win && state.attached) this.win.contentView.removeChildView(state.view);
    try {
      state.view.webContents?.destroy?.();
    } catch {
      /* 视图可能已随窗口销毁 */
    }
    this.views.delete(id);
    if (this.activeId === id) this.activeId = null;
  }

  /** 渲染进程上报占位区矩形（窗口坐标，CSS 像素）。 */
  setLayout(layout: PreviewLayout): void {
    this.layout = layout;
    for (const state of this.views.values()) {
      if (state.attached) state.view.setBounds(layout);
    }
  }

  /** 预留 dev 模式：static ↔ dev 切换（dev 需 artifact 带 devServerUrl）。 */
  setMode(id: string, mode: PreviewMode): void {
    if (!this.cfg.modes.includes(mode)) return;
    const state = this.views.get(id) || this.ensureView(id);
    if (!state) return;
    state.mode = mode;
    const a = this.artifacts.get(id);
    if (a) this.render(state, a).catch(() => {});
  }

  getMode(id: string): PreviewMode {
    return this.views.get(id)?.mode ?? 'static';
  }

  /** 离开预览页：隐藏所有视图避免遮挡其它页面。 */
  hideAll(): void {
    if (!this.win) return;
    for (const state of this.views.values()) {
      if (state.attached) {
        this.win.contentView.removeChildView(state.view);
        state.attached = false;
      }
    }
  }

  // ─── 兼容旧契约 ─────────────────────────────────────────────────
  /** 旧 /api/preview/html 直接推 HTML：包成临时 artifact 再走统一管线。 */
  async pushHtml(html: string, sessionId = 'ad-hoc'): Promise<string> {
    const id = `adhoc-${Date.now()}`;
    const a: Artifact = {
      id,
      sessionId,
      kind: 'html',
      title: '实时 HTML',
      source: 'user',
      content: html,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.upsertArtifact(a);
    await this.open(id);
    return id;
  }

  /** 直接加载任意 URL（高级用法：dev server / 文档站点）。 */
  loadUrl(url: string, id = 'url'): void {
    const state = this.ensureView(id);
    if (!state) return;
    state.mode = 'dev';
    this.doAttach(state);
    state.view.webContents.loadURL(url);
    this.activeId = id;
  }
}

export const previewService = new PreviewService();
