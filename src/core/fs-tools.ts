/**
 * fs-tools —— studentbuddy 工作区文件系统工具（沙箱）。
 *
 * 设计原则：
 * 1) 所有操作都限制在「配置的工作区根目录」内，resolveSafe 拦截一切越界（../、绝对路径逃逸）。
 * 2) 写/编辑操作记录到内存 recentChanges，支持按 changeId 撤销（Revert）。
 * 3) 不递归进入 node_modules / .git（噪点目录），避免把依赖与元数据当作上下文喂给模型。
 *
 * 该模块既被 gateway 在对话中「代表 AI」直接调用（最安全：AI 无法伪造 HTTP 请求），
 * 也被 office-server 的 /api/fs/* 端点用于前端工作区浏览器（树 / 预览 / 撤销）。
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { getDb } from './gateway/db';
import { createLogger } from './logger';
import { checkPath, checkReadSize, checkWriteSize, checkWriteRate } from './security/policy';
import { approvalGate, ApprovalGateResult } from './security/approval';

const log = createLogger('fs-tools');

const MAX_FILE_READ = 240_000; // 单次读取字符上限（约 240KB）
const MAX_TREE_DEPTH = 8;
const MAX_TREE_FILES = 1200;
const MAX_GREP_MATCHES = 80;
const SKIP_DIRS = new Set(['node_modules', '.git']);

// ─── 配置读写 ────────────────────────────────────────────────
export function getWorkspaceRoot(): string | null {
  try {
    const row = getDb().prepare("SELECT value FROM app_settings WHERE key='workspace_root'").get() as any;
    const v = row?.value?.trim();
    if (!v) return null;
    const abs = path.resolve(v);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return null;
    return abs;
  } catch (err: any) {
    log.warn({ error: err.message }, 'getWorkspaceRoot failed');
    return null;
  }
}

export function setWorkspaceRoot(p: string): string {
  const abs = path.resolve(p);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error('目录不存在：' + p);
  }
  getDb().prepare(
    "INSERT INTO app_settings (key,value) VALUES ('workspace_root',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')",
  ).run(abs);
  return abs;
}

/**
 * 首次启动时若未配置工作区，自动在用户主目录创建默认工作区并落库，
 * 省去手动设置步骤。默认路径：<用户主目录>/studentbuddyWorkspace。
 * 用户仍可在「工作区」视图里随时改到自己的项目目录。
 */
export function ensureDefaultWorkspace(): string {
  try {
    const row = getDb().prepare("SELECT value FROM app_settings WHERE key='workspace_root'").get() as any;
    if (row?.value?.trim()) return row.value.trim();
    const def = path.join(os.homedir(), 'studentbuddyWorkspace');
    fs.mkdirSync(def, { recursive: true });
    getDb().prepare(
      "INSERT INTO app_settings (key,value) VALUES ('workspace_root',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')",
    ).run(def);
    log.info({ path: def }, 'ensureDefaultWorkspace: 已自动创建默认工作区');
    return def;
  } catch (err: any) {
    log.warn({ error: err.message }, 'ensureDefaultWorkspace failed');
    return '';
  }
}

/** 把相对（或绝对但位于 root 内）路径解析为 root 内的安全绝对路径；越界抛错 */
export function resolveSafe(rel: string): string {
  const root = getWorkspaceRoot();
  if (!root) throw new Error('工作区尚未配置');
  const target = path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(root, rel);
  const relToRoot = path.relative(root, target);
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
    throw new Error('路径越界：只能在配置的工作区内操作（' + rel + '）');
  }
  return target;
}

// ─── 目录列举 ────────────────────────────────────────────────
export interface FsNode {
  name: string;
  path: string; // 相对 root 的 posix 路径
  type: 'dir' | 'file';
  size?: number;
}

export function fsList(relPath: string): FsNode[] {
  const root = getWorkspaceRoot();
  if (!root) throw new Error('工作区尚未配置');
  const abs = resolveSafe(relPath || '.');
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error('目录不存在：' + (relPath || '.'));
  }
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  const nodes: FsNode[] = [];
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(abs, e.name);
    let st: fs.Stats;
    try { st = fs.statSync(full); } catch { continue; }
    nodes.push({
      name: e.name,
      path: path.relative(root, full).split(path.sep).join('/'),
      type: e.isDirectory() ? 'dir' : 'file',
      size: e.isDirectory() ? undefined : st.size,
    });
  }
  // 目录在前、文件在后，各自按名称排序
  nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  return nodes;
}

// ─── 读取文件 ────────────────────────────────────────────────
export interface FsReadResult {
  content: string;
  size: number;
  truncated: boolean;
  binary: boolean;
  encoding: string;
}

export function fsRead(relPath: string, maxChars = MAX_FILE_READ): FsReadResult {
  const abs = resolveSafe(relPath);
  // 安全：路径黑名单 + 扩展名黑名单校验
  const pc = checkPath(abs, 'read');
  if (!pc.allowed) throw new Error(pc.reason || '路径被安全策略拒绝');
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new Error('文件不存在：' + relPath);
  }
  const stat = fs.statSync(abs);
  // 安全：读取大小上限校验
  const rc = checkReadSize(stat.size);
  if (!rc.allowed) throw new Error(rc.reason || '文件过大，读取被拒绝');
  const buf = fs.readFileSync(abs);
  // 含 NUL 字节视为二进制
  if (buf.includes(0)) {
    return { content: '<二进制文件，无法以文本显示>', size: buf.length, truncated: false, binary: true, encoding: 'binary' };
  }
  let text = buf.toString('utf8');
  const truncated = text.length > maxChars;
  if (truncated) {
    text = text.slice(0, maxChars) + `\n\n…（已截断，全文 ${text.length} 字符，请用 grep 定位后读取片段）`;
  }
  return { content: text, size: buf.length, truncated, binary: false, encoding: 'utf8' };
}

// ─── 写/编辑 + 撤销记录 ──────────────────────────────────────
interface ChangeRecord { abs: string; before: string }
const recentChanges = new Map<string, ChangeRecord>();
const MAX_CHANGES = 400;

function recordChange(abs: string, before: string): string {
  const id = 'fc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  recentChanges.set(id, { abs, before });
  if (recentChanges.size > MAX_CHANGES) {
    const oldest = recentChanges.keys().next().value;
    if (oldest) recentChanges.delete(oldest);
  }
  return id;
}

export function fsWrite(relPath: string, content: string, sessionId = 'system'): {
  changeId: string; before: string; sandboxed: boolean; approvalId?: string;
} {
  const abs = resolveSafe(relPath);
  // 安全：路径黑名单 + 扩展名校验
  const pc = checkPath(abs, 'write');
  if (!pc.allowed) throw new Error(pc.reason || '路径被安全策略拒绝');
  // 安全：写入大小上限
  const wc = checkWriteSize(Buffer.byteLength(content, 'utf8'));
  if (!wc.allowed) throw new Error(wc.reason || '文件过大，写入被拒绝');
  // 安全：写入限流（按 sessionId 计）
  const rc = checkWriteRate(sessionId);
  if (!rc.allowed) throw new Error(rc.reason || '写入限流');

  let before = '';
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
    before = fs.readFileSync(abs, 'utf8');
  }

  const changeId = recordChange(abs, before);
  // 安全：审批闸门（沙箱暂存 or 直写）
  const gate = approvalGate(sessionId, changeId, abs, relPath, content, before, 'write');
  if (gate.appliedDirectly) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  log.info({ path: relPath, bytes: content.length, sandboxed: gate.needsApproval }, 'fsWrite');
  return { changeId, before, sandboxed: gate.needsApproval, approvalId: gate.approvalId };
}

export function fsEdit(
  relPath: string,
  oldStr: string,
  newStr: string,
  occurrence: 'first' | 'all' = 'first',
  sessionId = 'system',
): { changeId: string; before: string; after: string; replaced: number; sandboxed: boolean; approvalId?: string } {
  if (!oldStr) throw new Error('old 不能为空');
  const abs = resolveSafe(relPath);
  // 安全：路径黑名单 + 扩展名校验
  const pc = checkPath(abs, 'write');
  if (!pc.allowed) throw new Error(pc.reason || '路径被安全策略拒绝');
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new Error('文件不存在：' + relPath);
  }
  const before = fs.readFileSync(abs, 'utf8');
  let after = before;
  let replaced = 0;
  if (occurrence === 'all') {
    const parts = before.split(oldStr);
    replaced = parts.length - 1;
    after = parts.join(newStr);
  } else {
    const idx = before.indexOf(oldStr);
    if (idx === -1) throw new Error('未找到待替换的文本（old 与文件内容不匹配）');
    after = before.slice(0, idx) + newStr + before.slice(idx + oldStr.length);
    replaced = 1;
  }
  if (replaced === 0) throw new Error('未找到待替换的文本（old 与文件内容不匹配）');
  // 安全：写入大小上限
  const wc = checkWriteSize(Buffer.byteLength(after, 'utf8'));
  if (!wc.allowed) throw new Error(wc.reason || '文件过大，写入被拒绝');
  // 安全：写入限流
  const rc = checkWriteRate(sessionId);
  if (!rc.allowed) throw new Error(rc.reason || '写入限流');

  const changeId = recordChange(abs, before);
  // 安全：审批闸门
  const gate = approvalGate(sessionId, changeId, abs, relPath, after, before, 'edit');
  if (gate.appliedDirectly) {
    fs.writeFileSync(abs, after, 'utf8');
  }
  log.info({ path: relPath, replaced, sandboxed: gate.needsApproval }, 'fsEdit');
  return { changeId, before, after, replaced, sandboxed: gate.needsApproval, approvalId: gate.approvalId };
}

export function fsRevert(changeId: string): void {
  const c = recentChanges.get(changeId);
  if (!c) throw new Error('变更记录不存在或已过期（仅保留最近 ' + MAX_CHANGES + ' 条）');
  fs.mkdirSync(path.dirname(c.abs), { recursive: true });
  fs.writeFileSync(c.abs, c.before, 'utf8');
  recentChanges.delete(changeId);
  log.info({ changeId, path: c.abs }, 'fsRevert');
}

/** 列出当前内存中记录的AI文件变更（供「查看所有变更」全局视图使用；仅保留最近 MAX_CHANGES 条，重启清空）。 */
export function listChanges(): any[] {
  return Array.from(recentChanges.values()).map(c => ({ ...c }));
}

// ─── 文本搜索（grep）──────────────────────────────────────────
export interface GrepMatch { path: string; line: number; text: string }
export interface GrepResult { matches: GrepMatch[]; truncated: boolean; scanned: number }

export function fsGrep(pattern: string, relPath: string, maxMatches = MAX_GREP_MATCHES): GrepResult {
  const root = getWorkspaceRoot();
  if (!root) throw new Error('工作区尚未配置');
  const abs = resolveSafe(relPath || '.');
  // 安全：路径黑名单 + 扩展名校验（grep 等同读操作）
  const pc = checkPath(abs, 'read');
  if (!pc.allowed) throw new Error(pc.reason || '路径被安全策略拒绝');
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'gi');
  } catch {
    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  }
  const matches: GrepMatch[] = [];
  let truncated = false;
  let scanned = 0;

  const grepFile = (fileAbs: string, rel: string) => {
    if (matches.length >= maxMatches) { truncated = true; return; }
    let buf: Buffer;
    try { buf = fs.readFileSync(fileAbs); } catch { return; }
    if (buf.includes(0)) return; // 跳过二进制
    scanned++;
    const lines = buf.toString('utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      regex.lastIndex = 0;
      if (regex.test(lines[i])) {
        matches.push({ path: rel.split(path.sep).join('/'), line: i + 1, text: lines[i].slice(0, 400) });
        if (matches.length >= maxMatches) { truncated = true; break; }
      }
    }
  };

  const walk = (dir: string, depth: number) => {
    if (depth > MAX_TREE_DEPTH) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile()) grepFile(full, path.relative(root, full));
    }
  };

  if (fs.statSync(abs).isFile()) {
    grepFile(abs, path.relative(root, abs));
  } else {
    walk(abs, 0);
  }
  return { matches, truncated, scanned };
}
