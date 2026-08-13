/**
 * security/policy —— 文件操作安全策略。
 *
 * 包含：
 * - 路径黑名单（.env/.ssh/.aws/.git/node_modules 等敏感目录与文件）
 * - 扩展名白名单（默认允许常见代码/文本/配置；可执行文件默认拒绝）
 * - 写入限流（单会话每分钟最多 N 次写入，防 AI 循环写爆磁盘）
 * - 单文件大小上限
 *
 * 策略存储在 app_settings 的 security_policy 键下（JSON），可在设置页编辑。
 * 默认策略在 DEFAULT_POLICY 中，首次启动落库。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../gateway/db';

export interface SecurityPolicy {
  /** 路径黑名单（相对工作区或绝对路径片段，命中即拒绝读/写）。 */
  pathBlocklist: string[];
  /** 扩展名白名单（小写，无点）。空数组 = 允许全部。 */
  extensionAllowlist: string[];
  /** 扩展名黑名单（优先级高于白名单）。默认含 exe/dll/bat/ps1/sh 等。 */
  extensionBlocklist: string[];
  /** 写入限流：每分钟最多写入次数。0 = 不限。 */
  writeRatePerMin: number;
  /** 单文件写入大小上限（字节）。 */
  maxWriteBytes: number;
  /** 是否禁止 AI 读取大于此大小的文件。 */
  maxReadBytes: number;
  /** 审批模式：auto_approve = AI 写入直接落盘；require_approval = 进审批队列。 */
  approvalMode: 'auto_approve' | 'require_approval';
  /** 沙箱开关：true 时 AI 写入先落 .studentbuddy-sandbox/ 暂存区。 */
  sandboxEnabled: boolean;
}

export const DEFAULT_POLICY: SecurityPolicy = {
  pathBlocklist: [
    '.env',
    '.env.local',
    '.env.production',
    '.ssh',
    '.aws',
    '.git',
    'node_modules',
    '.npmrc',
    '.pypirc',
    'id_rsa',
    'id_ed25519',
    '.studentbuddy-sandbox', // 沙箱暂存区本身不让 AI 碰
  ],
  extensionAllowlist: [
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
    'json', 'yaml', 'yml', 'toml', 'ini', 'cfg',
    'md', 'txt', 'rst', 'log',
    'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs',
    'html', 'css', 'scss', 'less',
    'sql', 'sh', 'bash', 'ps1',
    'vue', 'svelte',
  ],
  extensionBlocklist: [
    'exe', 'dll', 'sys', 'msi', 'bat', 'cmd', 'ps1', 'vbs', 'js', 'jar',
    'so', 'dylib', 'o', 'obj', 'bin',
  ],
  writeRatePerMin: 30,
  maxWriteBytes: 2 * 1024 * 1024, // 2MB
  maxReadBytes: 4 * 1024 * 1024,  // 4MB
  approvalMode: 'require_approval',
  sandboxEnabled: true,
};

const SETTINGS_KEY = 'security_policy';

/** 读取当前策略（合并默认值，容错）。 */
export function getPolicy(): SecurityPolicy {
  try {
    const row = getDb().prepare("SELECT value FROM app_settings WHERE key=?").get(SETTINGS_KEY) as any;
    if (!row?.value) return { ...DEFAULT_POLICY };
    const parsed = JSON.parse(row.value);
    return { ...DEFAULT_POLICY, ...parsed };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

/** 保存策略。 */
export function setPolicy(p: Partial<SecurityPolicy>): SecurityPolicy {
  const current = getPolicy();
  const merged = { ...current, ...p };
  getDb().prepare(
    "INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')",
  ).run(SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}

/** 首次启动初始化。 */
export function ensurePolicy(): void {
  try {
    const row = getDb().prepare("SELECT value FROM app_settings WHERE key=?").get(SETTINGS_KEY) as any;
    if (!row?.value) setPolicy(DEFAULT_POLICY);
  } catch { /* ignore */ }
}

// ─── 校验 ────────────────────────────────────────────────────────

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
}

/** 检查路径是否命中黑名单或扩展名黑名单。 */
export function checkPath(absPath: string, op: 'read' | 'write'): PolicyCheckResult {
  const policy = getPolicy();
  const normalized = absPath.replace(/\\/g, '/');
  const ext = path.extname(normalized).slice(1).toLowerCase();

  // 路径黑名单：匹配路径片段（目录名或文件名）
  for (const blocked of policy.pathBlocklist) {
    const b = blocked.replace(/\\/g, '/');
    // 精确片段匹配：/name/ 或 /name（结尾）
    if (normalized.includes('/' + b + '/') || normalized.endsWith('/' + b) || normalized === b) {
      return { allowed: false, reason: `路径命中黑名单：${b}（${op} 操作被拒绝）` };
    }
  }

  // 扩展名黑名单（最高优先级）
  if (ext && policy.extensionBlocklist.includes(ext)) {
    return { allowed: false, reason: `扩展名 .${ext} 在黑名单中（可执行/脚本文件禁止 AI 操作）` };
  }

  // 扩展名白名单（若配置了且非空）
  if (ext && policy.extensionAllowlist.length > 0 && !policy.extensionAllowlist.includes(ext)) {
    // 白名单未覆盖，但不是可执行文件 → 读允许、写需审批
    if (op === 'write') {
      return { allowed: false, reason: `扩展名 .${ext} 不在白名单中，写入被拒绝` };
    }
  }

  return { allowed: true };
}

// ─── 写入限流 ─────────────────────────────────────────────────────

const writeTimestamps = new Map<string, number[]>(); // sessionId -> 时间戳数组

/** 记录一次写入并检查限流。 */
export function checkWriteRate(sessionId: string): PolicyCheckResult {
  const policy = getPolicy();
  if (policy.writeRatePerMin <= 0) return { allowed: true };

  const now = Date.now();
  const windowMs = 60_000;
  const arr = writeTimestamps.get(sessionId) || [];
  const recent = arr.filter(t => now - t < windowMs);
  if (recent.length >= policy.writeRatePerMin) {
    return { allowed: false, reason: `写入限流：每分钟最多 ${policy.writeRatePerMin} 次` };
  }
  recent.push(now);
  writeTimestamps.set(sessionId, recent);
  return { allowed: true };
}

/** 检查写入大小。 */
export function checkWriteSize(contentBytes: number): PolicyCheckResult {
  const policy = getPolicy();
  if (contentBytes > policy.maxWriteBytes) {
    return { allowed: false, reason: `文件大小 ${contentBytes} 超过上限 ${policy.maxWriteBytes}` };
  }
  return { allowed: true };
}

/** 检查读取大小。 */
export function checkReadSize(fileBytes: number): PolicyCheckResult {
  const policy = getPolicy();
  if (fileBytes > policy.maxReadBytes) {
    return { allowed: false, reason: `文件大小 ${fileBytes} 超过读取上限 ${policy.maxReadBytes}` };
  }
  return { allowed: true };
}

/** 清理某会话的限流计数（会话结束时调用）。 */
export function clearWriteRate(sessionId: string): void {
  writeTimestamps.delete(sessionId);
}
