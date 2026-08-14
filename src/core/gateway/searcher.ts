import { searchWeb, fetchPage, formatSearchResults, SearchConfig } from '../search';
import { createLogger } from '../logger';

const log = createLogger('gateway:searcher');

/** 逐项进度上报：每个关键词/URL 完成时回调一次（驱动前端「过程式」实时更新） */
export interface SearchProgress {
  done: number;      // 已完成数量
  total: number;     // 总数
  item: string;      // 当前完成项（关键词 / URL）
  ok: boolean;       // 该项是否成功
  summary: string;   // 该项结果摘要（命中条数 / 失败原因）
}

/** 顺序执行联网搜索，返回合并后的结果文本（失败逐条降级为说明行）。
 *  onProgress：每完成一个关键词回调一次，供调用方 emit step 进度更新。 */
export async function performSearches(queries: string[], config: SearchConfig, onProgress?: (p: SearchProgress) => void): Promise<string> {
  const allLines: string[] = [];
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    try {
      const result = await searchWeb(q, config);
      allLines.push(`搜索 "${q}" 的结果：`);
      allLines.push(formatSearchResults(result));
      allLines.push('');
      onProgress?.({ done: i + 1, total: queries.length, item: q, ok: true, summary: `已搜索「${q}」：${result.results?.length ?? 0} 条结果` });
    } catch (err: any) {
      log.warn({ query: q, error: err.message }, 'Search failed');
      allLines.push(`搜索 "${q}" 失败：${err.message}`);
      onProgress?.({ done: i + 1, total: queries.length, item: q, ok: false, summary: `「${q}」搜索失败：${err.message}` });
    }
  }
  return allLines.join('\n');
}

/** 顺序执行网页抓取，返回合并后的结果文本（失败逐条降级为说明行）。
 *  onProgress：每完成一个 URL 回调一次，供调用方 emit step 进度更新。 */
export async function performFetches(urls: string[], onProgress?: (p: SearchProgress) => void): Promise<string> {
  const allLines: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      const page = await fetchPage(url);
      allLines.push(`页面 "${page.title}" 的内容：`);
      allLines.push(page.text.slice(0, 3000));
      allLines.push('');
      onProgress?.({ done: i + 1, total: urls.length, item: url, ok: true, summary: `已抓取「${page.title || url}」` });
    } catch (err: any) {
      log.warn({ url, error: err.message }, 'Fetch failed');
      allLines.push(`获取 ${url} 失败：${err.message}`);
      onProgress?.({ done: i + 1, total: urls.length, item: url, ok: false, summary: `抓取 ${url} 失败：${err.message}` });
    }
  }
  return allLines.join('\n');
}