/**
 * security/approval —— AI 文件写入审批闸门 + 沙箱暂存。
 *
 * 工作流（参考 OpenAI Codex 沙箱审批 + Cline diff 审批）：
 * 1) AI 通过 [FS] 块请求 write/edit。
 * 2) 若 approvalMode === 'require_approval'：
 *    - 沙箱开启时：变更先落到 <工作区>/.studentbuddy-sandbox/<changeId>/ 下，
 *      生成 diff，推 file-change 事件给前端审批队列。
 *    - 沙箱关闭时：直接写入目标文件，但同时推 file-change 事件供前端撤销。
 * 3) 用户在设置页/审批队列里「批准」→ 若沙箱开启，把暂存内容 apply 到目标文件。
 * 4) 「拒绝」→ 删除沙箱暂存文件，目标文件不变。
 *
 * 安全收益：
 * - AI 无法绕过审批直接修改用户代码。
 * - 沙箱模式下，即使用户误点「批准」，也只是应用暂存内容（可再撤销）。
 * - 审批队列持久化到 DB（approval_queue 表），重启不丢。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../gateway/db';
import { getWorkspaceRoot } from '../fs-tools';
import { getPolicy } from './policy';
import { createLogger } from '../logger';

const log = createLogger('approval');

export const SANDBOX_DIR = '.studentbuddy-sandbox';

/** 审批队列项。 */
export interface ApprovalItem {
  id: string;
  sessionId: string;
  action: 'write' | 'edit';
  path: string;          // 相对工作区的目标路径
  sandboxPath: string;   // 沙箱暂存文件绝对路径（apply 时读取）
  before: string;        // 原文件内容（空表示新建）
  after: string;         // 暂存内容（即待批准的新内容）
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  createdAt: string;
}

// ─── DB 持久化 ────────────────────────────────────────────────────

export function ensureApprovalTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS approval_queue (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('write', 'edit')),
      target_path TEXT NOT NULL,
      sandbox_path TEXT NOT NULL,
      before_content TEXT NOT NULL DEFAULT '',
      after_content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'applied')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_approval_status ON approval_queue(status);
    CREATE INDEX IF NOT EXISTS idx_approval_session ON approval_queue(session_id);
  `);
}

/** 落库一条审批项。 */
export function persistApprovalItem(item: ApprovalItem): void {
  getDb().prepare(`
    INSERT INTO approval_queue (id, session_id, action, target_path, sandbox_path, before_content, after_content, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      updated_at = datetime('now')
  `).run(
    item.id, item.sessionId, item.action,
    item.path, item.sandboxPath,
    item.before, item.after,
    item.status,
  );
}

/** 列出 pending 审批项（按时间正序）。 */
export function listPendingApprovals(): ApprovalItem[] {
  const rows = getDb().prepare(`
    SELECT * FROM approval_queue WHERE status = 'pending' ORDER BY created_at
  `).all() as any[];
  return rows.map(rowToItem);
}

/** 列出所有审批项（含历史），分页。 */
export function listAllApprovals(limit = 50): ApprovalItem[] {
  const rows = getDb().prepare(`
    SELECT * FROM approval_queue ORDER BY created_at DESC LIMIT ?
  `).all(limit) as any[];
  return rows.map(rowToItem);
}

function rowToItem(r: any): ApprovalItem {
  return {
    id: r.id,
    sessionId: r.session_id,
    action: r.action,
    path: r.target_path,
    sandboxPath: r.sandbox_path,
    before: r.before_content,
    after: r.after_content,
    status: r.status,
    createdAt: r.created_at,
  };
}

// ─── 沙箱暂存 ────────────────────────────────────────────────────

/** 获取沙箱根目录绝对路径（工作区下 .studentbuddy-sandbox/）。 */
export function getSandboxRoot(): string | null {
  const root = getWorkspaceRoot();
  if (!root) return null;
  const sb = path.join(root, SANDBOX_DIR);
  if (!fs.existsSync(sb)) fs.mkdirSync(sb, { recursive: true });
  return sb;
}

/**
 * 把待写入内容暂存到沙箱。返回沙箱绝对路径。
 * 暂存文件命名：.studentbuddy-sandbox/<changeId>（单文件，内容即 after）。
 */
export function stageToSandbox(changeId: string, after: string): string {
  const sb = getSandboxRoot();
  if (!sb) throw new Error('沙箱根目录不可用');
  const fp = path.join(sb, changeId);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, after, 'utf8');
  log.info({ changeId, sandboxPath: fp }, 'staged to sandbox');
  return fp;
}

/** 删除沙箱暂存文件（拒绝审批时调用）。 */
export function removeFromSandbox(sandboxPath: string): void {
  try {
    if (!sandboxPath.includes(SANDBOX_DIR)) return; // 安全护栏
    if (fs.existsSync(sandboxPath)) fs.unlinkSync(sandboxPath);
  } catch { /* ignore */ }
}

// ─── 审批闸门主逻辑 ──────────────────────────────────────────────

export interface ApprovalGateResult {
  /** 是否需要进入审批队列。 */
  needsApproval: boolean;
  /** 若不需要审批且沙箱关闭，是否已直接写入目标文件。 */
  appliedDirectly: boolean;
  /** 审批项 ID（needsApproval=true 时有效）。 */
  approvalId?: string;
  /** 沙箱暂存路径。 */
  sandboxPath?: string;
}

/**
 * 审批闸门：根据策略决定 write/edit 是直接落盘还是进审批队列。
 *
 * @param sessionId 会话 ID
 * @param changeId  fs-tools 生成的变更 ID（用作沙箱文件名）
 * @param targetAbs 目标文件绝对路径
 * @param relPath   相对工作区路径（用于审批 UI 展示）
 * @param after     待写入的新内容
 * @param before    原文件内容（空=新建）
 * @param action    write 或 edit
 */
export function approvalGate(
  sessionId: string,
  changeId: string,
  targetAbs: string,
  relPath: string,
  after: string,
  before: string,
  action: 'write' | 'edit',
): ApprovalGateResult {
  const policy = getPolicy();

  // 自动批准模式：直接写入目标文件，不走沙箱
  if (policy.approvalMode === 'auto_approve') {
    fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
    fs.writeFileSync(targetAbs, after, 'utf8');
    return { needsApproval: false, appliedDirectly: true };
  }

  // 需审批：暂存到沙箱，推审批队列
  const sandboxPath = stageToSandbox(changeId, after);
  const item: ApprovalItem = {
    id: changeId,
    sessionId,
    action,
    path: relPath,
    sandboxPath,
    before,
    after,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  persistApprovalItem(item);
  return { needsApproval: true, appliedDirectly: false, approvalId: changeId, sandboxPath };
}

/**
 * 用户批准某审批项：把沙箱暂存内容 apply 到目标文件。
 */
export function approveItem(itemId: string): ApprovalItem {
  const row = getDb().prepare('SELECT * FROM approval_queue WHERE id = ?').get(itemId) as any;
  if (!row) throw new Error('审批项不存在');
  if (row.status !== 'pending') throw new Error('审批项已处理：' + row.status);

  const root = getWorkspaceRoot();
  if (!root) throw new Error('工作区未配置');
  const targetAbs = path.resolve(root, row.target_path);

  // 安全复核：目标路径仍在工作区内
  const rel = path.relative(root, targetAbs);
  if (rel.startsWith('..')) throw new Error('目标路径越界');

  fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
  fs.writeFileSync(targetAbs, row.after_content, 'utf8');
  removeFromSandbox(row.sandbox_path);

  getDb().prepare(`
    UPDATE approval_queue SET status = 'applied', updated_at = datetime('now') WHERE id = ?
  `).run(itemId);

  log.info({ itemId, path: row.target_path }, 'approval applied');
  return rowToItem({ ...row, status: 'applied' });
}

/**
 * 用户拒绝某审批项：删除沙箱暂存，目标文件不变。
 */
export function rejectItem(itemId: string): ApprovalItem {
  const row = getDb().prepare('SELECT * FROM approval_queue WHERE id = ?').get(itemId) as any;
  if (!row) throw new Error('审批项不存在');
  if (row.status !== 'pending') throw new Error('审批项已处理：' + row.status);

  removeFromSandbox(row.sandbox_path);
  getDb().prepare(`
    UPDATE approval_queue SET status = 'rejected', updated_at = datetime('now') WHERE id = ?
  `).run(itemId);

  log.info({ itemId, path: row.target_path }, 'approval rejected');
  return rowToItem({ ...row, status: 'rejected' });
}

/** 统计：pending 数量、今日处理量等。供设置页安全面板展示。 */
export function getApprovalStats(): {
  pending: number;
  approvedToday: number;
  rejectedToday: number;
  total: number;
} {
  const db = getDb();
  const pending = (db.prepare("SELECT COUNT(*) as c FROM approval_queue WHERE status='pending'").get() as any).c;
  const approvedToday = (db.prepare(`
    SELECT COUNT(*) as c FROM approval_queue
    WHERE status='applied' AND date(updated_at)=date('now')
  `).get() as any).c;
  const rejectedToday = (db.prepare(`
    SELECT COUNT(*) as c FROM approval_queue
    WHERE status='rejected' AND date(updated_at)=date('now')
  `).get() as any).c;
  const total = (db.prepare("SELECT COUNT(*) as c FROM approval_queue").get() as any).c;
  return { pending, approvedToday, rejectedToday, total };
}
