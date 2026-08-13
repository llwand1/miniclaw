/**
 * studentbuddy Skills 模块
 * ----------------------------------------------------------------------------
 * 设计契约（与 WorkBuddy 互通的核心）：
 *  - 技能正文存于 SKILL.md 文件，数据库 `skills` 表只做「索引/注册表」
 *    （id, name, description, path, enabled, source, created_at）。
 *  - 本地技能：DATA_DIR/skills/<name>/SKILL.md（source = 'local' | 'imported'）
 *  - WorkBuddy 导入：直接指向 ~/.workbuddy/skills/<name>/SKILL.md（source = 'workbuddy'），
 *    只读引用，不复制、不覆盖原文件 → 文件格式级互通。
 *  - SKILL.md 格式与 WorkBuddy 一致：YAML frontmatter(name/description) + Markdown 正文。
 *
 * 安全边界：技能正文只作为「系统提示词注入」使用（见 gateway/buildSystemPrompt），
 * 本模块绝不 eval / 执行任何技能代码。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './gateway/db';

/** studentbuddy 本地技能根目录（与 DB 同盘同根，零额外配置） */
export const SKILLS_DIR = path.join(DATA_DIR, 'skills');

/** WorkBuddy 技能根目录（本机已装 26 个 Google Agent Skills） */
export const WORKBUDDY_SKILLS_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  '.workbuddy',
  'skills',
);

/** 技能正文结构（frontmatter + body） */
export interface SkillMarkdown {
  name: string;
  description: string;
  content: string;
}

/** 目录名安全化：只允许字母/数字/下划线/连字符，避免路径穿越 */
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 80) || 'skill';
}

/**
 * 解析 SKILL.md：（可选）YAML frontmatter + Markdown 正文。
 * 兼容 WorkBuddy 生成的 frontmatter（name / description / agent_created 等）。
 */
export function parseSkillMarkdown(text: string): SkillMarkdown {
  const fm = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!fm) {
    return { name: '', description: '', content: text.trim() };
  }
  const fmText = fm[1];
  const nameM = fmText.match(/^\s*name:\s*(.+)$/m);
  const descM = fmText.match(/^\s*description:\s*(.+)$/m);
  return {
    name: nameM ? nameM[1].trim() : '',
    description: descM ? descM[1].trim() : '',
    content: fm[2].trim(),
  };
}

/** 序列化为 SKILL.md（与 WorkBuddy 同格式，含 agent_created 元数据） */
export function serializeSkillMarkdown(s: SkillMarkdown): string {
  const name = s.name.trim() || 'skill';
  const description = (s.description.trim() || '').replace(/\n/g, ' ');
  return [`---`, `name: ${name}`, `description: ${description}`, `agent_created: true`, `---`, '', s.content.trim(), ''].join('\n');
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** 把技能写到 studentbuddy 本地目录，返回 SKILL.md 绝对路径 */
export function writeLocalSkillFile(name: string, description: string, content: string): string {
  const safe = sanitize(name);
  const dir = path.join(SKILLS_DIR, safe);
  ensureDir(dir);
  const fp = path.join(dir, 'SKILL.md');
  fs.writeFileSync(fp, serializeSkillMarkdown({ name: safe, description, content }), 'utf8');
  return fp;
}

/** 读取技能正文（按 path）；文件缺失或损坏返回 null */
export function readSkillFile(filePath: string): SkillMarkdown | null {
  try {
    return parseSkillMarkdown(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 更新本地技能：按 name 重写到对应目录（目录名随 name 变化）；
 * 若路径改变，清理旧目录。返回新 SKILL.md 路径。仅用于 source=local/imported。
 */
export function updateLocalSkillFile(oldPath: string, name: string, description: string, content: string): string {
  const fp = writeLocalSkillFile(name, description, content);
  if (fp !== oldPath) {
    const oldDir = path.dirname(oldPath);
    if (oldDir.startsWith(SKILLS_DIR)) {
      try { fs.rmSync(oldDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
  return fp;
}

/** 删除本地技能文件及其目录（仅用于 source=local/imported） */
export function removeSkillFile(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return;
    if (!filePath.startsWith(SKILLS_DIR)) return; // 安全护栏：只允许删本地目录
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/** 扫描 WorkBuddy 技能目录，返回可导入的元数据（只读，不复制文件） */
export function listWorkbuddySkills(): { name: string; description: string; path: string }[] {
  const out: { name: string; description: string; path: string }[] = [];
  try {
    if (!fs.existsSync(WORKBUDDY_SKILLS_DIR)) return out;
    for (const entry of fs.readdirSync(WORKBUDDY_SKILLS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const fp = path.join(WORKBUDDY_SKILLS_DIR, entry.name, 'SKILL.md');
      if (!fs.existsSync(fp)) continue;
      const meta = parseSkillMarkdown(fs.readFileSync(fp, 'utf8'));
      out.push({ name: meta.name || entry.name, description: meta.description, path: fp });
    }
  } catch {
    /* ignore */
  }
  return out;
}

/** 把 studentbuddy 技能导出到 WorkBuddy 技能目录（互通：写回 SKILL.md） */
export function exportSkillToWorkbuddy(name: string, description: string, content: string): string {
  const safe = sanitize(name);
  const dir = path.join(WORKBUDDY_SKILLS_DIR, safe);
  ensureDir(dir);
  const fp = path.join(dir, 'SKILL.md');
  fs.writeFileSync(fp, serializeSkillMarkdown({ name: safe, description, content }), 'utf8');
  return fp;
}
