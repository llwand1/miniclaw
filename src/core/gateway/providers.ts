import { getDb } from './db';
import { ProviderConfig, AgentEngine } from '../agent';
import { SearchConfig } from '../search';
import { decryptSecret } from '../security/crypto';
import { readSkillFile } from '../skills';
import { createLogger } from '../logger';

const log = createLogger('gateway:providers');

/** 读取启用状态的服务商（默认第一个） */
export function getDefaultProvider(): ProviderConfig | null {
  const db = getDb();
  const p = db.prepare('SELECT * FROM providers WHERE enabled=1 LIMIT 1').get() as any;
  if (!p) return null;
  return { id: p.id, type: p.type, name: p.name, baseUrl: p.base_url, apiKey: decryptSecret(p.api_key), defaultModel: p.default_model, enabled: !!p.enabled };
}

/** 按 id 读取服务商 */
export function getProviderById(id: string): ProviderConfig | null {
  const db = getDb();
  const p = db.prepare('SELECT * FROM providers WHERE id=?').get(id) as any;
  if (!p) return null;
  return { id: p.id, type: p.type, name: p.name, baseUrl: p.base_url, apiKey: decryptSecret(p.api_key), defaultModel: p.default_model, enabled: !!p.enabled };
}

/** 已选择 + 校验后的 provider/model（供前端下拉展示当前选中） */
export function getSelectedModel(): { providerId: string; model: string } | null {
  const db = getDb();
  const row = db.prepare("SELECT value FROM app_settings WHERE key='selected_model'").get() as any;
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as { providerId: string; model: string };
    if (!parsed.providerId || !parsed.model) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setSelectedModel(providerId: string, model: string): void {
  const db = getDb();
  db.prepare("INSERT INTO app_settings (key,value) VALUES ('selected_model',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')")
    .run(JSON.stringify({ providerId, model }));
}

/**
 * 单选当前服务商：同时只能用一个模型，所以同一时刻只允许一个服务商处于启用状态。
 * 启用所选、禁用其它，并把「当前模型」切换到该服务商的默认模型。
 */
export function selectProvider(id: string): void {
  const db = getDb();
  const p = db.prepare('SELECT id, default_model FROM providers WHERE id=?').get(id) as any;
  if (!p) throw new Error('服务商不存在');
  db.transaction(() => {
    db.prepare("UPDATE providers SET enabled=0, updated_at=datetime('now')").run();
    db.prepare("UPDATE providers SET enabled=1, updated_at=datetime('now') WHERE id=?").run(id);
    if (p.default_model) {
      db.prepare("INSERT INTO app_settings (key,value) VALUES ('selected_model',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')")
        .run(JSON.stringify({ providerId: id, model: p.default_model }));
    }
  })();
  log.info({ providerId: id }, 'Provider selected as current');
}

/** 列出所有启用服务商的可用模型（供模型切换下拉，opencode/workbuddy 风） */
export async function listModelOptions(engine: AgentEngine): Promise<{
  providerId: string;
  providerName: string;
  type: string;
  defaultModel: string;
  models: string[];
}[]> {
  const db = getDb();
  const providers = db.prepare('SELECT * FROM providers WHERE enabled=1 ORDER BY created_at ASC').all() as any[];
  const out: { providerId: string; providerName: string; type: string; defaultModel: string; models: string[] }[] = [];
  for (const p of providers) {
    const provider: ProviderConfig = { id: p.id, type: p.type, name: p.name, baseUrl: p.base_url, apiKey: decryptSecret(p.api_key), defaultModel: p.default_model, enabled: !!p.enabled };
    const models = await engine.listModels(provider).catch(() => [provider.defaultModel]);
    out.push({ providerId: p.id, providerName: p.name, type: p.type, defaultModel: p.default_model, models });
  }
  return out;
}

/** 联网搜索开关与提供方配置 */
export function getSearchConfig(): SearchConfig {
  const db = getDb();
  const row = db.prepare('SELECT * FROM search_config WHERE id = 1').get() as any;
  if (!row) return { enabled: false, provider: 'duckduckgo', customApiUrl: '', customApiKey: '' };
  return { enabled: !!row.enabled, provider: row.provider, customApiUrl: row.custom_api_url, customApiKey: row.custom_api_key };
}

/** 用户自定义系统提示词（设置页可编辑；空则用内置默认） */
export function getCustomSystemPrompt(): string {
  const db = getDb();
  const row = db.prepare("SELECT value FROM app_settings WHERE key='system_prompt'").get() as any;
  return row?.value || '';
}

export function setCustomSystemPrompt(content: string): void {
  const db = getDb();
  db.prepare("INSERT INTO app_settings (key,value) VALUES ('system_prompt',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')")
    .run(content);
}

/** 返回当前已启用的技能清单（名称/描述/路径），供目录注入与按需加载共用 */
export function getEnabledSkills(): { name: string; description: string; path: string }[] {
  try {
    return getDb().prepare('SELECT name,description,path FROM skills WHERE enabled=1').all() as any[];
  } catch {
    return [];
  }
}

/** 按名称按需加载技能正文（懒加载），返回拼接后的指引文本。
 *  解析范围覆盖全部技能（含未启用），以便前端手动勾选的技能即使未启用也能强制注入。 */
export function loadSkillBodies(names: string[]): string {
  if (names.length === 0) return '';
  let all: any[] = [];
  try {
    all = getDb().prepare('SELECT name,description,path FROM skills').all() as any[];
  } catch {
    return '';
  }
  const blocks: string[] = [];
  for (const n of names) {
    const sk = all.find(e => e.name.toLowerCase() === n.toLowerCase());
    if (!sk) continue;
    const meta = readSkillFile(sk.path);
    if (!meta || !meta.content) continue;
    blocks.push(`### 技能指引：${sk.name}\n${meta.content}`);
  }
  return blocks.join('\n\n');
}