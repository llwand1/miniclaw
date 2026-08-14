import { useEffect, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';
import { previewClient } from '../preview/PreviewClient';
import type { Artifact } from '../../../shared/preview-types';
import { previewSandbox } from '../../../shared/preview-types';
import {
  IconRefresh, IconTrash, IconExternalLink, IconPlus, IconMonitor, IconCode, IconCopy, IconDownload,
} from '../components/Icons';
import { IconFileDoc, IconFiles, IconFolder } from '../components/chat/chatIcons';

// 去重守卫：避免反复切换 tab 时把同一份 initialHtml 重复 push 成多个 artifact
let lastPushedHtml: string | null = null;

const DEFAULT_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  body { font-family: system-ui, sans-serif; display: grid; place-items: center;
    height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0; }
  button { font-size: 16px; padding: 10px 18px; border: 0; border-radius: 10px;
    background: #3b82f6; color: #fff; cursor: pointer; }
  #n { font-size: 42px; font-weight: 700; margin: 12px; }
</style>
</head>
<body>
  <div style="text-align:center">
    <div id="n">0</div>
    <button onclick="document.getElementById('n').textContent = (+document.getElementById('n').textContent)+1">
      点我 +1（交互可测）
    </button>
  </div>
</body>
</html>`;

const btnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
  height: 30, padding: '0 10px', border: 'none', borderRadius: 7,
  background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', fontSize: 12,
  fontWeight: 500, transition: 'all 0.12s ease',
};
const btnHover = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.background = 'var(--bg-muted)';
  e.currentTarget.style.color = 'var(--text)';
  e.currentTarget.style.transform = 'translateY(-1px)';
  e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
};
const btnLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.background = 'transparent';
  e.currentTarget.style.color = 'var(--text-3)';
  e.currentTarget.style.transform = 'none';
  e.currentTarget.style.boxShadow = 'none';
};

// 把 artifact 渲染成可在 iframe 中加载的 HTML 文档。
// - html：原样返回（信任本地 AI/用户产物）。
// - markdown：走完整的 Markdown → HTML 渲染（标题/列表/表格/代码块/引用/粗体斜体等）。
// - code：包一层代码阅读器。
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

function renderPreview(a: Artifact): string {
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

export default function PreviewPage({ initialHtml }: { initialHtml?: string | null }) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const prevIds = useRef<Set<string>>(new Set());
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const debounceRef = useRef<number | null>(null);
  const lastActive = useRef<string | null>(null);

  // 右侧 iframe 实时渲染用的 HTML 快照 + 手动重载计数
  const [liveHtml, setLiveHtml] = useState<string>(DEFAULT_HTML);
  const [reloadKey, setReloadKey] = useState(0);

  const active = artifacts.find((a) => a.id === activeId) || null;

  // ─── 打开文件预览：从工作区文件树选择文件，读取内容推成 artifact 预览 ───
  const [fileOpen, setFileOpen] = useState(false);
  const [fsPath, setFsPath] = useState('.');
  const [fsNodes, setFsNodes] = useState<{ name: string; path: string; type: 'dir' | 'file'; size?: number }[]>([]);
  const [fsLoading, setFsLoading] = useState(false);
  const [fsError, setFsError] = useState('');
  const [fsBusy, setFsBusy] = useState(false);

  const parentPath = (p: string): string => {
    const i = p.lastIndexOf('/');
    return i > 0 ? p.slice(0, i) : '.';
  };
  const fmtSize = (n: number): string =>
    n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

  async function loadFsDir(rel: string) {
    setFsLoading(true); setFsError('');
    try {
      const r = await fetch('/api/fs/tree?path=' + encodeURIComponent(rel));
      const d = await r.json();
      if (!r.ok || !Array.isArray(d.nodes)) { setFsError(d.error || '无法读取目录（请先在设置中配置工作区）'); setFsNodes([]); return; }
      setFsPath(rel); setFsNodes(d.nodes);
    } catch { setFsError('读取目录失败'); setFsNodes([]); }
    finally { setFsLoading(false); }
  }

  async function openFsFile(node: { path: string; name: string; type: 'dir' | 'file' }) {
    if (node.type === 'dir') { loadFsDir(node.path); return; }
    if (fsBusy) return;
    setFsBusy(true); setFsError('');
    try {
      const r = await fetch('/api/fs/read?path=' + encodeURIComponent(node.path));
      const d = await r.json();
      if (!r.ok || typeof d.content !== 'string') { setFsError(d.error || '读取文件失败'); return; }
      if (d.binary) { setFsError('二进制文件无法预览，请用对话引用该文件'); return; }
      const ext = (node.name.split('.').pop() || '').toLowerCase();
      const base: Artifact = { id: 'file-' + Date.now(), sessionId: 'file', title: node.name, source: 'import', kind: 'code', content: d.content, createdAt: Date.now(), updatedAt: Date.now() };
      // 按扩展名决定预览形态：html 直接渲染 / markdown 渲染 / 其余按代码阅读器
      const html = (ext === 'html' || ext === 'htm')
        ? d.content
        : renderPreview(ext === 'md' || ext === 'markdown'
          ? { ...base, kind: 'markdown' }
          : { ...base, kind: 'code', lang: ext });
      await previewClient.pushHtml(html);
      setFileOpen(false);
    } catch (err: any) { setFsError(err.message || '打开文件失败'); }
    finally { setFsBusy(false); }
  }

  // 订阅 artifact 列表；新产出的 artifact 自动聚焦（AI→预览闭环）
  useEffect(() => {
    return previewClient.subscribe((list) => {
      setArtifacts(list);
      const ids = new Set(list.map((a) => a.id));
      const added = list.filter((a) => !prevIds.current.has(a.id));
      prevIds.current = ids;
      if (added.length > 0) setActiveId(added[added.length - 1].id);
      else if (activeIdRef.current && !ids.has(activeIdRef.current)) setActiveId(list[0]?.id ?? null);
    });
  }, []);

  // 来自 ChatPage「在预览中打开」：把传入的 HTML 推成一个临时 artifact（去重）
  useEffect(() => {
    if (initialHtml && initialHtml !== lastPushedHtml) {
      lastPushedHtml = initialHtml;
      previewClient.pushHtml(initialHtml);
    }
  }, [initialHtml]);

  // 初始化 CodeMirror（一次）
  useEffect(() => {
    if (!editorRef.current) return;
    const view = new EditorView({
      doc: active?.content ?? DEFAULT_HTML,
      extensions: [
        basicSetup,
        html(),
        oneDark,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            const text = u.state.doc.toString();
            if (debounceRef.current) window.clearTimeout(debounceRef.current);
            debounceRef.current = window.setTimeout(() => {
              const id = activeIdRef.current;
              if (id) {
                setLiveHtml(text);
                previewClient.update(id, { content: text });
              }
            }, 300);
          }
        }),
      ],
      parent: editorRef.current,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // active 变化 → 同步编辑器内容 + iframe 渲染快照（AI 新推送 / 切换 tab / 外部更新）
  useEffect(() => {
    if (!active || !viewRef.current) return;
    const cur = viewRef.current.state.doc.toString();
    setLiveHtml(renderPreview(active));
    if (active.id === lastActive.current) {
      if (cur !== active.content) {
        viewRef.current.dispatch({ changes: { from: 0, to: viewRef.current.state.doc.length, insert: active.content } });
      }
      return;
    }
    lastActive.current = active.id;
    viewRef.current.dispatch({ changes: { from: 0, to: viewRef.current.state.doc.length, insert: active.content ?? DEFAULT_HTML } });
  }, [active]);

  const reload = () => { setReloadKey((k) => k + 1); };
  const closeActive = () => {
    if (!activeId) return;
    const id = activeId;
    previewClient.remove(id);
    setActiveId(null);
  };
  const openExternal = () => { if (activeId) previewClient.openExternal(activeId); };
  const createNew = () => { previewClient.pushHtml(DEFAULT_HTML); };
  // 复制当前 artifact 的源码 / 渲染后 HTML
  const copyActive = async () => {
    if (!active) return;
    const text = active.kind === 'html' ? active.content : renderPreview(active);
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
  };
  // 下载当前 artifact（源码或渲染后的完整 HTML 文件）
  const downloadActive = () => {
    if (!active) return;
    const html = active.kind === 'html' ? active.content : renderPreview(active);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (active.title || active.id).replace(/[^\w\u4e00-\u9fa5.-]+/g, '_') + '.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部：artifact 多 tab + 操作 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 16px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)', minHeight: 42, flexWrap: 'wrap',
        transition: 'background 0.25s, border-color 0.25s',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <IconMonitor size={15} style={{ color: 'var(--accent)' }} />
          </div>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>实时预览</span>
          <span style={{ fontSize: 11, color: 'var(--text-4)' }}>AI 产出或你编写的网页，编辑即重载</span>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => { if (fileOpen) { setFileOpen(false); return; } setFileOpen(true); loadFsDir('.'); }} title="从工作区打开文件预览" style={{ ...btnStyle, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-2)' }} onMouseEnter={btnHover} onMouseLeave={btnLeave}>
          <IconFiles /><span>打开文件</span>
        </button>
        <button onClick={createNew} title="新建 HTML 预览" style={{ ...btnStyle, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-2)' }} onMouseEnter={btnHover} onMouseLeave={btnLeave}>
          <IconPlus size={14} /><span>新建</span>
        </button>
        <button onClick={reload} title="重新加载" style={btnStyle} onMouseEnter={btnHover} onMouseLeave={btnLeave}><IconRefresh size={14} /></button>
        <button onClick={copyActive} title="复制当前内容" disabled={!active} style={{ ...btnStyle, color: active ? 'var(--text-3)' : 'var(--text-5)', cursor: active ? 'pointer' : 'not-allowed' }} onMouseEnter={active ? btnHover : undefined} onMouseLeave={active ? btnLeave : undefined}><IconCopy size={14} /></button>
        <button onClick={downloadActive} title="下载为 HTML 文件" disabled={!active} style={{ ...btnStyle, color: active ? 'var(--text-3)' : 'var(--text-5)', cursor: active ? 'pointer' : 'not-allowed' }} onMouseEnter={active ? btnHover : undefined} onMouseLeave={active ? btnLeave : undefined}><IconDownload size={14} /></button>
        <button onClick={openExternal} title="在系统浏览器打开" style={btnStyle} onMouseEnter={btnHover} onMouseLeave={btnLeave}><IconExternalLink size={14} /></button>
        <button onClick={closeActive} title="关闭当前" disabled={!active} style={{ ...btnStyle, color: active ? 'var(--danger)' : 'var(--text-5)', cursor: active ? 'pointer' : 'not-allowed' }} onMouseEnter={active ? btnHover : undefined} onMouseLeave={active ? btnLeave : undefined}><IconTrash size={14} /></button>
        <span title="静态渲染：HTML 直接写入 iframe，编辑即重载" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-4)', padding: '3px 10px', border: '1px dashed var(--text-5)', borderRadius: 12, background: 'var(--bg-inset)' }}>
          <IconCode size={11} /> Static · iframe
        </span>
      </div>

      {/* 打开文件：工作区文件树选择器（点目录进入 / 点文件打开预览） */}
      {fileOpen && (
        <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-inset)', padding: '6px 12px 10px', maxHeight: 260, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-3)' }}>
            <span style={{ display: 'inline-flex', color: 'var(--accent)' }}><IconFiles /></span>
            <span style={{ fontWeight: 600, color: 'var(--text)', flexShrink: 0 }}>工作区文件</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left' }} title={fsPath}>{fsPath === '.' ? '（根目录）' : fsPath}</span>
            {fsPath !== '.' && (
              <button onClick={() => loadFsDir(parentPath(fsPath))} title="上级目录" style={{ ...btnStyle, border: '1px solid var(--border)', background: 'var(--bg-surface)', padding: '2px 8px', height: 24, fontSize: 11 }}>
                ↑ 上级
              </button>
            )}
            <button onClick={() => setFileOpen(false)} title="关闭" style={{ ...btnStyle, border: '1px solid var(--border)', background: 'var(--bg-surface)', padding: '2px 8px', height: 24, fontSize: 11, color: 'var(--danger)' }}>
              关闭
            </button>
          </div>
          <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {fsLoading && <div style={{ fontSize: 12, color: 'var(--text-4)', padding: '6px 4px' }}>加载中…</div>}
            {fsError && <div style={{ fontSize: 12, color: 'var(--danger)', padding: '6px 4px' }}>{fsError}</div>}
            {!fsLoading && !fsError && fsNodes.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-4)', padding: '6px 4px' }}>空目录</div>}
            {fsNodes.map((n) => (
              <button key={n.path} onClick={() => openFsFile(n)} disabled={fsBusy} title={n.path}
                className="mc-float"
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', border: 'none', borderRadius: 6,
                  background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', fontSize: 12.5, textAlign: 'left',
                  transition: 'background .12s, transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s', flexShrink: 0,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-muted)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                <span style={{ flexShrink: 0, color: n.type === 'dir' ? 'var(--accent)' : 'var(--text-4)', display: 'inline-flex' }}>{n.type === 'dir' ? <IconFolder /> : <IconFileDoc />}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
                {n.type === 'file' && n.size != null && <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--text-5)' }}>{fmtSize(n.size)}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* artifact 多 tab 条 */}
      {artifacts.length > 0 && (
        <div style={{ display: 'flex', gap: 3, padding: '5px 10px', borderBottom: '1px solid var(--border-light)', background: 'var(--bg-inset)', overflowX: 'auto', transition: 'background 0.25s, border-color 0.25s' }}>
          {artifacts.map((a) => (
            <button key={a.id} onClick={() => setActiveId(a.id)}
              title={a.title}
              className="mc-float"
              style={{
                maxWidth: 160, padding: '5px 12px', border: 'none', borderRadius: 7, cursor: 'pointer',
                fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                fontWeight: a.id === activeId ? 600 : 400,
                background: a.id === activeId ? 'var(--accent)' : 'transparent',
                color: a.id === activeId ? 'var(--accent-text)' : 'var(--text-3)',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (a.id !== activeId) e.currentTarget.style.background = 'var(--bg-muted)'; }}
              onMouseLeave={e => { if (a.id !== activeId) e.currentTarget.style.background = 'transparent'; }}>
              {a.title}
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div ref={editorRef} style={{ width: '42%', borderRight: '1px solid var(--border)', overflow: 'auto', height: '100%', background: 'var(--bg-inset)' }} />
        <div style={{ flex: 1, position: 'relative', background: 'var(--bg-surface)', transition: 'background 0.25s' }}>
          {active ? (
            <iframe
              key={reloadKey}
              title={active.title}
              sandbox={previewSandbox(active.source)}
              srcDoc={liveHtml}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', background: '#fff' }}
            />
          ) : (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text-4)', fontSize: 13 }}>
              <IconMonitor size={48} style={{ opacity: 0.25, color: 'var(--accent)' }} />
              <div style={{ fontWeight: 500 }}>还没有预览内容</div>
              <div style={{ fontSize: 12 }}>让 AI 生成一个网页，或点击右上角「新建」直接编写</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
