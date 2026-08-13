import { searchWeb, fetchPage, formatSearchResults, SearchConfig } from '../search';
import { createLogger } from '../logger';

const log = createLogger('gateway:searcher');

/** 顺序执行联网搜索，返回合并后的结果文本（失败逐条降级为说明行） */
export async function performSearches(queries: string[], config: SearchConfig): Promise<string> {
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

/** 顺序执行网页抓取，返回合并后的结果文本（失败逐条降级为说明行） */
export async function performFetches(urls: string[]): Promise<string> {
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