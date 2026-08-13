import { Router, Request, Response } from 'express';
import { getDb } from '../../core/gateway/db';
import {
  writeLocalSkillFile,
  readSkillFile,
  updateLocalSkillFile,
  listWorkbuddySkills,
  removeSkillFile,
  exportSkillToWorkbuddy,
} from '../../core/skills';
import crypto from 'node:crypto';

/** 注册技能路由（Skills，与 WorkBuddy 文件格式互通） */
export function registerSkills(r: Router): void {
  // 列表（不含正文，减负）：id/name/description/enabled/source/created_at
  r.get('/skills', (_req: Request, res: Response) => {
    try {
      const list = getDb().prepare(
        'SELECT id,name,description,enabled,source,created_at FROM skills ORDER BY name',
      ).all();
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 详情 + 正文（按 path 读 SKILL.md）
  r.get('/skills/:id', (req: Request, res: Response) => {
    try {
      const s = getDb().prepare('SELECT * FROM skills WHERE id=?').get(req.params.id) as any;
      if (!s) return res.status(404).json({ error: 'not found' });
      const meta = readSkillFile(s.path);
      res.json({ ...s, content: meta?.content || '' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 新建（写 DB + 落本地 SKILL.md，source=local）
  r.post('/skills', (req: Request, res: Response) => {
    try {
      const { name, description, content } = req.body || {};
      if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name 必填' });
      const safeName = name.trim().slice(0, 80);
      const desc = (typeof description === 'string' ? description : '').slice(0, 500);
      const body = typeof content === 'string' ? content : '';
      const fp = writeLocalSkillFile(safeName, desc, body);
      const id = `sk-${crypto.randomUUID()}`;
      getDb().prepare("INSERT INTO skills (id,name,description,path,enabled,source) VALUES (?,?,?,?,1,'local')")
        .run(id, safeName, desc, fp);
      res.json({ id, name: safeName, description: desc, path: fp, enabled: 1, source: 'local' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 更新（改名/描述/正文/启停）
  r.put('/skills/:id', (req: Request, res: Response) => {
    try {
      const s = getDb().prepare('SELECT * FROM skills WHERE id=?').get(req.params.id) as any;
      if (!s) return res.status(404).json({ error: 'not found' });
      const { name, description, content, enabled } = req.body || {};
      const newName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : s.name;
      const newDesc = typeof description === 'string' ? description.slice(0, 500) : s.description;
      const newEnabled = typeof enabled === 'number' ? (enabled ? 1 : 0) : s.enabled;

      if (s.source === 'workbuddy') {
        // 只读引用：不覆盖 WorkBuddy 原文件。若用户改了正文 → 派生为本地 imported 副本。
        if (typeof content === 'string' && content !== (readSkillFile(s.path)?.content || '')) {
          const fp = writeLocalSkillFile(newName, newDesc, content);
          getDb().prepare("UPDATE skills SET name=?,description=?,path=?,enabled=?,source='imported' WHERE id=?")
            .run(newName, newDesc, fp, newEnabled, req.params.id);
          return res.json({ id: req.params.id, name: newName, description: newDesc, enabled: newEnabled, source: 'imported', forked: true });
        }
        getDb().prepare('UPDATE skills SET name=?,description=?,enabled=? WHERE id=?')
          .run(newName, newDesc, newEnabled, req.params.id);
        return res.json({ id: req.params.id, name: newName, description: newDesc, enabled: newEnabled, source: 'workbuddy' });
      }

      // local / imported：正文落盘（改名时重写到新目录并清理旧目录）
      if (typeof content === 'string') {
        const fp = updateLocalSkillFile(s.path, newName, newDesc, content);
        getDb().prepare("UPDATE skills SET name=?,description=?,path=?,enabled=? WHERE id=?")
          .run(newName, newDesc, fp, newEnabled, req.params.id);
      } else {
        getDb().prepare('UPDATE skills SET name=?,description=?,enabled=? WHERE id=?')
          .run(newName, newDesc, newEnabled, req.params.id);
      }
      res.json({ id: req.params.id, name: newName, description: newDesc, enabled: newEnabled, source: s.source });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 删除：local/imported 删 DB + 删本地文件；workbuddy 只删 DB 行（保留原文件）
  r.delete('/skills/:id', (req: Request, res: Response) => {
    try {
      const s = getDb().prepare('SELECT * FROM skills WHERE id=?').get(req.params.id) as any;
      if (!s) return res.status(404).json({ error: 'not found' });
      if (s.source !== 'workbuddy') removeSkillFile(s.path);
      getDb().prepare('DELETE FROM skills WHERE id=?').run(req.params.id);
      res.json({ id: req.params.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 从 WorkBuddy 一键导入：扫描 ~/.workbuddy/skills，登记进 DB（source=workbuddy，默认禁用）
  r.post('/skills/import', (_req: Request, res: Response) => {
    try {
      const wb = listWorkbuddySkills();
      const db = getDb();
      let added = 0;
      let skipped = 0;
      for (const m of wb) {
        const exists = db.prepare('SELECT id FROM skills WHERE path=?').get(m.path);
        if (exists) { skipped++; continue; }
        const id = `sk-${crypto.randomUUID()}`;
        db.prepare("INSERT INTO skills (id,name,description,path,enabled,source) VALUES (?,?,?,?,0,'workbuddy')")
          .run(id, m.name, m.description, m.path);
        added++;
      }
      res.json({ added, skipped, total: wb.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 导出到 WorkBuddy：把 studentbuddy 技能写成 ~/.workbuddy/skills/<name>/SKILL.md
  r.post('/skills/:id/export', (req: Request, res: Response) => {
    try {
      const s = getDb().prepare('SELECT * FROM skills WHERE id=?').get(req.params.id) as any;
      if (!s) return res.status(404).json({ error: 'not found' });
      const meta = readSkillFile(s.path);
      if (!meta) return res.status(404).json({ error: 'skill 文件不存在' });
      const target = exportSkillToWorkbuddy(meta.name, meta.description, meta.content);
      res.json({ ok: true, path: target });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
