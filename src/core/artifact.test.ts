import { describe, it, expect } from 'vitest';
import { extractArtifacts, renderArtifactToHtml } from './artifact';

describe('core/artifact', () => {
  it('ART-01 ```html 围栏识别为 html artifact', () => {
    const text = '前文\n```html\n<h1>Hi</h1>\n```\n后文';
    const arts = extractArtifacts(text, 's1');
    expect(arts.length).toBe(1);
    expect(arts[0].kind).toBe('html');
    expect(arts[0].content).toBe('<h1>Hi</h1>');
    expect(arts[0].source).toBe('ai');
  });

  it('ART-01 markup/htm/svg 同属 html', () => {
    for (const lang of ['markup', 'htm', 'svg']) {
      const arts = extractArtifacts(`\`\`\`${lang}\n<div>x</div>\n\`\`\``, 's1');
      expect(arts[0].kind).toBe('html');
    }
  });

  it('ART-01 md/markdown 围栏识别为 markdown', () => {
    const arts = extractArtifacts('```md\n# Title\n```', 's1');
    expect(arts[0].kind).toBe('markdown');
  });

  it('ART-01 其它带语言标记 → code;无语言非 HTML 不产生', () => {
    const code = extractArtifacts('```ts\nconst a=1\n```', 's1');
    expect(code[0].kind).toBe('code');
    expect(code[0].lang).toBe('ts');
    // 无语言标记且不像 HTML → 不产生 artifact
    const plain = extractArtifacts('```\nno lang\n```', 's1');
    expect(plain.length).toBe(0);
  });

  it('ART-01 无语言标记但内容像 HTML(含 <html> 标签)→ html', () => {
    const arts = extractArtifacts('```\n<html><body>hi</body></html>\n```', 's1');
    expect(arts.length).toBe(1);
    expect(arts[0].kind).toBe('html');
  });

  it('ART-01 裸 <html>…</html> 文档兜底识别', () => {
    const arts = extractArtifacts('回复内容\n<!doctype html><html><head><title>T</title></head><body>ok</body></html>', 's1');
    expect(arts.some(a => a.kind === 'html')).toBe(true);
  });

  it('ART-02 相同内容幂等去重(hashId 稳定)', () => {
    const t = '```html\n<p>same</p>\n```';
    const a1 = extractArtifacts(t, 's1');
    const a2 = extractArtifacts(t, 's1');
    expect(a1[0].id).toBe(a2[0].id);
    // 不同会话 id 不同
    const a3 = extractArtifacts(t, 's2');
    expect(a1[0].id).not.toBe(a3[0].id);
  });

  it('ART-03 renderArtifactToHtml:html 原样返回(不含阅读器包装)', () => {
    const a = extractArtifacts('```html\n<h1>R</h1>\n```', 's1')[0];
    const html = renderArtifactToHtml(a);
    expect(html).toBe('<h1>R</h1>');
  });

  it('ART-03 markdown 渲染包阅读器 + 标题转 h1', () => {
    const a = extractArtifacts('```md\n# Hello\n\nworld\n```', 's1')[0];
    const html = renderArtifactToHtml(a);
    expect(html).toContain('<h1>Hello</h1>');
    expect(html).toContain('<p>world</p>');
  });

  it('ART-03 code 转义(< 不被当作标签)', () => {
    const a = extractArtifacts('```ts\nconst x = a < b\n```', 's1')[0];
    const html = renderArtifactToHtml(a);
    expect(html).toContain('a &lt; b');
    expect(html).not.toContain('<b\n');
  });

  it('title 提取:<title> 标签优先', () => {
    const a = extractArtifacts('```html\n<html><head><title>My App</title></head><body>x</body></html>\n```', 's1')[0];
    expect(a.title).toContain('My App');
  });
});
