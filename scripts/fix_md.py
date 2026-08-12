import io

p = "C:/Users/llwan/Desktop/MiniClaw/src/office-web/src/pages/ChatPage.tsx"
src = io.open(p, encoding="utf-8").read()

start_marker = "// 把正文按行拆块渲染"
end_marker = "// ─── 阶段进度指示"
start = src.index(start_marker)
end = src.index(end_marker)

# 用 @@ 代替反斜杠，避免任何转义问题；运行期替换为真正的反斜杠
RAW = '''// ─── 真正的流式 Markdown 渲染器（对标 WorkBuddy / ChatGPT 正文排版）────
// 把累积文本按「块」（标题/段落/代码块/列表/表格/引用）切分，每块稳定 key，
// 已渲染块内容不变则不重绘（dangerouslySetInnerHTML 浅比较），仅新增块淡入，
// 避免纯文本流「哑」感与重播闪烁。代码块做轻量语法高亮（零依赖，避免引入重型库）。
function escHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as Record<string, string>)[c]);
}
function hlCode(code: string): string {
  let h = escHtml(code);
  h = h.replace(/@@b(function|const|let|var|return|switch|case|break|import|export|type|interface|class|new|await|async|if|else|for|of|in|from|public|private|void|true|false|null|def|print|echo|require|module|func|fn)@@b/g, '<span class="mc-kw">$1</span>');
  h = h.replace(/@@b(string|number|boolean|Event|any|void|Promise|Array|object|int|float|bool|str|dict|list)@@b/g, '<span class="mc-ty">$1</span>');
  return h;
}
function inlineMd(s: string): string {
  return escHtml(s)
    .replace(/@@*@@*([^*]+)@@*@@*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
function parseMdBlocks(md: string): string[] {
  const lines = (md || '').split('@@n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push('<pre class="mc-pre"><code>' + hlCode(buf.join('@@n')) + '</code></pre>');
      continue;
    }
    if (/^@@|.*@@|@@s*$/.test(line) && i + 1 < lines.length && /^@@|[@@s:|-]+@@|@@s*$/.test(lines[i + 1])) {
      const head = line.split('|').slice(1, -1).map((c) => c.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^@@|.*@@|@@s*$/.test(lines[i])) {
        rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
        i++;
      }
      let t = '<table class="mc-tbl"><thead><tr>' + head.map((h) => '<th>' + inlineMd(h) + '</th>').join('') + '</tr></thead><tbody>';
      rows.forEach((r) => { t += '<tr>' + r.map((c) => '<td>' + inlineMd(c) + '</td>').join('') + '</tr>'; });
      t += '</tbody></table>';
      out.push(t);
      continue;
    }
    const hm = line.match(/^(#{1,3})@@s+(.*)/);
    if (hm) { const lv = (hm[1] || '#').length; out.push('<h' + lv + ' class="mc-h' + lv + '">' + inlineMd(hm[2] || '') + '</h' + lv + '>'); i++; continue; }
    if (/^>@@s?/.test(line)) { out.push('<blockquote class="mc-quote">' + inlineMd(line.replace(/^>@@s?/, '')) + '</blockquote>'); i++; continue; }
    if (/^@@s*[-*]@@s+/.test(line) || /^@@s*@@d+.@@s+/.test(line)) {
      const ordered = /^@@s*@@d+.@@s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (/^@@s*[-*]@@s+/.test(lines[i]) || /^@@s*@@d+.@@s+/.test(lines[i]))) {
        items.push('<li>' + inlineMd(lines[i].replace(/^@@s*(?:[-*]|@@d+.)@@s+/, '')) + '</li>');
        i++;
      }
      out.push('<' + (ordered ? 'ol' : 'ul') + ' class="mc-list">' + items.join('') + '</' + (ordered ? 'ol' : 'ul') + '>');
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' &&
      !/^(#{1,3}@@s|```|>|[@@s]*[-*]@@s|[@@s]*@@d+.@@s|@@|.*@@|@@s*$)/.test(lines[i])) {
      para.push(inlineMd(lines[i])); i++;
    }
    out.push('<p class="mc-p">' + para.join('<br>') + '</p>');
  }
  return out;
}

function MarkdownStream({ text, streaming }: { text: string; streaming: boolean }) {
  const blocks = parseMdBlocks(text);
  return (
    <div className="mc-md">
      {blocks.map((b, idx) => (
        <div key={idx} className="mc-md-block" dangerouslySetInnerHTML={{ __html: b }} />
      ))}
      {streaming && <span className="mc-caret" />}
    </div>
  );
}
'''

new_code = RAW.replace("@@", chr(92))
src = src[:start] + new_code + "\n" + src[end:]
io.open(p, "w", encoding="utf-8", newline="\n").write(src)
print("REPLACED OK; removed", end - start, "chars; inserted", len(new_code), "chars")
