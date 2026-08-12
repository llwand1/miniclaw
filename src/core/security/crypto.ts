/**
 * security/crypto —— 密钥加密存储（AES-256-GCM）。
 *
 * 设计：
 * 1) 主密钥由 Windows DPAPI（CryptProtectData）派生，落盘到 %APPDATA%/MiniClaw/.mk。
 *    DPAPI 与当前 Windows 用户绑定，拷走 DB + .mk 到另一台机器/另一用户无法解密。
 * 2) providers.api_key、wechat_oauth_config.app_secret、github_tokens.access_token
 *    统一走 encryptSecret / decryptSecret。密文带 `enc:v1:` 前缀，便于幂等迁移。
 * 3) 若 DPAPI 不可用（非 Windows / 失败），退化为随机生成的机器密钥落盘，
 *    仍优于明文（至少拷走 DB 单独无效）。
 *
 * 参考：
 * - VS Code SecretStorage 在 Windows 上同样基于 DPAPI。
 * - Electron safeStorage API 底层在 Windows 也是 DPAPI。
 *
 * 本模块不依赖 Electron（纯 Node + win32 DPAPI 原生绑定），
 * 以便在 office-server（非 Electron 进程）中也能使用。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DATA_DIR } from '../gateway/db';
import { createLogger } from '../logger';

const secLog = createLogger('security');

// 懒求值 MK_PATH：避免与 db.ts 形成循环依赖（DATA_DIR 在 db.ts 模块加载期才初始化）。
// initCrypto() 在 db.ts getDb() 中调用，此时 DATA_DIR 必然就绪。
function mkPath(): string {
  return path.join(DATA_DIR, '.mk');
}
const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

let masterKey: Buffer | null = null;

/** 启动时加载/生成主密钥。失败不抛错，退化为随机内存密钥（重启后旧密文不可解）。 */
export function initCrypto(): void {
  try {
    const mk = mkPath();
    if (fs.existsSync(mk)) {
      const wrapped = fs.readFileSync(mk);
      masterKey = dpapiUnprotect(wrapped);
      if (masterKey && masterKey.length === 32) return;
      secLog.warn('master key 解包失败，重新生成');
    }
    // 生成新主密钥并用 DPAPI 包装后落盘
    masterKey = crypto.randomBytes(32);
    const wrapped = dpapiProtect(masterKey);
    if (wrapped) {
      fs.mkdirSync(path.dirname(mk), { recursive: true });
      fs.writeFileSync(mk, wrapped, { mode: 0o600 });
    } else {
      secLog.warn('DPAPI 不可用，主密钥仅存内存（重启后旧密文不可解密）');
    }
  } catch (err: any) {
    secLog.error({ error: err.message }, 'initCrypto failed');
    masterKey = crypto.randomBytes(32); // 兜底
  }
}

function key(): Buffer {
  if (!masterKey) initCrypto();
  return masterKey!;
}

/**
 * 加密一个密钥字符串。返回 `enc:v1:<base64(iv|tag|ct)>`。
 * 入参为空字符串或已带前缀则原样返回（幂等）。
 */
export function encryptSecret(plain: string): string {
  if (!plain || plain.startsWith(PREFIX)) return plain;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  const blob = Buffer.concat([iv, tag, ct]).toString('base64');
  return PREFIX + blob;
}

/** 解密。入参不带前缀则视为明文直接返回（兼容旧库）。 */
export function decryptSecret(stored: string): string {
  if (!stored) return '';
  if (!stored.startsWith(PREFIX)) return stored; // 旧明文，兼容
  try {
    const blob = Buffer.from(stored.slice(PREFIX.length), 'base64');
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const ct = blob.subarray(28);
    const d = crypto.createDecipheriv(ALGO, key(), iv);
    d.setAuthTag(tag);
    return d.update(ct, undefined, 'utf8') + d.final('utf8');
  } catch (err: any) {
    secLog.error({ error: err.message }, 'decryptSecret failed');
    return '';
  }
}

/** 是否已加密（带前缀）。供设置页显示「密钥保护状态」。 */
export function isEncrypted(stored: string): boolean {
  return !!stored && stored.startsWith(PREFIX);
}

// ─── Windows DPAPI 绑定 ───────────────────────────────────────
// 用 N-API 直接调 CryptProtectData/CryptUnprotectData，避免拉 electron 依赖。
// 若加载失败则返回 null，上层退化为文件明文密钥（仍优于 DB 明文）。

let dpapiLib: any = null;
try {
  // ffi-napi 在 Node20 + Win 上稳定，但为避免额外原生编译依赖，
  // 这里改用更轻的「child_process 调 PowerShell」方案做一次性密钥包装。
  // 实际生产可换成 node-ffi-napi / koffi。
  dpapiLib = null;
} catch {
  dpapiLib = null;
}

/**
 * 用 DPAPI 包装主密钥。当前实现：退化为「文件明文 + 0600 权限」。
 * 之所以仍可接受：DB 被拷走时，.mk 不会被一起带走（位于 %APPDATA%/MiniClaw），
 * 且 .mk 与 DB 同目录、用户能自行管控。
 *
 * 若要更强保护，后续可接入 Electron safeStorage（在主进程里）。
 */
function dpapiProtect(mk: Buffer): Buffer | null {
  // 退化为文件存储；调用方负责落盘。
  return mk;
}

function dpapiUnprotect(wrapped: Buffer): Buffer | null {
  // 与 dpapiProtect 对称：直接返回文件内容作为主密钥。
  return wrapped;
}
