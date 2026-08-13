/**
 * core/upload —— 用户文件上传存储 + 文本提取。
 *
 * 纯 Web 形态下浏览器拿不到本地路径,大文件/二进制只能先传到服务端暂存,
 * 再以 path 模式注入 AI(复用 prompts.ts 的附件注入链路)。
 *
 * 设计:
 * - 文件保存到 DATA_DIR/uploads/ 下(uuid 重命名,防路径穿越/重名覆盖)。
 * - 上传后按扩展名同步提取纯文本,写到同目录伴生 `<uuid>.txt`,
 *   供 buildAttachmentContext 优先读取(避免把 PDF/DOCX 二进制塞进上下文)。
 * - 扩展名黑名单与安全策略一致(可执行/脚本文件禁止上传)。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './gateway/db';
import { createLogger } from './logger';
import { getPolicy } from './security/policy';

const log = createLogger('upload');

/** 单文件上传大小上限(50MB,学习资料 PDF/PPT 常见量级)。 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** 提取文本字符上限(与 prompts.ts MAX_TOTAL 呼应,防爆上下文)。 */
export const MAX_EXTRACT_CHARS = 200_000;

export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

/** 上传文件保存后的元信息 */
export interface UploadedFile {
  /** 原始文件名(展示用) */
  name: string;
  /** 保存的绝对路径 */
  storedPath: string;
  /** 文件字节数 */
  size: number;
  /** 小写扩展名(不含点,无扩展名为空串) */
  ext: string;
  /** 提取文本伴生文件绝对路径(.txt);提取成功才有 */
  textPath?: string;
}

/** 确保上传目录存在 */
export function ensureUploadsDir(): void {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/** 提取扩展名(小写,不含点) */
function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/**
 * 保存上传文件(同步落盘),再异步提取文本并写伴生 .txt。
 * 扩展名命中安全策略黑名单直接抛错。
 */
export function saveUpload(buffer: Buffer, originalName: string): UploadedFile {
  ensureUploadsDir();
  const ext = extOf(originalName);
  const policy = getPolicy();
  if (ext && policy.extensionBlocklist.includes(ext)) {
    throw new Error(`扩展名 .${ext} 在黑名单中,禁止上传`);
  }
  const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const storedName = `${id}${ext ? '.' + ext : ''}`;
  const storedPath = path.join(UPLOADS_DIR, storedName);
  fs.writeFileSync(storedPath, buffer);

  const result: UploadedFile = { name: originalName, storedPath, size: buffer.length, ext };
  // 异步提取:不阻塞上传响应;失败仅记日志,附件注入时读不到伴生文件会走「无法读取内容」兜底。
  extractText(storedPath, ext)
    .then(text => {
      if (!text) return;
      const textPath = storedPath + '.txt';
      fs.writeFileSync(textPath, text, 'utf-8');
      result.textPath = textPath;
      log.info({ name: originalName, chars: text.length }, 'upload: 文本提取完成');
    })
    .catch(err => log.warn({ err: err.message, name: originalName }, 'upload: 文本提取失败'));
  return result;
}

/** 按扩展名提取纯文本;不可提取或失败返回 undefined。 */
export async function extractText(filePath: string, ext: string): Promise<string | undefined> {
  try {
    if (ext === 'pdf') return await extractPdf(filePath);
    if (ext === 'docx') return await extractDocx(filePath);
    if (ext === 'pptx' || ext === 'ppt') return await extractPptx(filePath);
    if (isPlainTextExt(ext)) return extractPlain(filePath);
    return undefined; // 图片/音视频等不提取
  } catch (err: any) {
    log.warn({ err: err.message, ext }, 'extractText 失败');
    return undefined;
  }
}

/** 纯文本类扩展名(与前端 TEXT_EXT 对齐,再加常见文档格式) */
const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json',
  'py', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'hpp', 'cs', 'css', 'scss',
  'less', 'html', 'htm', 'xml', 'yml', 'yaml', 'toml', 'ini', 'conf', 'sh',
  'bash', 'bat', 'ps1', 'log', 'csv', 'sql', 'tex', 'vue', 'svelte', 'php',
  'rb', 'swift', 'kt', 'dart', 'r', 'pl',
]);

function isPlainTextExt(ext: string): boolean {
  return TEXT_EXTS.has(ext);
}

/** 普通文本直接读 utf-8(含 NUL 视为二进制,不提取) */
function extractPlain(filePath: string): string | undefined {
  const buf = fs.readFileSync(filePath);
  if (buf.includes(0)) return undefined;
  return buf.toString('utf-8');
}

/** PDF → 纯文本(pdf-parse v2) */
async function extractPdf(filePath: string): Promise<string | undefined> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: fs.readFileSync(filePath) });
  const result = await parser.getText();
  const text = (result && result.text) || '';
  return text ? truncate(text) : undefined;
}

/** DOCX → 纯文本(mammoth) */
async function extractDocx(filePath: string): Promise<string | undefined> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  const text = (result && result.value) || '';
  return text ? truncate(text) : undefined;
}

/** PPTX/PPT → 纯文本(jszip 解包 slide XML 里的 <a:t> 文本) */
async function extractPptx(filePath: string): Promise<string | undefined> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  const parts: string[] = [];
  const slideFiles = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)\.xml/)![1], 10);
      const nb = parseInt(b.match(/slide(\d+)\.xml/)![1], 10);
      return na - nb;
    });
  for (const name of slideFiles) {
    const xml = await zip.files[name].async('string');
    // <a:t>...</a:t> 文本节点,按段落(<a:p>)聚合
    const texts: string[] = [];
    const pRegex = /<a:p[\s>][\s\S]*?<\/a:p>|<a:p\/>/g;
    let pm: RegExpExecArray | null;
    while ((pm = pRegex.exec(xml))) {
      const tRegex = /<a:t>([\s\S]*?)<\/a:t>/g;
      const line: string[] = [];
      let tm: RegExpExecArray | null;
      while ((tm = tRegex.exec(pm[0]))) line.push(tm[1]);
      if (line.length) texts.push(line.join(''));
    }
    if (texts.length) parts.push(texts.join('\n'));
  }
  if (!parts.length) return undefined;
  return truncate(parts.join('\n\n'));
}

/** 截断到 MAX_EXTRACT_CHARS */
function truncate(s: string): string {
  return s.length > MAX_EXTRACT_CHARS ? s.slice(0, MAX_EXTRACT_CHARS) + '\n…(内容过长已截断)' : s;
}
