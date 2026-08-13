// PreviewService —— 纯 Web 预览索引（无 Electron 依赖）。
//
// 职责：维护 AI 产出的 artifact 内存索引，供 /api/preview/* 与前端刷新回灌。
// 原 Electron 的 WebContentsView 原生预览已随 Electron 移除，预览渲染统一由前端
// iframe / 新标签页完成（PreviewPage 走 iframe，外部打开走 /api/preview/file/:id）。

import { Artifact } from '../shared/preview-types';
import { defaultConfig, PreviewConfig } from '../shared/config';

class PreviewService {
  /** 内存中的 artifact 索引（按 updatedAt 排序即时间线）。 */
  private artifacts = new Map<string, Artifact>();

  private cfg: PreviewConfig = defaultConfig.features.preview;

  /** 运行时覆盖功能配置（对接正式版配置系统）。 */
  setConfig(patch: Partial<PreviewConfig>): void {
    this.cfg = { ...this.cfg, ...patch };
  }

  getConfig(): PreviewConfig {
    return this.cfg;
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

  /** 局部更新 artifact（如用户在前端改了内容）。 */
  async patchArtifact(id: string, patch: Partial<Artifact>): Promise<void> {
    const cur = this.artifacts.get(id);
    if (!cur) return;
    const next: Artifact = { ...cur, ...patch, updatedAt: Date.now() };
    this.artifacts.set(id, next);
  }

  // ─── 兼容旧契约 ─────────────────────────────────────────────────
  /** 旧 /api/preview/html 直接推 HTML：包成临时 artifact 入索引。 */
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
    return id;
  }
}

export const previewService = new PreviewService();
