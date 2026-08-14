// previewRender.ts —— 预览渲染纯函数（FileView / PreviewPage 共用）。
// 从 PreviewPage 抽出：mdToHtml / escHtml / foldLongContent / renderArtifactHtml。
// 纯函数无 React 依赖，可被 vite 与 tsc 同时编译。

import type { Artifact } from '../../../../shared/preview-types';

/** 渲染输入的文档形状：兼容 Artifact 与 FileView 的本地变更对象。 */
export interface RenderableDoc {
  kind: string;
  content: string;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 行内语法：`code`、**粗体**、*斜体*、[链接](url)
function inlineMd(s: string): string {
  return escHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

// 真正的 Markdown → HTML（块级：标题/代码块/表格/列表/引用/段落；行内走 inlineMd）
function mdToHtml(md: string): string {
  const lines = (md || '').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // 代码块
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push('<pre><code>' + escHtml(buf.join('\n')) + '</code></pre>');
      continue;
    }
    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const n = h[1].length;
      out.push(`<h${n}>${inlineMd(h[2])}</h${n}>`);
      i++;
      continue;
    }
    // 引用
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(inlineMd(lines[i].replace(/^>\s?/, ''))); i++; }
      out.push('<blockquote>' + buf.join('<br>') + '</blockquote>');
      continue;
    }
    // 表格
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = line.split('|').slice(1, -1).map(c => c.trim());
      i += 2;
      const rows: string[] = ['<table><thead><tr>' + head.map(c => `<th>${inlineMd(c)}</th>`).join('') + '</tr></thead><tbody>'];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].split('|').slice(1, -1).map(c => c.trim());
        rows.push('<tr>' + cells.map(c => `<td>${inlineMd(c)}</td>`).join('') + '</tr>');
        i++;
      }
      rows.push('</tbody></table>');
      out.push(rows.join(''));
      continue;
    }
    // 列表（无序/有序）
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) {
        items.push('<li>' + inlineMd(lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, '')) + '</li>');
        i++;
      }
      out.push('<' + (ordered ? 'ol' : 'ul') + '>' + items.join('') + '</' + (ordered ? 'ol' : 'ul') + '>');
      continue;
    }
    // 空行
    if (line.trim() === '') { i++; continue; }
    // 段落
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' &&
      !/^(#{1,6}\s|```|>|[\s]*[-*]\s|[\s]*\d+\.\s|\|.*\|\s*$)/.test(lines[i])) {
      para.push(inlineMd(lines[i])); i++;
    }
    out.push('<p>' + para.join('<br>') + '</p>');
  }
  return out.join('\n');
}

// 大内容折叠：超过 foldLines 行时，前段正常渲染 + <details> 折叠剩余部分
function foldLongContent(content: string, render: (c: string) => string, foldLines: number): string {
  const lines = (content || '').split('\n');
  if (lines.length <= foldLines) return render(content);
  const head = lines.slice(0, foldLines).join('\n');
  const rest = lines.slice(foldLines).join('\n');
  return render(head) + `
<details class="fold">
  <summary>已省略 ${lines.length - foldLines} 行 · 点击展开剩余内容</summary>
  <div class="fold-body">${render(rest)}</div>
</details>`;
}

/**
 * 把文档渲染成可在 iframe 中加载的完整 HTML 文档。
 * - html：原样返回（信任本地 AI/用户产物）。
 * - markdown：走完整的 Markdown → HTML 渲染（标题/列表/表格/代码块/引用/粗体斜体等）。
 * - 其余（code 等）：包一层代码阅读器。
 */
export function renderArtifactHtml(a: RenderableDoc): string {
  if (a.kind === 'html') return a.content;
  let body: string;
  if (a.kind === 'markdown') {
    body = foldLongContent(a.content, (c) => mdToHtml(c), 200);
  } else {
    body = foldLongContent(a.content, (c) => `<pre><code>${escHtml(c)}</code></pre>`, 200);
  }
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8" />
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 760px; margin: 0 auto; padding: 24px; color: #1f2937; line-height: 1.7; }
  pre { background: #0f172a; color: #e2e8f0; padding: 14px; border-radius: 10px; overflow: auto; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.2em 0 0.5em; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th, td { border: 1px solid #e5e7eb; padding: 6px 10px; text-align: left; font-size: 13px; }
  th { background: #f3f4f6; }
  blockquote { margin: 10px 0; padding: 4px 14px; border-left: 3px solid #d1d5db; color: #4b5563; background: #f9fafb; border-radius: 0 8px 8px 0; }
  ul, ol { padding-left: 24px; }
  a { color: #2563eb; }
  details.fold { margin: 10px 0; border: 1px solid #e5e7eb; border-radius: 8px; padding: 0; }
  details.fold summary { cursor: pointer; padding: 7px 12px; font-size: 12px; color: #2563eb; font-weight: 600; background: #f9fafb; border-radius: 8px; user-select: none; }
  details.fold[open] summary { border-bottom: 1px solid #e5e7eb; border-radius: 8px 8px 0 0; }
  details.fold .fold-body { padding: 10px 12px; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/** Artifact 是否可直接预览：html 原样 / markdown / code 渲染。image/url 由调用方单独处理。 */
export function isPreviewableKind(kind: Artifact['kind'] | string): boolean {
  return kind === 'html' || kind === 'markdown' || kind === 'code';
}
