import { useState } from 'react';
import { parseQuiz, QuizCard } from '../QuizCard';
import { CODE_FOLD_LINES } from './chatStyles';

// ─── 真正的流式 Markdown 渲染器（对标 WorkBuddy / ChatGPT 正文排版）────
// 把累积文本按「块」（标题/段落/代码块/列表/表格/引用）切分，每块稳定 key，
// 已渲染块内容不变则不重绘（dangerouslySetInnerHTML 浅比较），仅新增块淡入，
// 避免纯文本流「哑」感与重播闪烁。代码块做轻量语法高亮（零依赖，避免引入重型库）。
function escHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as Record<string, string>)[c]);
}
export function hlCode(code: string): string {
  let h = escHtml(code);
  h = h.replace(/\b(function|const|let|var|return|switch|case|break|import|export|type|interface|class|new|await|async|if|else|for|of|in|from|public|private|void|true|false|null|def|print|echo|require|module|func|fn)\b/g, '<span class="mc-kw">$1</span>');
  h = h.replace(/\b(string|number|boolean|Event|any|void|Promise|Array|object|int|float|bool|str|dict|list)\b/g, '<span class="mc-ty">$1</span>');
  return h;
}
function inlineMd(s: string): string {
  return escHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
function parseMdBlocks(md: string): string[] {
  const lines = (md || '').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push('<pre class="mc-pre"><code>' + hlCode(buf.join('\n')) + '</code></pre>');
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = line.split('|').slice(1, -1).map((c) => c.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
        i++;
      }
      let t = '<table class="mc-tbl"><thead><tr>' + head.map((h) => '<th>' + inlineMd(h) + '</th>').join('') + '</tr></thead><tbody>';
      rows.forEach((r) => { t += '<tr>' + r.map((c) => '<td>' + inlineMd(c) + '</td>').join('') + '</tr>'; });
      t += '</tbody></table>';
      out.push(t);
      continue;
    }
    const hm = line.match(/^(#{1,3})\s+(.*)/);
    if (hm) { const lv = (hm[1] || '#').length; out.push('<h' + lv + ' class="mc-h' + lv + '">' + inlineMd(hm[2] || '') + '</h' + lv + '>'); i++; continue; }
    if (/^>\s?/.test(line)) { out.push('<blockquote class="mc-quote">' + inlineMd(line.replace(/^>\s?/, '')) + '</blockquote>'); i++; continue; }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+.\s+/.test(line)) {
      const ordered = /^\s*\d+.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+.\s+/.test(lines[i]))) {
        items.push('<li>' + inlineMd(lines[i].replace(/^\s*(?:[-*]|\d+.)\s+/, '')) + '</li>');
        i++;
      }
      out.push('<' + (ordered ? 'ol' : 'ul') + ' class="mc-list">' + items.join('') + '</' + (ordered ? 'ol' : 'ul') + '>');
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' &&
      !/^(#{1,3}\s|```|>|[\s]*[-*]\s|[\s]*\d+.\s|\|.*\|\s*$)/.test(lines[i])) {
      para.push(inlineMd(lines[i])); i++;
    }
    out.push('<p class="mc-p">' + para.join('<br>') + '</p>');
  }
  return out;
}

// 可折叠代码块：超长代码默认收起，显示「N 行 · 点击展开」，展开后保留语法高亮
export function CodeFoldingBlock({ html, streaming }: { html: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const lineCount = (html.match(/\n/g) || []).length + 1;
  const isLong = lineCount > CODE_FOLD_LINES;
  if (!isLong) {
    return <div className="mc-md-block" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return (
    <div style={{ margin: '6px 0', borderRadius: 12, border: '1px solid var(--mc-hair)', overflow: 'hidden', background: 'var(--mc-seg)' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 12px', border: 'none', background: 'transparent', color: 'var(--mc-muted)', cursor: 'pointer', fontSize: 12, fontWeight: 500, textAlign: 'left' }}>
        <span style={{ display: 'inline-flex', color: 'var(--mc-accent)', transition: 'transform .15s', transform: open ? 'rotate(90deg)' : 'none' }}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </span>
        <span style={{ flex: 1 }}>{open ? '收起代码块' : `代码块 ${lineCount} 行（点击展开）`}</span>
        {streaming && <span className="mc-caret" />}
      </button>
      {open && <div className="mc-md-block" style={{ borderTop: '1px solid var(--mc-hair)' }} dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  );
}

export function MarkdownStream({ text, streaming }: { text: string; streaming: boolean }) {
  const blocks = parseMdBlocks(text);
  return (
    <div className="mc-md">
      {blocks.map((b, idx) => {
        if (b.startsWith('<pre class="mc-pre">')) {
          return <CodeFoldingBlock key={idx} html={b} streaming={streaming} />;
        }
        return <div key={idx} className="mc-md-block" dangerouslySetInnerHTML={{ __html: b }} />;
      })}
      {streaming && <span className="mc-caret" />}
    </div>
  );
}

/** 助手消息正文：优先渲染选择题卡片（[QUIZ] 解析成功时），否则走 Markdown */
export function AssistantBody({ text, streaming }: { text: string; streaming: boolean }) {
  const quiz = parseQuiz(text);
  if (quiz) return <QuizCard data={quiz} streaming={streaming} />;
  return <MarkdownStream text={text} streaming={streaming} />;
}
