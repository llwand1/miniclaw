import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// vi.hoisted 保证在静态 import 之前设置 DATA_DIR(独立临时库,避免连到真实库)
const { TMP, WORKSPACE } = vi.hoisted(() => {
  const fs = require('node:fs') as typeof import('node:fs');
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'studentbuddy-test-fst-'));
  const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), 'studentbuddy-test-ws-fst-'));
  process.env.DATA_DIR = TMP;
  return { TMP, WORKSPACE };
});

import { getDb } from './gateway/db';
import { setWorkspaceRoot, resolveSafe, fsList, fsRead, fsWrite, fsEdit, fsRevert, fsGrep, listChanges } from './fs-tools';
import { setPolicy, DEFAULT_POLICY } from './security/policy';

describe('core/fs-tools', () => {
  beforeAll(() => {
    getDb();
    fs.mkdirSync(WORKSPACE, { recursive: true });
    setWorkspaceRoot(WORKSPACE);
    // 文件工具测试走 auto_approve,直接落盘(审批流的测试在 approval.test.ts 已覆盖)
    setPolicy({ ...DEFAULT_POLICY, approvalMode: 'auto_approve' });
    // 造测试文件
    fs.mkdirSync(path.join(WORKSPACE, 'src'), { recursive: true });
    fs.mkdirSync(path.join(WORKSPACE, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(WORKSPACE, 'src', 'app.ts'), 'export const a = 1;\nconsole.log("hello");\n');
    fs.writeFileSync(path.join(WORKSPACE, 'README.md'), '# Hi\n\nbody text\n');
    fs.writeFileSync(path.join(WORKSPACE, 'node_modules', 'pkg.js'), 'x');
  });

  beforeEach(() => {
    setPolicy({ ...DEFAULT_POLICY, approvalMode: 'auto_approve' });
  });

  afterAll(() => {
    try { getDb().close(); } catch { /* ignore */ }
  });

  it('FST-01 resolveSafe 相对路径解析到工作区内', () => {
    expect(resolveSafe('src/app.ts')).toBe(path.join(WORKSPACE, 'src', 'app.ts'));
    expect(resolveSafe('.')).toBe(WORKSPACE);
  });

  it('FST-02 resolveSafe 越界拒绝(../ 与工作区外绝对路径)', () => {
    expect(() => resolveSafe('../outside.txt')).toThrow(/越界/);
    expect(() => resolveSafe(path.join(os.tmpdir(), 'elsewhere'))).toThrow(/越界/);
  });

  it('FST-04 fsList 目录树:跳过 node_modules,目录在前文件在后', () => {
    const root = fsList('.');
    const names = root.map(n => n.name);
    expect(names).toContain('src');
    expect(names).toContain('README.md');
    expect(names).not.toContain('node_modules'); // 跳过
    const src = fsList('src');
    expect(src[0].name).toBe('app.ts');
    expect(src[0].type).toBe('file');
  });

  it('FST-05 fsRead 正常读取', () => {
    const r = fsRead('src/app.ts');
    expect(r.content).toContain('export const a = 1;');
    expect(r.truncated).toBe(false);
    expect(r.binary).toBe(false);
  });

  it('FST-05 fsRead 二进制识别(NUL 字节)', () => {
    fs.writeFileSync(path.join(WORKSPACE, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02]));
    const r = fsRead('bin.dat');
    expect(r.binary).toBe(true);
  });

  it('FST-05 fsRead 截断(超 MAX_FILE_READ)', () => {
    const big = 'x'.repeat(300000); // 240KB 上限附近
    fs.writeFileSync(path.join(WORKSPACE, 'big.txt'), big);
    const r = fsRead('big.txt');
    expect(r.truncated).toBe(true);
    expect(r.content).toContain('已截断');
  });

  it('FST-06 fsWrite 新建文件', () => {
    const res = fsWrite('new.txt', 'content-1', 'sess-w');
    expect(res.changeId).toBeTruthy();
    expect(fs.readFileSync(path.join(WORKSPACE, 'new.txt'), 'utf8')).toBe('content-1');
  });

  it('FST-06 fsEdit 唯一匹配替换', () => {
    const res = fsEdit('src/app.ts', 'const a = 1', 'const a = 2', 'first', 'sess-e');
    expect(res.replaced).toBe(1);
    expect(fs.readFileSync(path.join(WORKSPACE, 'src', 'app.ts'), 'utf8')).toContain('const a = 2');
  });

  it('FST-06 fsEdit 未找到 old 抛错', () => {
    expect(() => fsEdit('src/app.ts', '不存在的内容xyz', 'new', 'first', 'sess-e2')).toThrow(/未找到/);
  });

  it('FST-07 fsRevert 撤销写/编辑', () => {
    const before = fs.readFileSync(path.join(WORKSPACE, 'src', 'app.ts'), 'utf8');
    const res = fsEdit('src/app.ts', 'const a = 2', 'const a = 999', 'first', 'sess-r');
    expect(fs.readFileSync(path.join(WORKSPACE, 'src', 'app.ts'), 'utf8')).toContain('const a = 999');
    fsRevert(res.changeId);
    expect(fs.readFileSync(path.join(WORKSPACE, 'src', 'app.ts'), 'utf8')).toBe(before);
  });

  it('FST-07 fsRevert 未知 changeId 抛错', () => {
    expect(() => fsRevert('nope-1')).toThrow(/变更记录不存在/);
  });

  it('FST-08 fsGrep 文本搜索与二进制跳过', () => {
    fs.writeFileSync(path.join(WORKSPACE, 'bin2.dat'), Buffer.from([0x00, 0xff]));
    const r = fsGrep('hello', 'src');
    expect(r.matches.length).toBe(1);
    expect(r.matches[0].text).toContain('hello');
    const r2 = fsGrep('x', '.');
    expect(r2.scanned).toBeGreaterThan(0);
    expect(r2.truncated).toBe(false);
  });

  it('listChanges 返回内存变更记录', () => {
    const before = listChanges().length;
    fsWrite('lc.txt', 'lc', 'sess-lc');
    expect(listChanges().length).toBe(before + 1);
  });
});
