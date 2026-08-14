import { SearchResult, SearchResponse, FetchedPage, SearchConfig } from './types';
import { createLogger } from '../logger';
import { pythonSearchBridge } from './python-bridge';

export type { SearchConfig };

const log = createLogger('search');

function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function duckduckgoSearch(query: string): Promise<SearchResponse> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  log.info({ query }, 'DuckDuckGo search');
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) studentbuddy/0.1.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`DuckDuckGo API error: ${res.status}`);
  const data = await res.json() as any;
  const results: SearchResult[] = [];
  if (data.AbstractText) {
    results.push({ title: data.Headline || 'Abstract', url: data.AbstractURL || '', snippet: data.AbstractText });
  }
  if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
    for (const topic of data.RelatedTopics) {
      if (topic.Text) {
        results.push({ title: topic.FirstURL || '', url: topic.FirstURL || '', snippet: topic.Text });
      }
      if (topic.Topics && Array.isArray(topic.Topics)) {
        for (const sub of topic.Topics) {
          if (sub.Text) results.push({ title: sub.FirstURL || '', url: sub.FirstURL || '', snippet: sub.Text });
        }
      }
    }
  }
  return { results, abstract: data.Abstract, source: 'duckduckgo' };
}

async function duckduckgoLiteSearch(query: string): Promise<SearchResponse> {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  log.info({ query }, 'DuckDuckGo Lite search');
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) studentbuddy/0.1.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`DuckDuckGo Lite error: ${res.status}`);
  const html = await res.text();
  const results: SearchResult[] = [];
  const linkRegex = /<a[^>]+href="([^"]*)"[^>]*class="result-link"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
  const links: string[] = [];
  const titles: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(html)) !== null) {
    links.push(m[1]);
    titles.push(htmlToText(m[2]));
  }
  const snippets: string[] = [];
  while ((m = snippetRegex.exec(html)) !== null) {
    snippets.push(htmlToText(m[1]));
  }
  for (let i = 0; i < Math.min(links.length, 8); i++) {
    results.push({ title: titles[i] || '', url: links[i], snippet: snippets[i] || '' });
  }
  if (results.length === 0) {
    const allLinks: string[] = [];
    const allLinkRegex = /<a[^>]+href="((?:https?:\/\/)[^"]+)"[^>]*>/gi;
    while ((m = allLinkRegex.exec(html)) !== null) {
      if (!allLinks.includes(m[1])) allLinks.push(m[1]);
    }
    for (let i = 0; i < Math.min(allLinks.length, 5); i++) {
      results.push({ title: allLinks[i], url: allLinks[i], snippet: '' });
    }
  }
  return { results, source: 'duckduckgo-lite' };
}

export async function searchWeb(query: string, config?: SearchConfig): Promise<SearchResponse> {
  // 优先走 Python 强化服务（Bing/百度/DDG 多源并发 + 代理 + 重试），失败自动降级原实现
  try {
    const py = await pythonSearchBridge.search(query);
    if (py.results.length > 0) return py;
    log.warn('py-search 返回空结果，降级 Node 直连');
  } catch (err: any) {
    log.warn({ error: err.message }, 'py-search search 失败，降级 Node 直连');
  }
  const errors: string[] = [];
  try {
    return await duckduckgoSearch(query);
  } catch (err: any) {
    errors.push(`instant-answer: ${err.message}`);
  }
  try {
    return await duckduckgoLiteSearch(query);
  } catch (err: any) {
    errors.push(`lite: ${err.message}`);
  }
  if (config?.enabled && config.provider === 'custom' && config.customApiUrl) {
    try {
      log.info({ url: config.customApiUrl }, 'Custom search');
      const res = await fetch(config.customApiUrl.replace('{q}', encodeURIComponent(query)), {
        headers: config.customApiKey ? { Authorization: `Bearer ${config.customApiKey}` } : {},
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json() as any;
        const results: SearchResult[] = (data.items || data.results || []).slice(0, 8).map((item: any) => ({
          title: item.title || item.name || '',
          url: item.link || item.url || '',
          snippet: item.snippet || item.description || '',
        }));
        return { results, source: 'custom' };
      }
    } catch (err: any) {
      errors.push(`custom: ${err.message}`);
    }
  }
  throw new Error(`All search backends failed: ${errors.join('; ')}`);
}

export async function fetchPage(url: string): Promise<FetchedPage> {
  log.info({ url }, 'Fetch page');
  // 优先走 Python 强化服务（JS 渲染 + trafilatura 正文提取），失败降级原实现
  try {
    const py = await pythonSearchBridge.fetch(url);
    if (py.text && py.text.trim().length > 0) return py;
    log.warn('py-search fetch 返回空正文，降级 Node 直连');
  } catch (err: any) {
    log.warn({ error: err.message }, 'py-search fetch 失败，降级 Node 直连');
  }
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) studentbuddy/0.1.0' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? htmlToText(titleMatch[1]) : url;
  const text = htmlToText(html).slice(0, 8000);
  return { url, title, text };
}

export function formatSearchResults(response: SearchResponse): string {
  const lines: string[] = [];
  if (response.abstract) lines.push(`摘要：${response.abstract}`);
  for (const r of response.results) {
    lines.push(`- ${r.title} ${r.url}`);
    if (r.snippet) lines.push(`  ${r.snippet}`);
  }
  return lines.join('\n');
}
