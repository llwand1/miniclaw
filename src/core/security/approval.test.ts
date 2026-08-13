import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// vi.hoisted 保证在静态 import 之前设置 DATA_DIR(独立临时库,避免连到真实库)
const { TMP, WORKSPACE } = vi.hoisted(() => {
  const fs = require('node:fs') as typeof import('node:fs');
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'studentbuddy-test-approval-'));
  const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), 'studentbuddy-test-ws-'));
  process.env.DATA_DIR = TMP;
  return { TMP, WORKSPACE };
});

import { getDb } from '../gateway/db';
import { setWorkspaceRoot } from '../fs-tools';
import {
  approvalGate, approveItem, rejectItem, listPendingApprovals, getApprovalStats,
} from './approval';
import { getPolicy, setPolicy, DEFAULT_POLICY } from './policy';

describe('security/approval', () => {
  beforeAll(() => {
    getDb();
    fs.mkdirSync(WORKSPACE, { recursive: true });
    setWorkspaceRoot(WORKSPACE);
    setPolicy({ ...DEFAULT_POLICY, approvalMode: 'require_approval', sandboxEnabled: true });
  });

  beforeEach(() => {
    // 清空审批队列
    getDb().prepare('DELETE FROM approval_queue').run();
  });

  afterAll(() => {
    try { getDb().close(); } catch { /* ignore */ }
  });

  it('SEC-10 require_approval 模式:write 进审批队列 + 沙箱暂存,不直接写目标', () => {
    const target = path.join(WORKSPACE, 'sub', 'file.ts');
    const r = approvalGate('sess-1', 'chg-1', target, 'sub/file.ts', 'console.log(1)', '', 'write');
    expect(r.needsApproval).toBe(true);
    expect(r.appliedDirectly).toBe(false);
    expect(r.approvalId).toBe('chg-1');
    // 目标文件未写入
    expect(fs.existsSync(target)).toBe(false);
    // 沙箱暂存文件存在
    expect(fs.existsSync(r.sandboxPath!)).toBe(true);
    // 队列有 pending
    const pending = listPendingApprovals();
    expect(pending.length).toBe(1);
    expect(pending[0].path).toBe('sub/file.ts');
  });

  it('SEC-10 auto_approve 模式:直接落盘,不进队列', () => {
    setPolicy({ ...DEFAULT_POLICY, approvalMode: 'auto_approve' });
    try {
      const target = path.join(WORKSPACE, 'auto.ts');
      const r = approvalGate('sess-2', 'chg-auto', target, 'auto.ts', 'export {}', '', 'write');
      expect(r.needsApproval).toBe(false);
      expect(r.appliedDirectly).toBe(true);
      expect(fs.existsSync(target)).toBe(true);
      expect(fs.readFileSync(target, 'utf8')).toBe('export {}');
    } finally {
      setPolicy({ ...DEFAULT_POLICY, approvalMode: 'require_approval' });
    }
  });

  it('SEC-11 approve:沙箱内容 apply 到目标文件,状态 applied', () => {
    const target = path.join(WORKSPACE, 'ok.ts');
    approvalGate('sess-3', 'chg-ok', target, 'ok.ts', 'const a=1;', '', 'write');
    const applied = approveItem('chg-ok');
    expect(applied.status).toBe('applied');
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('const a=1;');
    // 沙箱暂存已清理
    const sandbox = getDb().prepare("SELECT sandbox_path FROM approval_queue WHERE id='chg-ok'").get() as any;
    expect(fs.existsSync(sandbox.sandbox_path)).toBe(false);
  });

  it('SEC-11 approve 越界路径拒绝(../ 逃逸)', () => {
    // 直接插入一条 target_path 越界的审批项
    const db = getDb();
    db.prepare(`
      INSERT INTO approval_queue (id, session_id, action, target_path, sandbox_path, before_content, after_content, status)
      VALUES ('chg-evil', 's-1', 'write', '../outside.txt', '${WORKSPACE.replace(/\\/g, '/')}/staged', '', 'x', 'pending')
    `).run();
    expect(() => approveItem('chg-evil')).toThrow(/越界/);
  });

  it('SEC-12 reject:删沙箱暂存,目标文件不变,状态 rejected', () => {
    const target = path.join(WORKSPACE, 'rej.ts');
    approvalGate('sess-4', 'chg-rej', target, 'rej.ts', 'new', 'old', 'edit');
    const r = rejectItem('chg-rej');
    expect(r.status).toBe('rejected');
    expect(fs.existsSync(target)).toBe(false); // 从未写入
    const row = getDb().prepare("SELECT sandbox_path FROM approval_queue WHERE id='chg-rej'").get() as any;
    expect(fs.existsSync(row.sandbox_path)).toBe(false);
  });

  it('SEC-12 重复处理抛「已处理」', () => {
    const target = path.join(WORKSPACE, 'dup.ts');
    approvalGate('sess-5', 'chg-dup', target, 'dup.ts', 'x', '', 'write');
    approveItem('chg-dup');
    expect(() => approveItem('chg-dup')).toThrow(/已处理/);
    expect(() => rejectItem('chg-dup')).toThrow(/已处理/);
  });

  it('getApprovalStats 统计正确', () => {
    const target = path.join(WORKSPACE, 'st.ts');
    approvalGate('sess-6', 'chg-st1', target, 'st.ts', 'a', '', 'write');
    approvalGate('sess-6', 'chg-st2', target, 'st.ts', 'b', '', 'write');
    approveItem('chg-st1');
    rejectItem('chg-st2');
    const stats = getApprovalStats();
    expect(stats.total).toBe(2);
    expect(stats.pending).toBe(0);
    expect(stats.approvedToday).toBe(1);
    expect(stats.rejectedToday).toBe(1);
  });

  it('DEFAULT_POLICY 默认即 require_approval + sandbox(与安全文档一致)', () => {
    expect(getPolicy().approvalMode).toBe('require_approval');
    expect(getPolicy().sandboxEnabled).toBe(true);
  });
});
