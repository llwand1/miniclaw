// artifact 适配器层 —— 把 AI 自由文本「识别 / 包装」成结构化 Artifact。
// 这是 AI→预览 闭环里唯一负责「理解 AI 输出格式」的地方，方便以后换提示词或解析规则时只改这里。
import { Artifact, ArtifactKind } from '../shared/preview-types';

// 代码围栏正则：匹配 ```lang\n...\n```（lang 可选）。
const FENCE = /```(\w+)?\s*\n([\s\S]*?)```/gi;

// 稳定内容指纹：同一份内容每次提取得到相同 id，供流式去重（避免每个 token 都新建 artifact）。
function hashId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return 'a' + (h >>> 0).toString(16).padStart(8, '0');
}

// 裸 HTML 文档（无围栏）识别：<!doctype html>…</html> 或 <html>…</html>
const HTML_DOC = /<!doctype\s+html[\s\S]*?<\/html>|<html[\s\S]*?<\/html>/i;
// 无语言标记、但内容像 HTML 的判断
const LOOKS_HTML = /^\s*<!doctype\s+html|<html[\s\S]*<\/html>/i;

/**
 * 从 AI 回复文本中提取结构化 artifact。
 * 约定：```html / markup / htm → html；```md / markdown → markdown；
 * 其它带语言标记的 ```lang → code。无语言标记的代码块不产生 artifact。
 */
/**
 * 从 AI 回复文本中提取结构化 artifact。
 * 约定：```html / markup / htm / svg → html；```md / markdown → markdown；
 * 其它带语言标记的 ```lang → code；**无语言标记但内容像 HTML 也按 html 处理**；
 * 若整段文本里没有任何围栏 html，但包含裸 <html>…</html> 文档，也识别成一个 html artifact。
 */
export function extractArtifacts(text: string, sessionId: string): Artifact[] {
  const artifacts: Artifact[] = [];
  const now = Date.now();
  let m: RegExpExecArray | null;
  FENCE.lastIndex = 0;
  while ((m = FENCE.exec(text)) !== null) {
    const lang = (m[1] || '').toLowerCase();
    const body = m[2].replace(/\s+$/, '');
    if (!body.trim()) continue;

    let kind: ArtifactKind | null = null;
    if (lang === 'html' || lang === 'markup' || lang === 'htm' || lang === 'svg') kind = 'html';
    else if (lang === 'md' || lang === 'markdown') kind = 'markdown';
    else if (lang) kind = 'code';
    else if (LOOKS_HTML.test(body)) kind = 'html';
    if (!kind) continue;

    const id = hashId(sessionId + ':' + kind + ':' + body.length + ':' + body);
    artifacts.push({
      id,
      sessionId,
      kind,
      title: titleFor(kind, lang, body),
      source: 'ai',
      content: body,
      lang: kind === 'code' ? lang : undefined,
      createdAt: now,
      updatedAt: now,
    });
  }

  // 兜底：没有任何围栏 html 时，尝试从整段文本识别裸 HTML 文档
  if (!artifacts.some((a) => a.kind === 'html')) {
    const doc = text.match(HTML_DOC);
    if (doc) {
      const body = doc[0];
      const id = hashId(sessionId + ':html:' + body.length + ':' + body);
      artifacts.push({
        id,
        sessionId,
        kind: 'html',
        title: titleFor('html', 'html', body),
        source: 'ai',
        content: body,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  return artifacts;
}

function titleFor(kind: ArtifactKind, lang: string, body: string): string {
  const t = body.match(/<title>([\s\S]*?)<\/title>/i);
  if (t && t[1].trim()) return t[1].trim().slice(0, 40);
  const firstLine = body.split('\n').find((l) => l.trim()) || '';
  const tag = kind === 'html' ? 'HTML' : kind === 'markdown' ? 'Markdown' : lang.toUpperCase();
  return `${tag} · ${firstLine.trim().slice(0, 28)}`;
}

/**
 * 把任意 artifact 渲染成可加载的完整 HTML 文档。
 * - html：原样返回（信任本地 AI/用户产物）。
 * - markdown / code：包一层极简阅读器（正式版可换 marked / 高亮库）。
 */
export function renderArtifactToHtml(a: Artifact): string {
  switch (a.kind) {
    case 'html':
      return a.content;
    case 'markdown':
      return wrapReader(mdToHtml(a.content));
    case 'code':
      return wrapReader(`<pre><code>${escapeHtml(a.content)}</code></pre>`);
    default:
      return wrapReader(`<div>不支持的 artifact 类型：${a.kind}</div>`);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 极简 markdown → HTML（标题 / 段落 / 行内代码块）。够用即可，正式版再升级。
function mdToHtml(md: string): string {
  const out: string[] = [];
  let inCode = false;
  for (const line of md.split('\n')) {
    if (/^```/.test(line)) {
      out.push(inCode ? '</code></pre>' : '<pre><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(escapeHtml(line));
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const n = h[1].length;
      out.push(`<h${n}>${escapeHtml(h[2])}</h${n}>`);
      continue;
    }
    if (line.trim() === '') continue;
    out.push(`<p>${escapeHtml(line)}</p>`);
  }
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}

function wrapReader(body: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8" />
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 760px; margin: 0 auto; padding: 24px; color: #1f2937; line-height: 1.7; }
  pre { background: #0f172a; color: #e2e8f0; padding: 14px; border-radius: 10px; overflow: auto; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  h1, h2, h3, h4 { line-height: 1.3; }
  a { color: #2563eb; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}
