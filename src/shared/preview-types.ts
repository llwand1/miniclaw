// 预览子系统共享类型 —— 服务端 / 渲染进程可复用。
// 纯类型 + 少量纯函数，可安全被 vite 与 tsc 同时编译。

/** artifact 的内容种类。 */
export type ArtifactKind = 'html' | 'markdown' | 'code' | 'image' | 'url';

/** 来源：AI 产出 / 用户编写 / 外部导入。 */
export type ArtifactSource = 'ai' | 'user' | 'import';

/** 预览模式：静态（落盘 file://）/ 开发（直连本地 dev server，HMR）。 */
export type PreviewMode = 'static' | 'dev';

/**
 * Artifact —— 预览子系统的最小内容单元。
 * 一条 AI 回复里可能产出 0..N 个 artifact（当前 MVP 只取 HTML 类）。
 */
export interface Artifact {
  id: string;
  sessionId: string;
  kind: ArtifactKind;
  title: string;
  source: ArtifactSource;
  /** html=HTML 源码；markdown=MD 文本；code=源码；image=dataURL；url=地址。 */
  content: string;
  /** code 类型时的语言提示（如 ts/react）。 */
  lang?: string;
  /** dev 模式下指向本地 dev server（如 http://localhost:5174）。 */
  devServerUrl?: string;
  createdAt: number;
  updatedAt: number;
}

/** 主进程经 SSE 推给渲染进程的 artifact 事件。 */
export interface ArtifactEvent {
  type: 'artifact';
  sessionId: string;
  artifact: Artifact;
}

/** 渲染进程上报给主进程的预览占位区矩形（窗口坐标，CSS 像素）。 */
export interface PreviewLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 预览 iframe 的 sandbox 属性 —— 按来源分级：
 * - 可信来源（本地 AI 产出 `ai` / 用户编写 `user`）：放开同源/表单/弹窗/模态，
 *   localStorage、同源 fetch、表单提交、window.open、alert 均可用，对齐 WorkBuddy 预览能力。
 * - 不可信来源（外部导入 `import`）：回退到仅 `allow-scripts`（不透明源），
 *   避免其与 studentbuddy 主程序同源后被恶意 HTML 读取 app 的 localStorage（OAuth/API key 等）。
 */
export function previewSandbox(source: ArtifactSource | undefined): string {
  return source === 'import'
    ? 'allow-scripts'
    : 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals';
}
