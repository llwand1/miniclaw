import { getDb } from './db';
import { AgentEngine, AgentConfig, ProviderConfig } from '../agent';
import { ChatMessage } from '../adapter/types';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../logger';
import { EventEmitter } from 'node:events';
import { searchWeb, fetchPage, formatSearchResults, SearchConfig } from '../search';

const log = createLogger('gateway');

export interface InboundMessage {
  source: 'main' | 'floating';
  sessionId?: string;
  text: string;
  ts?: Date;
  temperature?: number;
}

function trimMarkers(text: string): string {
  return text.replace(/\[SEARCH:[^\]]*\]/g, '').replace(/\[FETCH:[^\]]*\]/g, '').trim();
}

export class Gateway extends EventEmitter {
  private engine = new AgentEngine();

  async start(): Promise<void> {
    log.info('Gateway started');
  }

  getDefaultProvider(): ProviderConfig | null {
    const db = getDb();
    const p = db.prepare('SELECT * FROM providers LIMIT 1').get() as any;
    if (!p) return null;
    return { id: p.id, type: p.type, name: p.name, baseUrl: p.base_url, apiKey: p.api_key, defaultModel: p.default_model, enabled: !!p.enabled };
  }

  private getSearchConfig(): SearchConfig {
    const db = getDb();
    const row = db.prepare('SELECT * FROM search_config WHERE id = 1').get() as any;
    if (!row) return { enabled: false, provider: 'duckduckgo', customApiUrl: '', customApiKey: '' };
    return { enabled: !!row.enabled, provider: row.provider, customApiUrl: row.custom_api_url, customApiKey: row.custom_api_key };
  }

  private extractSearchQueries(text: string): string[] {
    const queries: string[] = [];
    const regex = /\[SEARCH:(.+?)\]/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const q = m[1].trim();
      if (q) queries.push(q);
    }
    return queries;
  }

  private extractUrls(text: string): string[] {
    const urls: string[] = [];
    const regex = /\[FETCH:(https?:\/\/[^\]]+?)\]/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const url = m[1].trim();
      if (url) urls.push(url);
    }
    return urls;
  }

  private async performSearches(queries: string[], config: SearchConfig): Promise<string> {
    const allLines: string[] = [];
    for (const q of queries) {
      try {
        const result = await searchWeb(q, config);
        allLines.push(`搜索 "${q}" 的结果：`);
        allLines.push(formatSearchResults(result));
        allLines.push('');
      } catch (err: any) {
        log.warn({ query: q, error: err.message }, 'Search failed');
        allLines.push(`搜索 "${q}" 失败：${err.message}`);
      }
    }
    return allLines.join('\n');
  }

  private async performFetches(urls: string[]): Promise<string> {
    const allLines: string[] = [];
    for (const url of urls) {
      try {
        const page = await fetchPage(url);
        allLines.push(`页面 "${page.title}" 的内容：`);
        allLines.push(page.text.slice(0, 3000));
        allLines.push('');
      } catch (err: any) {
        log.warn({ url, error: err.message }, 'Fetch failed');
        allLines.push(`获取 ${url} 失败：${err.message}`);
      }
    }
    return allLines.join('\n');
  }

  private getMemories(): { content: string; category: string }[] {
    return getDb().prepare('SELECT content, category FROM memories ORDER BY category ASC, created_at ASC').all() as any[];
  }

  private buildSystemPrompt(): string {
    const searchEnabled = this.getSearchConfig().enabled;
    const lines: string[] = ['你是一个有用的AI助手。请用中文回答。'];

    if (searchEnabled) {
      lines.push('', '当需要获取最新信息时，在回答中插入 [SEARCH:查询关键词] 来搜索网络。');
      lines.push('当用户要求访问某个网页时，用 [FETCH:网页URL] 获取内容。');
      lines.push('我会先搜索获取信息，再让你基于搜索结果生成最终回答。');
    }

    const memories = this.getMemories();
    const longTerm = memories.filter(m => m.category === 'A');
    if (longTerm.length > 0) {
      lines.push('', '=== 关于用户的重要信息 ===');
      longTerm.forEach(m => lines.push(`- ${m.content}`));
    }

    const shortTerm = memories.filter(m => m.category === 'B');
    if (shortTerm.length > 0) {
      lines.push('', '=== 用户近期关注 ===');
      shortTerm.forEach(m => lines.push(`- ${m.content}`));
    }

    return lines.join('\n');
  }

  /** Generate a response from the AI (collects full text, doesn't stream) */
  private async generateOnce(provider: ProviderConfig, agent: AgentConfig, messages: ChatMessage[], temperature?: number): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
    let text = '';
    let pt = 0;
    let ct = 0;
    for await (const chunk of this.engine.chat(provider, agent, messages, temperature)) {
      text += chunk.content;
      if (chunk.usage) { pt = chunk.usage.promptTokens; ct = chunk.usage.completionTokens; }
    }
    return { text, promptTokens: pt, completionTokens: ct };
  }

  private extractMemos(text: string): { content: string; category: 'A' | 'B' }[] {
    const memos: { content: string; category: 'A' | 'B' }[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      const match = trimmed.match(/^\[MEMO:(.+?)\|([AB])\]$/);
      if (match) {
        const content = match[1].trim();
        const cat = match[2].trim();
        if (content && (cat === 'A' || cat === 'B')) {
          memos.push({ content, category: cat });
        }
      }
    }
    return memos;
  }

  private async summarizeMemories(provider: ProviderConfig, history: ChatMessage[]): Promise<void> {
    const sumPrompt = '仅根据以上对话，提取值得记住的用户信息（名字、偏好、习惯、当前关注等）。有就按格式输出，一条一行。没有值得记的内容就输出 NONE。\n格式：\n[MEMO:内容|A]\nA=长期重要（身份/偏好/习惯），B=短期重要（当前话题/需求）。';
    const sumHistory: ChatMessage[] = [{ role: 'system', content: sumPrompt }, ...history.slice(-4)];
    const sumAgent: AgentConfig = { id: 'default', name: '助手', role: 'assistant', providerId: provider.id, model: provider.defaultModel, systemPrompt: '', enabled: true };
    const { text } = await this.generateOnce(provider, sumAgent, sumHistory);
    const memos = this.extractMemos(text);
    for (const memo of memos) {
      this.saveMemo(memo.content, memo.category);
      log.info({ content: memo.content, category: memo.category }, 'Memory saved via summarization');
    }
  }

  private saveMemo(content: string, category: string): void {
    category = category.trim();
    if (!content || (category !== 'A' && category !== 'B')) return;
    const db = getDb();
    const existing = db.prepare('SELECT id, category FROM memories WHERE content = ?').get(content) as any;
    if (existing) {
      if (existing.category !== category) {
        db.prepare('UPDATE memories SET category = ?, created_at = datetime("now") WHERE id = ?').run(category, existing.id);
      }
      return;
    }
    const count = (db.prepare('SELECT COUNT(*) AS c FROM memories WHERE category = ?').get(category) as any).c;
    const limit = category === 'A' ? 15 : 10;
    if (count >= limit) {
      db.prepare('DELETE FROM memories WHERE id IN (SELECT id FROM memories WHERE category = ? ORDER BY created_at ASC LIMIT 1)').run(category);
    }
    db.prepare('INSERT INTO memories (content, category) VALUES (?, ?)').run(content, category);
  }

  async handleMessage(inbound: InboundMessage): Promise<string> {
    const provider = this.getDefaultProvider();
    if (!provider) throw new Error('请先在设置页添加 API 服务商');

    const db = getDb();
    const sessionId = inbound.sessionId || uuidv4();
    const isNew = !db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);

    if (isNew) {
      db.prepare('INSERT INTO sessions (id,agent_id,source,title) VALUES (?,?,?,?)').run(sessionId, 'default', inbound.source, inbound.text.slice(0, 50) || '新对话');
    } else {
      db.prepare("UPDATE sessions SET updated_at=datetime('now') WHERE id=?").run(sessionId);
    }

    db.prepare('INSERT INTO messages (session_id,role,content) VALUES (?,?,?)').run(sessionId, 'user', inbound.text);

    const history = db.prepare("SELECT role,content FROM messages WHERE session_id=? ORDER BY ts").all(sessionId) as ChatMessage[];
    const systemPrompt = this.buildSystemPrompt();
    const agent: AgentConfig = { id: 'default', name: '助手', role: 'assistant', providerId: provider.id, model: provider.defaultModel, systemPrompt, enabled: true };

    const searchConfig = this.getSearchConfig();
    const temp = inbound.temperature;

    if (searchConfig.enabled) {
      // Phase 1: Collect response internally to check for SEARCH/FETCH intent
      const { text: phase1, promptTokens: pt1, completionTokens: ct1 } = await this.generateOnce(provider, agent, history, temp);

      const searchQueries = this.extractSearchQueries(phase1);
      const fetchUrls = this.extractUrls(phase1);

      if (searchQueries.length > 0 || fetchUrls.length > 0) {
        this.emit('token', { sessionId, content: '[正在联网搜索...]\n\n', done: false });

        const searchResults: string[] = [];
        if (searchQueries.length > 0) {
          searchResults.push(await this.performSearches(searchQueries, searchConfig));
        }
        if (fetchUrls.length > 0) {
          searchResults.push(await this.performFetches(fetchUrls));
        }

        const searchContext = searchResults.join('\n').slice(0, 10000);
        const searchHistory: ChatMessage[] = [
          ...history,
          { role: 'assistant', content: trimMarkers(phase1) },
          { role: 'system', content: `以下是联网搜索到的信息，请基于这些内容回答用户问题：\n\n${searchContext}` },
        ];

        let finalText = '';
        let finalPt = 0;
        let finalCt = 0;
        for await (const chunk of this.engine.chat(provider, agent, searchHistory, temp)) {
          finalText += chunk.content;
          if (chunk.usage) { finalPt = chunk.usage.promptTokens; finalCt = chunk.usage.completionTokens; }
          this.emit('token', { sessionId, content: chunk.content, done: false });
        }

        const cleaned = trimMarkers(finalText);
        db.prepare("INSERT INTO messages (session_id,role,content,tokens) VALUES (?,'assistant',?,?)").run(sessionId, cleaned, finalCt);
        db.prepare('INSERT INTO token_usage (agent_id,provider_id,model,prompt_tokens,completion_tokens) VALUES (?,?,?,?,?)').run(agent.id, provider.id, agent.model, pt1 + finalPt, ct1 + finalCt);
        this.emit('token', { sessionId, content: '', done: true });

        this.extractMemories(history, cleaned);
        return sessionId;
      }

      // No search needed: stream phase1 result
      const cleaned = trimMarkers(phase1);
      const CHUNK_SIZE = 3;
      for (let i = 0; i < cleaned.length; i += CHUNK_SIZE) {
        this.emit('token', { sessionId, content: cleaned.slice(i, i + CHUNK_SIZE), done: false });
      }
      db.prepare("INSERT INTO messages (session_id,role,content,tokens) VALUES (?,'assistant',?,?)").run(sessionId, cleaned, ct1);
      db.prepare('INSERT INTO token_usage (agent_id,provider_id,model,prompt_tokens,completion_tokens) VALUES (?,?,?,?,?)').run(agent.id, provider.id, agent.model, pt1, ct1);
      this.emit('token', { sessionId, content: '', done: true });

      this.extractMemories(history, cleaned);
      return sessionId;
    }

    // Search disabled: stream directly
    let full = '';
    let promptTokens = 0;
    let completionTokens = 0;
    for await (const chunk of this.engine.chat(provider, agent, history, temp)) {
      full += chunk.content;
      if (chunk.usage) { promptTokens = chunk.usage.promptTokens; completionTokens = chunk.usage.completionTokens; }
      this.emit('token', { sessionId, content: chunk.content, done: chunk.done });
      if (chunk.done) break;
    }

    db.prepare("INSERT INTO messages (session_id,role,content,tokens) VALUES (?,'assistant',?,?)").run(sessionId, full, completionTokens);
    db.prepare('INSERT INTO token_usage (agent_id,provider_id,model,prompt_tokens,completion_tokens) VALUES (?,?,?,?,?)').run(agent.id, provider.id, agent.model, promptTokens, completionTokens);

    this.emit('token', { sessionId, content: '', done: true });

    this.extractMemories(history, full);
    return sessionId;
  }

  private extractMemories(history: ChatMessage[], reply: string): void {
    const provider = this.getDefaultProvider();
    if (!provider) return;
    const memos = this.extractMemos(reply);
    if (memos.length > 0) {
      for (const memo of memos) {
        this.saveMemo(memo.content, memo.category);
        log.info({ content: memo.content, category: memo.category }, 'Memory saved from reply');
      }
    } else {
      try {
        const sumHistory = [...history, { role: 'assistant' as const, content: reply }];
        this.summarizeMemories(provider, sumHistory).catch((err: any) => log.warn({ error: err.message }, 'Memory summarization failed'));
      } catch {}
    }
  }

  async stop(): Promise<void> {
    this.removeAllListeners();
    log.info('Gateway stopped');
  }
}
