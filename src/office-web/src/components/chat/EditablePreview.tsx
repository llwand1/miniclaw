// EditablePreview.tsx —— 可编辑预览工作台（FileView 复用）。
// 从 PreviewPage 抽取：左侧 CodeMirror 编辑器 + 右侧 iframe 实时渲染，编辑即重载。
// 与 PreviewPage 的区别：单 item 驱动（不管理全局 artifact 列表），由父级传入
// 待预览文档；支持编辑回写 onPatch（可空，为空时仅本地实时渲染，不回写）。
import { useEffect, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';
import { previewSandbox } from '../../../../shared/preview-types';
import type { ArtifactSource } from '../../../../shared/preview-types';
import { renderArtifactHtml } from './previewRender';
import {
  IconRefresh, IconCopy, IconDownload, IconTrash, IconCode, IconExternalLink,
} from '../Icons';

export interface EditablePreviewItem {
  id: string;
  kind: string;               // 'html' | 'markdown' | 'code' | 其它
  content: string;
  title?: string;
  source?: ArtifactSource;    // sandbox 分级用，缺省按可信处理
}

interface EditablePreviewProps {
  item: EditablePreviewItem | null;
  /** 编辑回写（可选）：为空时编辑仅实时渲染，不调用外部。 */
  onPatch?: (id: string, patch: { content: string }) => void;
  /** 关闭当前预览（可选）。 */
  onClose?: () => void;
  /** 外部打开（可选）：需要 artifact 级 id 时由父级传入。 */
  onOpenExternal?: (id: string) => void;
}

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
};
const btnLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.background = 'transparent';
  e.currentTarget.style.color = 'var(--text-3)';
};

export function EditablePreview({ item, onPatch, onClose, onOpenExternal }: EditablePreviewProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const debounceRef = useRef<number | null>(null);
  const lastItemId = useRef<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [liveHtml, setLiveHtml] = useState<string>(DEFAULT_HTML);

  // 初始化 CodeMirror（一次）：编辑 → 防抖 300ms → 实时 iframe + 可选回写
  useEffect(() => {
    if (!editorRef.current) return;
    const view = new EditorView({
      doc: item?.content ?? DEFAULT_HTML,
      extensions: [
        basicSetup,
        html(),
        oneDark,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            const text = u.state.doc.toString();
            if (debounceRef.current) window.clearTimeout(debounceRef.current);
            debounceRef.current = window.setTimeout(() => {
              setLiveHtml(renderArtifactHtml({ kind: item?.kind ?? 'html', content: text }));
              if (item?.id && onPatch) onPatch(item.id, { content: text });
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

  // item 变化 → 同步编辑器内容 + iframe 渲染快照
  useEffect(() => {
    if (!item || !viewRef.current) return;
    const cur = viewRef.current.state.doc.toString();
    setLiveHtml(renderArtifactHtml(item));
    if (item.id === lastItemId.current) {
      if (cur !== item.content) {
        viewRef.current.dispatch({ changes: { from: 0, to: viewRef.current.state.doc.length, insert: item.content } });
      }
      return;
    }
    lastItemId.current = item.id;
    viewRef.current.dispatch({ changes: { from: 0, to: viewRef.current.state.doc.length, insert: item.content ?? DEFAULT_HTML } });
  }, [item]);

  const reload = () => { setReloadKey((k) => k + 1); };
  const copyContent = async () => {
    if (!item) return;
    try { await navigator.clipboard.writeText(item.content); } catch { /* ignore */ }
  };
  const download = () => {
    if (!item) return;
    const htmlStr = item.kind === 'html' ? item.content : renderArtifactHtml(item);
    const blob = new Blob([htmlStr], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (item.title || item.id).replace(/[^\w\u4e00-\u9fa5.-]+/g, '_') + '.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (!item) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text-4)', fontSize: 13 }}>
        <IconCode size={40} style={{ opacity: 0.25 }} />
        <div style={{ fontWeight: 500 }}>还没有预览内容</div>
        <div style={{ fontSize: 12 }}>点击左侧文件开始预览</div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* 顶栏：标题 + 操作 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', borderBottom: '1px solid var(--mc-hair)',
        background: 'var(--mc-glass)', flexShrink: 0,
      }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title || '(无标题)'}</span>
        <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 6, background: 'var(--mc-seg)', color: 'var(--mc-muted)', flexShrink: 0 }}>{item.kind}</span>
        <button onClick={reload} title="重新加载" style={btnStyle} onMouseEnter={btnHover} onMouseLeave={btnLeave}><IconRefresh size={14} /></button>
        <button onClick={copyContent} title="复制当前内容" style={btnStyle} onMouseEnter={btnHover} onMouseLeave={btnLeave}><IconCopy size={14} /></button>
        <button onClick={download} title="下载为 HTML 文件" style={btnStyle} onMouseEnter={btnHover} onMouseLeave={btnLeave}><IconDownload size={14} /></button>
        {onOpenExternal && (
          <button onClick={() => onOpenExternal(item.id)} title="在系统浏览器打开" style={btnStyle} onMouseEnter={btnHover} onMouseLeave={btnLeave}><IconExternalLink size={14} /></button>
        )}
        {onClose && (
          <button onClick={onClose} title="关闭预览" style={{ ...btnStyle, color: 'var(--danger)' }} onMouseEnter={btnHover} onMouseLeave={btnLeave}><IconTrash size={14} /></button>
        )}
        <span title="静态渲染：HTML 直接写入 iframe，编辑即重载" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-4)', padding: '3px 10px', border: '1px dashed var(--text-5)', borderRadius: 12, background: 'var(--bg-inset)', flexShrink: 0 }}>
          <IconCode size={11} /> Static · iframe
        </span>
      </div>
      {/* 左编辑 + 右渲染 */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div ref={editorRef} style={{ width: '42%', borderRight: '1px solid var(--mc-hair)', overflow: 'auto', height: '100%', background: 'var(--mc-glass-strong)' }} />
        <div style={{ flex: 1, position: 'relative', background: 'var(--mc-bg)' }}>
          <iframe
            key={reloadKey}
            title={item.title || item.id}
            sandbox={previewSandbox(item.source)}
            srcDoc={liveHtml}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', background: '#fff' }}
          />
        </div>
      </div>
    </div>
  );
}
