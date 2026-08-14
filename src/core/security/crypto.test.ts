import { describe, it, expect, beforeAll, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// vi.hoisted 保证在静态 import 之前设置 DATA_DIR(避免连到真实库)
vi.hoisted(() => {
  const fs = require('node:fs') as typeof import('node:fs');
  const os = require('node:os') as typeof import('node:os');
  const path = require('node:path') as typeof import('node:path');
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'studentbuddy-test-crypto-'));
  process.env.DATA_DIR = TMP;
});

import { initCrypto, encryptSecret, decryptSecret, isEncrypted } from './crypto';

describe('security/crypto', () => {
  beforeAll(() => {
    initCrypto();
  });

  it('SEC-06 加密→解密往返还原原文', () => {
    const plain = 'sk-abc123-XYZ';
    const enc = encryptSecret(plain);
    expect(enc).not.toBe(plain);
    expect(enc.startsWith('enc:v1:')).toBe(true);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it('SEC-07 幂等:已加密串不二次加密、空串原样、旧明文兼容解密', () => {
    const enc = encryptSecret('key-1');
    expect(encryptSecret(enc)).toBe(enc); // 二次加密幂等
    expect(encryptSecret('')).toBe('');   // 空串原样
    expect(isEncrypted(enc)).toBe(true);
    expect(isEncrypted('plain')).toBe(false);
    expect(decryptSecret('legacy-plain')).toBe('legacy-plain'); // 无前缀按明文返回
    expect(decryptSecret('')).toBe('');
  });

  it('相同明文两次加密产生不同密文(随机 IV)', () => {
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same');
    expect(decryptSecret(b)).toBe('same');
  });

  it('伪造/损坏密文解密返回空串不抛错', () => {
    expect(decryptSecret('enc:v1:!!!bad-base64!!!')).toBe('');
  });

  it('SEC-09 Windows 上 .mk 是 DPAPI 包装的 blob,而非明文主密钥', () => {
    const blob = fs.readFileSync(path.join(process.env.DATA_DIR!, '.mk'));
    if (process.platform === 'win32') {
      // DPAPI blob 含版本头/salt,长度远大于 32;若等于 32 说明仍是旧版明文 stub 落盘
      expect(blob.length).not.toBe(32);
    }
  });

  it('SEC-08 旧版明文主密钥自动迁移为 DPAPI,既有密文不丢', async () => {
    const TMP2 = fs.mkdtempSync(path.join(os.tmpdir(), 'studentbuddy-test-crypto-mig-'));
    // 模拟旧版 stub:预置 32 字节明文主密钥,并用它加密一条「存量密文」
    const legacyKey = Buffer.from('L'.repeat(32));
    fs.writeFileSync(path.join(TMP2, '.mk'), legacyKey);
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', legacyKey, iv);
    const ct = Buffer.concat([c.update('存量密钥-迁移前', 'utf8'), c.final()]);
    const legacyCipher = 'enc:v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');

    // 用全新的模块实例 + 新 DATA_DIR 模拟一次独立启动
    vi.resetModules();
    process.env.DATA_DIR = TMP2;
    const m = await import('./crypto');
    m.initCrypto();

    // 迁移复用了旧密钥(而非生成新钥):既有密文仍可解
    expect(m.decryptSecret(legacyCipher)).toBe('存量密钥-迁移前');
    // 迁移后加解密正常
    const enc = m.encryptSecret('post-migration');
    expect(m.decryptSecret(enc)).toBe('post-migration');
    // Windows 上 .mk 已被重写为 DPAPI blob(不再是 32 字节明文)
    const blob = fs.readFileSync(path.join(TMP2, '.mk'));
    if (process.platform === 'win32') expect(blob.length).not.toBe(32);

    // 模拟再重启一次:从 DPAPI blob 解回旧密钥,既有密文仍可解(真实 DPAPI 往返)
    vi.resetModules();
    const m2 = await import('./crypto');
    m2.initCrypto();
    expect(m2.decryptSecret(legacyCipher)).toBe('存量密钥-迁移前');

    process.env.DATA_DIR = os.tmpdir();
  });
});
