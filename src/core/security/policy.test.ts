import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// vi.hoisted 保证在静态 import 之前设置 DATA_DIR(避免 ES module import 提升导致连到真实库)
const { TMP } = vi.hoisted(() => {
  const fs = require('node:fs') as typeof import('node:fs');
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'studentbuddy-test-policy-'));
  process.env.DATA_DIR = TMP;
  return { TMP };
});

import { getDb } from '../gateway/db';
import { checkPath, checkWriteRate, checkWriteSize, checkReadSize, clearWriteRate, getPolicy, setPolicy, DEFAULT_POLICY } from './policy';

describe('security/policy', () => {
  beforeAll(() => {
    getDb(); // 触发迁移 + ensurePolicy
  });

  beforeEach(() => {
    clearWriteRate('session-a');
    clearWriteRate('session-b');
    setPolicy(DEFAULT_POLICY); // 恢复默认
  });

  afterAll(() => {
    try { getDb().close(); } catch { /* ignore */ }
  });

  it('SEC-01 路径黑名单拦截 .env/.ssh/.git/node_modules', () => {
    expect(checkPath('/ws/.env', 'write').allowed).toBe(false);
    expect(checkPath('/ws/.env.local', 'read').allowed).toBe(false);
    expect(checkPath('/ws/.ssh/id_rsa', 'write').allowed).toBe(false);
    expect(checkPath('/ws/project/.git/config', 'write').allowed).toBe(false);
    expect(checkPath('/ws/node_modules/pkg/index.ts', 'read').allowed).toBe(false);
  });

  it('SEC-02 扩展名黑名单拦截可执行文件(读/写均拒)', () => {
    expect(checkPath('/ws/a.exe', 'read').allowed).toBe(false);
    expect(checkPath('/ws/b.bat', 'write').allowed).toBe(false);
    expect(checkPath('/ws/c.ps1', 'write').allowed).toBe(false);
    expect(checkPath('/ws/d.dll', 'read').allowed).toBe(false);
    expect(checkPath('/ws/e.jar', 'write').allowed).toBe(false);
    // 注意:.js 也在黑名单(代码现状,DEFAULT_POLICY.extensionBlocklist 含 'js')
    expect(checkPath('/ws/f.js', 'read').allowed).toBe(false);
  });

  it('SEC-03 扩展名白名单外写入拒绝、读取放行', () => {
    const w = checkPath('/ws/a.unknown_ext', 'write');
    expect(w.allowed).toBe(false);
    const r = checkPath('/ws/a.unknown_ext', 'read');
    expect(r.allowed).toBe(true); // 非可执行扩展名:读允许
  });

  it('SEC-04 写入限流:超过 writeRatePerMin 拒绝', () => {
    const limit = getPolicy().writeRatePerMin; // 默认 30
    for (let i = 0; i < limit; i++) {
      expect(checkWriteRate('session-a').allowed).toBe(true);
    }
    const blocked = checkWriteRate('session-a');
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain('限流');
    // 另一会话不受影响
    expect(checkWriteRate('session-b').allowed).toBe(true);
  });

  it('SEC-05 大小上限:写 2MB+ / 读 4MB+ 拒绝', () => {
    expect(checkWriteSize(DEFAULT_POLICY.maxWriteBytes + 1).allowed).toBe(false);
    expect(checkWriteSize(DEFAULT_POLICY.maxWriteBytes).allowed).toBe(true);
    expect(checkReadSize(DEFAULT_POLICY.maxReadBytes + 1).allowed).toBe(false);
    expect(checkReadSize(DEFAULT_POLICY.maxReadBytes).allowed).toBe(true);
  });

  it('setPolicy 部分合并:改一个字段其余保留', () => {
    setPolicy({ writeRatePerMin: 5 });
    const p = getPolicy();
    expect(p.writeRatePerMin).toBe(5);
    expect(p.approvalMode).toBe(DEFAULT_POLICY.approvalMode);
    expect(p.maxWriteBytes).toBe(DEFAULT_POLICY.maxWriteBytes);
  });

  it('DEFAULT_POLICY 默认值断言(与安全文档一致)', () => {
    expect(DEFAULT_POLICY.approvalMode).toBe('require_approval');
    expect(DEFAULT_POLICY.sandboxEnabled).toBe(true);
    expect(DEFAULT_POLICY.writeRatePerMin).toBe(30);
    expect(DEFAULT_POLICY.maxWriteBytes).toBe(2 * 1024 * 1024);
    expect(DEFAULT_POLICY.maxReadBytes).toBe(4 * 1024 * 1024);
  });
});
