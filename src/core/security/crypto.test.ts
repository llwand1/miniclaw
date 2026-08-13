import { describe, it, expect, beforeAll, vi } from 'vitest';

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
});
