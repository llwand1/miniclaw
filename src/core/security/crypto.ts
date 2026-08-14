/**
 * security/crypto —— 密钥加密存储（AES-256-GCM）。
 *
 * 设计：
 * 1) 主密钥由 Windows DPAPI（CryptProtectData）保护，落盘到 %APPDATA%/studentbuddy/.mk。
 *    实现上通过 Windows 自带的 PowerShell（System.Security.Cryptography.ProtectedData，
 *    DataProtectionScope.CurrentUser）调用 CryptProtectData/CryptUnprotectData；
 *    CurrentUser 作用域 = 与当前 Windows 用户绑定：即使 DB 与 .mk 一起被拷走，
 *    到另一台机器/另一用户也无法解开（不再退化为明文文件）。
 * 2) providers.api_key、wechat_oauth_config.app_secret、github_tokens.access_token
 *    统一走 encryptSecret / decryptSecret。密文带 `enc:v1:` 前缀，便于幂等迁移。
 * 3) 平台降级（如实标注，不宣称不存在的保护）：
 *    - Windows 上 DPAPI 意外失败 → 主密钥仅存内存，重启后旧密文不可解（宁缺毋滥，不退回明文）；
 *    - 非 Windows（无 DPAPI）→ 退化为随机机器密钥明文落盘，仅隔离「密钥文件」与「密文列」。
 *
 * 迁移：旧版 stub 曾把主密钥明文（32 字节）写进 .mk。initCrypto 检测到该形态时复用旧密钥
 * 并立即用 DPAPI 重新包装写回——保证既有 enc:v1: 密文可解，不静默丢失用户密钥。
 *
 * 参考：
 * - VS Code SecretStorage 在 Windows 上同样基于 DPAPI。
 * - Electron safeStorage API 底层在 Windows 也是 DPAPI。
 *
 * 本模块不依赖 Electron（纯 Node + Windows 自带组件），
 * 以便在 office-server（非 Electron 进程）中也能使用。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
      // 旧版 stub 迁移：早期 .mk 是 32 字节明文主密钥（未做 DPAPI 包装）。DPAPI blob
      // （CryptProtectData 产物含版本头/salt）恒大于 32 字节，故 32 字节必是旧明文——
      // 直接复用旧密钥并立即用 DPAPI 重新包装写回，避免换钥让库中全部 enc:v1: 密文
      // 永久不可解（用户密钥静默丢失）。不先尝试 Unprotect，避免对非 blob 文件做注定
      // 失败的 DPAPI 调用。
      if (process.platform === 'win32' && wrapped.length === 32) {
        secLog.warn('检测到旧版明文主密钥(.mk)，正在迁移为 DPAPI 保护…');
        const wrappedDp = dpapiProtect(wrapped);
        if (wrappedDp) fs.writeFileSync(mk, wrappedDp, { mode: 0o600 });
        masterKey = wrapped;
        return;
      }
      const unwrapped = dpapiUnprotect(wrapped);
      if (unwrapped && unwrapped.length === 32) {
        masterKey = unwrapped;
        return;
      }
      secLog.warn('master key 解包失败，重新生成');
    }
    // 生成新主密钥并用 DPAPI 包装后落盘
    masterKey = crypto.randomBytes(32);
    const wrapped = dpapiProtect(masterKey);
    if (wrapped) {
      fs.mkdirSync(path.dirname(mk), { recursive: true });
      fs.writeFileSync(mk, wrapped, { mode: 0o600 });
    } else if (process.platform !== 'win32') {
      // 非 Windows 无 DPAPI：退化为随机机器密钥明文落盘，仅隔离「密钥文件」与「密文列」，
      // 不再宣称用户绑定。拷走整个数据目录仍可解密——如实降级。
      fs.mkdirSync(path.dirname(mk), { recursive: true });
      fs.writeFileSync(mk, masterKey, { mode: 0o600 });
      secLog.warn('非 Windows 环境，主密钥以文件明文退化存储（无 DPAPI 用户绑定）');
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
// 用 Windows 自带的 PowerShell 调 System.Security.Cryptography.ProtectedData
// （即 CryptProtectData/CryptUnprotectData 的托管封装），DataProtectionScope.CurrentUser
// 作用域与当前 Windows 用户绑定。不引入 Electron/原生编译依赖（node-ffi-napi/koffi 需额外
// 装原生绑定），office-server（非 Electron 进程）中也能用。
// 每次调用 spawn 一次 powershell.exe，仅在启动时包装/解包主密钥至多一次，开销可接受。
// 失败返回 null，由 initCrypto 按平台降级策略处理。

const DPAPI_SCOPE = '[System.Security.Cryptography.DataProtectionScope]::CurrentUser';

/** 执行单条 DPAPI 命令（输入/输出均为 base64）。失败返回 null。 */
function runDpapi(inputB64: string, protect: boolean): string | null {
  try {
    const verb = protect ? 'Protect' : 'Unprotect';
    const script = [
      "$ProgressPreference='SilentlyContinue'",
      'Add-Type -AssemblyName System.Security',
      `$b=[System.Convert]::FromBase64String('${inputB64}')`,
      `$e=[System.Security.Cryptography.ProtectedData]::${verb}($b,$null,${DPAPI_SCOPE})`,
      '[System.Convert]::ToBase64String($e)',
    ].join('; ');
    // -EncodedCommand 接收 UTF-16LE 的 base64，规避一切引号/转义问题
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const out = (execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      timeout: 20000,
      encoding: 'utf8',
    }) || '').trim();
    // PowerShell 出错时会把 CLIXML 序列化错误输出,而非干净文本——识别并当作失败处理
    if (!out || out.startsWith('<Objs') || out.startsWith('#< CLIXML')) return null;
    return out;
  } catch (err: any) {
    secLog.warn({ error: err?.message }, 'DPAPI 调用失败');
    return null;
  }
}

/** 用 DPAPI 包装主密钥。非 Windows 无 DPAPI，返回 null（走降级策略）。 */
function dpapiProtect(mk: Buffer): Buffer | null {
  if (process.platform !== 'win32') return null;
  const b64 = runDpapi(mk.toString('base64'), true);
  return b64 ? Buffer.from(b64, 'base64') : null;
}

/** 用 DPAPI 解开主密钥。非 Windows 的 .mk 为退化明文，直接按明文读回。 */
function dpapiUnprotect(wrapped: Buffer): Buffer | null {
  if (process.platform !== 'win32') return wrapped;
  const b64 = runDpapi(wrapped.toString('base64'), false);
  return b64 ? Buffer.from(b64, 'base64') : null;
}
