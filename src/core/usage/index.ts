import { getDb } from '../gateway/db';
import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import { createLogger } from '../logger';

const log = createLogger('usage');

const DEFAULT_CC_SWITCH_DB = path.join(os.homedir(), '.cc-switch', 'cc-switch.db');

export type Period = 'today' | '7d' | '30d' | 'all';

export interface UsageRow {
  providerId: string;
  providerName: string;
  model: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}
export interface UsageTotals {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

// ─── cc-switch helpers ────────────────────────────────────────────────

function openCcSwitch(dbPath: string): Database.Database {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function readPricingMap(dbPath: string): Map<string, { in: number; out: number }> {
  const m = new Map<string, { in: number; out: number }>();
  try {
    const db = openCcSwitch(dbPath);
    const rows = db.prepare('SELECT model_id, input_cost_per_million, output_cost_per_million FROM model_pricing').all() as any[];
    for (const r of rows) m.set(r.model_id, { in: parseFloat(r.input_cost_per_million) || 0, out: parseFloat(r.output_cost_per_million) || 0 });
    db.close();
  } catch { /* ignore */ }
  return m;
}

function readProviderNameMap(dbPath: string): Map<string, string> {
  const m = new Map<string, string>();
  try {
    const db = openCcSwitch(dbPath);
    const rows = db.prepare("SELECT id, app_type, name FROM providers WHERE name != 'default'").all() as any[];
    for (const r of rows) {
      const k = r.id + '|' + r.app_type;
      if (!m.has(k)) m.set(k, r.name);
    }
    db.close();
  } catch { /* ignore */ }
  return m;
}

// ─── MiniClaw 自身用量 ───────────────────────────────────────────────

export function getOwnUsageStats(dbPath: string, period: Period): { rows: UsageRow[]; totals: UsageTotals } {
  const db = getDb();
  const cond = period === 'today' ? "WHERE t.ts >= datetime('now','start of day')"
    : period === '7d' ? "WHERE t.ts >= datetime('now','-7 days')"
    : period === '30d' ? "WHERE t.ts >= datetime('now','-30 days')" : '';
  const rows = db.prepare(
    `SELECT t.provider_id AS providerId, COALESCE(p.name,'未知') AS providerName,
      COALESCE(t.model,'') AS model, COUNT(*) AS requests,
      COALESCE(SUM(t.prompt_tokens),0) AS promptTokens,
      COALESCE(SUM(t.completion_tokens),0) AS completionTokens
     FROM token_usage t LEFT JOIN providers p ON p.id=t.provider_id ${cond}
     GROUP BY t.provider_id, t.model ORDER BY requests DESC`
  ).all() as any[];
  const pricing = readPricingMap(dbPath);
  const mapped: UsageRow[] = rows.map(r => {
    const pr = pricing.get(r.model);
    const cost = pr ? ((r.promptTokens || 0) * pr.in + (r.completionTokens || 0) * pr.out) / 1e6 : 0;
    return { providerId: r.providerId, providerName: r.providerName, model: r.model, requests: r.requests, promptTokens: r.promptTokens, completionTokens: r.completionTokens, totalTokens: (r.promptTokens || 0) + (r.completionTokens || 0), costUsd: Math.round(cost * 1e6) / 1e6 };
  });
  const totals = mapped.reduce<UsageTotals>((a, r) => ({ requests: a.requests + r.requests, promptTokens: a.promptTokens + r.promptTokens, completionTokens: a.completionTokens + r.completionTokens, totalTokens: a.totalTokens + r.totalTokens, costUsd: a.costUsd + r.costUsd }), { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 });
  return { rows: mapped, totals: { ...totals, costUsd: Math.round(totals.costUsd * 1e6) / 1e6 } };
}

// ─── cc-switch 用量（读 rollups）───────────────────────────────────────

export interface CcSwitchRow {
  appType: string;
  providerId: string;
  providerName: string;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}
export interface CcSwitchUsage {
  available: boolean;
  dbPath: string;
  error?: string;
  rows: CcSwitchRow[];
  totals: { requests: number; inputTokens: number; outputTokens: number; costUsd: number };
  lastUsageDate?: string;
}

export function getCcSwitchUsage(dbPath: string): CcSwitchUsage {
  const empty: CcSwitchUsage = { available: false, dbPath, rows: [], totals: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 } };
  let db: Database.Database | null = null;
  try { db = openCcSwitch(dbPath); } catch (e: any) { return { ...empty, error: e.message }; }
  try {
    const nameMap = readProviderNameMap(dbPath);
    const rollups = db.prepare('SELECT date, app_type, provider_id, model, request_count, input_tokens, output_tokens, cache_read_tokens, total_cost_usd FROM usage_daily_rollups').all() as any[];
    const map = new Map<string, CcSwitchRow>();
    let lastDate = '';
    for (const r of rollups) {
      if (r.date > lastDate) lastDate = r.date;
      const k = r.app_type + '\u0000' + r.provider_id + '\u0000' + r.model;
      const cur = map.get(k) || { appType: r.app_type, providerId: r.provider_id, providerName: nameMap.get(r.provider_id + '|' + r.app_type) || r.provider_id, model: r.model, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 };
      cur.requests += r.request_count || 0;
      cur.inputTokens += r.input_tokens || 0;
      cur.outputTokens += r.output_tokens || 0;
      cur.cacheReadTokens += r.cache_read_tokens || 0;
      cur.costUsd += parseFloat(r.total_cost_usd) || 0;
      map.set(k, cur);
    }
    // 如果 rollups 为空（刚安装或清过），回退到 proxy_request_logs 采样
    if (map.size === 0) {
      const logs = db.prepare('SELECT provider_id, app_type, model, SUM(input_tokens) input_tokens, SUM(output_tokens) output_tokens, SUM(cache_read_tokens) cache_read_tokens, COUNT(*) requests, SUM(CAST(total_cost_usd AS REAL)) total_cost_usd FROM proxy_request_logs GROUP BY provider_id, app_type, model ORDER BY SUM(input_tokens) DESC LIMIT 100').all() as any[];
      for (const r of logs) {
        const k = r.app_type + '\u0000' + r.provider_id + '\u0000' + r.model;
        map.set(k, { appType: r.app_type, providerId: r.provider_id, providerName: nameMap.get(r.provider_id + '|' + r.app_type) || r.provider_id, model: r.model, requests: r.requests, inputTokens: r.input_tokens || 0, outputTokens: r.output_tokens || 0, cacheReadTokens: r.cache_read_tokens || 0, costUsd: Math.round((r.total_cost_usd || 0) * 1e6) / 1e6 });
      }
    }
    const rows = [...map.values()].sort((a, b) => b.costUsd - a.costUsd || b.inputTokens - a.inputTokens);
    rows.forEach(r => r.costUsd = Math.round(r.costUsd * 1e6) / 1e6);
    const totals = rows.reduce((a, r) => ({ requests: a.requests + r.requests, inputTokens: a.inputTokens + r.inputTokens, outputTokens: a.outputTokens + r.outputTokens, costUsd: a.costUsd + r.costUsd }), { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
    return { available: true, dbPath, rows, totals: { ...totals, costUsd: Math.round(totals.costUsd * 1e6) / 1e6 }, lastUsageDate: lastDate || undefined };
  } catch (e: any) {
    return { ...empty, error: e.message };
  } finally {
    if (db) db.close();
  }
}

// ─── 从 cc-switch 同步服务商到 MiniClaw ─────────────────────────────

export interface SyncResult {
  added: { name: string; type: string }[];
  skipped: string[];
  error?: string;
}

export function syncCcSwitchProviders(dbPath: string): SyncResult {
  const installed = new Set((getDb().prepare('SELECT name FROM providers').all() as any[]).map((r: any) => r.name));
  const added: { name: string; type: string }[] = [];
  const skipped: string[] = [];
  let db: Database.Database | null = null;
  try { db = openCcSwitch(dbPath); } catch (e: any) { return { added, skipped, error: e.message }; }
  try {
    const provs = db.prepare("SELECT id, app_type, name, settings_config FROM providers WHERE app_type IN ('opencode','claude') AND name NOT IN ('default','Claude Official','Claude Desktop Official','OpenAI Official','Google Official')").all() as any[];
    const insert = getDb().prepare('INSERT INTO providers (id, type, name, base_url, api_key, default_model) VALUES (?,?,?,?,?,?)');
    for (const p of provs) {
      if (installed.has(p.name)) { skipped.push(p.name); continue; }
      let baseUrl = '', apiKey = '', type = 'openai', defaultModel = '';
      try {
        const cfg = JSON.parse(p.settings_config || '{}');
        if (p.app_type === 'opencode') {
          baseUrl = cfg?.options?.baseURL || '';
          apiKey = cfg?.options?.apiKey || '';
          type = 'openai';
        } else if (p.app_type === 'claude') {
          baseUrl = cfg?.env?.ANTHROPIC_BASE_URL || '';
          apiKey = cfg?.env?.ANTHROPIC_AUTH_TOKEN || '';
          type = 'anthropic';
        }
      } catch { /* skip */ }
      if (!baseUrl && !apiKey) { skipped.push(p.name); continue; }
      const id = 'cc-' + p.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) + '-' + Date.now().toString(36);
      insert.run(id, type, p.name, baseUrl, apiKey, defaultModel);
      added.push({ name: p.name, type });
    }
    return { added, skipped };
  } catch (e: any) {
    return { added, skipped, error: e.message };
  } finally {
    if (db) db.close();
  }
}

// ─── 导出给 gateway 使用的路径读写 ──────────────────────────────────

export function getCcSwitchDbPath(): string {
  const row = getDb().prepare("SELECT value FROM app_settings WHERE key='cc_switch_db'").get() as any;
  return row?.value || DEFAULT_CC_SWITCH_DB;
}

export function setCcSwitchDbPath(p: string): void {
  getDb().prepare("INSERT INTO app_settings (key,value) VALUES ('cc_switch_db',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')").run(p || DEFAULT_CC_SWITCH_DB);
}
