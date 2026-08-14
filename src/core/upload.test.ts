import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// vi.hoisted 保证在静态 import 之前设置 DATA_DIR(独立临时目录,避免连到真实库/真实上传目录)
vi.hoisted(() => {
  const fs = require('node:fs') as typeof import('node:fs');
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'studentbuddy-test-up-'));
  process.env.DATA_DIR = TMP;
});

import { saveUpload, extractText, MAX_UPLOAD_BYTES, MAX_EXTRACT_CHARS, UPLOADS_DIR } from './upload';

describe('core/upload', () => {
  beforeAll(() => {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  });

  afterAll(() => {
    try { fs.rmSync(UPLOADS_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('上限常量:50MB 与 200k 字符', () => {
    expect(MAX_UPLOAD_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_EXTRACT_CHARS).toBe(200_000);
  });

  it('saveUpload: 保存 txt 并异步生成伴生 .txt(提取文本)', async () => {
    const buf = Buffer.from('这是一段学习笔记\n第二行', 'utf-8');
    const f = saveUpload(buf, '笔记.txt');
    expect(f.name).toBe('笔记.txt');
    expect(f.ext).toBe('txt');
    expect(f.size).toBe(buf.length);
    expect(fs.existsSync(f.storedPath)).toBe(true);

    // 异步提取:等待伴生 .txt 生成
    await new Promise((r) => setTimeout(r, 50));
    expect(f.textPath).toBeTruthy();
    expect(fs.existsSync(f.textPath!)).toBe(true);
    const text = fs.readFileSync(f.textPath!, 'utf-8');
    expect(text).toContain('这是一段学习笔记');
  });

  it('saveUpload: 黑名单扩展名(exe)直接抛错,不落盘', () => {
    expect(() => saveUpload(Buffer.from('MZ...'), '病毒.exe')).toThrow(/黑名单/);
    const files = fs.readdirSync(UPLOADS_DIR).filter((n) => n.endsWith('.exe'));
    expect(files).toHaveLength(0);
  });

  it('saveUpload: 无扩展名文件也允许(ext 为空串)', () => {
    const f = saveUpload(Buffer.from('abc'), 'README');
    expect(f.ext).toBe('');
    expect(fs.existsSync(f.storedPath)).toBe(true);
  });

  it('extractText: txt 纯文本读取;含 NUL 视为二进制不提取', async () => {
    const p = path.join(UPLOADS_DIR, 'plain.txt');
    fs.writeFileSync(p, '纯文本内容', 'utf-8');
    const t = await extractText(p, 'txt');
    expect(t).toBe('纯文本内容');

    const bin = path.join(UPLOADS_DIR, 'bin.txt');
    fs.writeFileSync(bin, Buffer.from([0x66, 0x00, 0x6f, 0x00]));
    const b = await extractText(bin, 'txt');
    expect(b).toBeUndefined();
  });

  it('extractText: 未知/不可提取扩展名返回 undefined,不抛错', async () => {
    const p = path.join(UPLOADS_DIR, 'x.png');
    fs.writeFileSync(p, Buffer.from([0x89, 0x50]));
    expect(await extractText(p, 'png')).toBeUndefined();
    // 文件不存在也返回 undefined(内部 catch)
    expect(await extractText(path.join(UPLOADS_DIR, 'missing.pdf'), 'pdf')).toBeUndefined();
  });

  it('extractText: pdf 提取(真实 pdf-parse),失败降级 undefined', async () => {
    // 最小合法 PDF:包含一行文本
    const minimalPdf = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
      '4 0 obj<</Length 44>>stream\nBT /F1 24 Tf 72 720 Td (Hello Studentbuddy) Tj ET\nendstream endobj\n' +
      '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\nxref\n0 6\n0000000000 65535 f \n' +
      '0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000242 00000 n \n0000000340 00000 n \n' +
      'trailer<</Size 6/Root 1 0 R>>\nstartxref\n430\n%%EOF\n',
    );
    const p = path.join(UPLOADS_DIR, 't.pdf');
    fs.writeFileSync(p, minimalPdf);
    const t = await extractText(p, 'pdf');
    expect(typeof t).toBe('string');
    expect(t).toContain('Hello Studentbuddy');
  });
});
