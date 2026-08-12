import { useEffect, useState, useRef, Fragment, CSSProperties, ReactNode } from 'react';
import { previewClient } from '../preview/PreviewClient';
import type { RunningTaskFront } from '../preview/PreviewClient';
import MessageActions from '../components/MessageActions';
import { parseQuiz, QuizCard } from '../components/QuizCard';
import type { Artifact } from '../../../shared/preview-types';
import { previewSandbox } from '../../../shared/preview-types';

/* =========================================================================
 * MiniClaw · 对话页（分栏视图 + 文件预览 + 苹果风）
 * -------------------------------------------------------------------------
 * 架构（对照预览版 miniclaw-split-preview.html，已落地到正式代码）：
 *   ChatPage
 *     ├─ 侧边栏（会话列表 + ⋯菜单：置顶/重命名/分享/删除，自绘 SVG，无 emoji）
 *     └─ 内容区 Vertical Split View
 *            ├─ ChatPane A（对话，默认聚焦）
 *            ├─ Splitter（可拖拽；拖到 <84px 自动收起该侧，留恢复条）
 *            └─ ChatPane B（默认文件视图，对标 WorkBuddy 预览面板）
 *
 * 每个 ChatPane 独立持有：sessionId / 消息 / 输入 / 思考强度 / 联网搜索 / 上下文用量，
 * 并各自建立一条 EventSource（sessionId 隔离，杜绝串台）。
 * 文件视图复用 previewClient（SSE 全局订阅 artifact），与 PreviewPage 同源。
 * 视觉：全部内联 style + 一段组件级 <style>（仅放 keyframes / 细滚动条 / :hover 等
 *       伪类，前缀 mc- 避免污染其它组件），沿用项目「内联样式」约定。
 * ========================================================================= */

// ─── 组件级样式（只放内联 style 无法表达的部分：伪类 / 关键帧 / 滚动条）────
const MC_CSS = `
:root{
  --mc-bg:#f5f5f7;
  --mc-glass:rgba(255,255,255,.72);
  --mc-glass-strong:rgba(255,255,255,.82);
  --mc-hair:rgba(0,0,0,.08);
  --mc-text:#1d1d1f; --mc-muted:#86868b; --mc-muted2:#aeaeb2;
  --mc-accent:#0A84FF; --mc-accent-soft:rgba(10,132,255,.12);
  --mc-danger:#FF453A; --mc-pin:#FF9F0A;
  --mc-seg:rgba(118,118,128,.12);
  --mc-shadow-sm:0 1px 2px rgba(0,0,0,.06),0 1px 1px rgba(0,0,0,.04);
  --mc-shadow-md:0 8px 24px rgba(0,0,0,.10),0 2px 6px rgba(0,0,0,.06);
  --mc-msg-ai:#1d1d1f; --mc-bubble-ai:#e9e9eb;
}
[data-theme="dark"]{
  --mc-bg:#0f1117;
  --mc-glass:rgba(26,29,39,.82);
  --mc-glass-strong:rgba(26,29,39,.92);
  --mc-hair:rgba(255,255,255,.08);
  --mc-text:#f0f1f5; --mc-muted:#9ca3af; --mc-muted2:#6b7280;
  --mc-accent:#818cf8; --mc-accent-soft:rgba(129,140,248,.15);
  --mc-danger:#f87171; --mc-pin:#fbbf24;
  --mc-seg:rgba(255,255,255,.08);
  --mc-shadow-sm:0 1px 2px rgba(0,0,0,.3);
  --mc-shadow-md:0 8px 24px rgba(0,0,0,.4);
  --mc-msg-ai:#c4b5fd; --mc-bubble-ai:rgba(139,92,246,.12);
}
.mc-scroll::-webkit-scrollbar{width:8px;height:8px;}
.mc-scroll::-webkit-scrollbar-thumb{background:rgba(128,128,128,.3);border-radius:8px;}
.mc-scroll::-webkit-scrollbar-thumb:hover{background:rgba(128,128,128,.5);}
.mc-scroll::-webkit-scrollbar-track{background:transparent;}

.mc-row{position:relative;display:flex;align-items:center;gap:8px;padding:9px 10px;cursor:pointer;border-radius:9px;border-left:3px solid transparent;transition:background .15s,border-color .15s,opacity .22s,max-height .22s,padding .22s;}
.mc-row:hover{background:var(--mc-hair);}
.mc-row.active{background:var(--mc-accent-soft);}
.mc-row.pinned{border-left-color:var(--mc-pin);}
.mc-row.removing{max-height:0;opacity:0;padding-top:0;padding-bottom:0;overflow:hidden;}
.mc-row.flash{animation:mcFlash .55s ease;}
@keyframes mcFlash{0%{background:var(--mc-accent-soft);}100%{background:transparent;}}
.mc-more{width:26px;height:26px;border:none;background:transparent;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--mc-muted);opacity:0;transition:opacity .15s,background .12s,color .12s;flex-shrink:0;}
.mc-row:hover .mc-more{opacity:1;}
.mc-more:hover{background:var(--mc-hair);color:var(--mc-text);}

.mc-newbtn{width:100%;padding:8px;border:none;border-radius:10px;background:var(--mc-accent);color:#fff;font-size:13.5px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:var(--mc-shadow-sm);transition:background .15s,transform .08s,box-shadow .15s;}
.mc-newbtn:hover{background:#0a76e0;box-shadow:var(--mc-shadow-md);}
.mc-newbtn:active{transform:scale(.98);}

.mc-pill{display:flex;align-items:center;gap:5px;padding:5px 11px;border-radius:18px;border:none;font-size:12px;cursor:pointer;background:var(--mc-seg);color:var(--mc-muted);transition:background .15s,color .15s;}
.mc-pill:hover{color:var(--mc-text);}
.mc-pill.on{background:var(--mc-accent-soft);color:var(--mc-accent);}
.mc-pill .mc-caret{transition:transform .2s;}
.mc-pill.open .mc-caret{transform:rotate(180deg);}

.mc-send{height:42px;padding:0 18px;border:none;border-radius:11px;background:var(--mc-accent);color:#fff;font-size:13.5px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;box-shadow:var(--mc-shadow-sm);transition:background .15s,transform .08s,box-shadow .15s;}
.mc-send:hover{background:#0a76e0;box-shadow:var(--mc-shadow-md);}
.mc-send:active{transform:scale(.97);}
.mc-send:disabled{background:var(--mc-seg);color:var(--mc-muted2);cursor:not-allowed;box-shadow:none;}

.mc-viewbtn{width:28px;height:25px;border:none;background:transparent;border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--mc-muted);transition:background .18s,color .18s;}
.mc-viewbtn.on{background:var(--mc-glass-strong);color:var(--mc-accent);box-shadow:var(--mc-shadow-sm);}
.mc-viewbtn:hover{color:var(--mc-text);}

.mc-filecard{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--mc-hair);border-radius:12px;background:var(--mc-glass);cursor:pointer;transition:border-color .15s,background .15s,box-shadow .15s,transform .12s;}
.mc-filecard:hover{border-color:var(--mc-accent);background:var(--mc-accent-soft);box-shadow:var(--mc-shadow-sm);transform:translateY(-1px);}

.mc-splitter{background:var(--mc-seg);border-radius:3px;transition:background .12s;position:relative;}
.mc-splitter:hover{background:var(--mc-accent);}
.mc-splitter.dragging{background:var(--mc-accent);}

.mc-restore{position:absolute;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;justify-content:center;width:24px;padding:12px 4px;background:var(--mc-glass-strong);border:1px solid var(--mc-hair);border-radius:10px;cursor:pointer;color:var(--mc-muted);font-size:12px;writing-mode:vertical-rl;letter-spacing:1px;z-index:40;transition:background .12s,color .12s;}
.mc-restore:hover{background:var(--mc-accent-soft);color:var(--mc-accent);}

.mc-menu{position:fixed;z-index:60;min-width:158px;background:var(--mc-glass-strong);border:1px solid var(--mc-hair);border-radius:14px;padding:6px;box-shadow:var(--mc-shadow-md);}
.mc-menu button{width:100%;display:flex;align-items:center;gap:10px;padding:8px 10px;margin:1px 0;border:none;background:transparent;border-radius:9px;font-size:13px;color:var(--mc-text);cursor:pointer;text-align:left;transition:background .12s;}
.mc-menu button:hover{background:var(--mc-hair);}
.mc-menu button .mi{color:var(--mc-muted);display:flex;flex-shrink:0;}
.mc-menu button.danger{color:var(--mc-danger);}
.mc-menu button.danger .mi{color:var(--mc-danger);}
.mc-menu .sep{height:1px;background:var(--mc-hair);margin:4px 6px;}

.mc-toast{display:flex;align-items:center;gap:14px;background:var(--mc-glass-strong);border:1px solid var(--mc-hair);color:var(--mc-text);padding:10px 14px;border-radius:14px;font-size:13px;box-shadow:var(--mc-shadow-md);animation:mcToastIn .2s ease;}
.mc-toast .undo{border:none;background:transparent;color:var(--mc-accent);font-weight:600;cursor:pointer;font-size:13px;}
@keyframes mcToastIn{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
@keyframes mcDotPulse{0%,80%,100%{opacity:.3;transform:scale(.8);}40%{opacity:1;transform:scale(1.2);}}
.mc-spin{animation:mcSpin .8s linear infinite;}@keyframes mcSpin{to{transform:rotate(360deg);}}
/* 多文案轮播：淡入淡出切换（等待期提示语） */
.mc-rot-fade{animation:mcRotFade 3.6s ease-in-out infinite;}
@keyframes mcRotFade{0%,92%{opacity:0;}8%,84%{opacity:1;}}
/* 状态徽章呼吸：图标轻微缩放脉动（文件读取指示器） */
.mc-breath{animation:mcBreath 1.6s ease-in-out infinite;}
@keyframes mcBreath{0%,100%{opacity:.55;transform:scale(.92);}50%{opacity:1;transform:scale(1.08);}}
/* 流式正文：逐段（按行）淡入 + 打字光标（对标 ChatGPT/LibreChat/WorkBuddy 生成动感） */
.mc-line{white-space:pre-wrap;word-break:break-word;animation:mcLineIn .26s ease;}
@keyframes mcLineIn{from{opacity:0;transform:translateY(3px);}to{opacity:1;transform:none;}}
.mc-caret{display:inline-block;width:2px;height:1.05em;background:var(--mc-accent);margin-left:1px;vertical-align:text-bottom;animation:mcBlink 1.05s step-end infinite;transform:translateY(1px);}
@keyframes mcBlink{50%{opacity:0;}}

.mc-pane{transition:box-shadow .18s,transform .18s;}
.mc-pane.mc-focused{box-shadow:0 0 0 2px var(--mc-accent),var(--mc-shadow-md);}

.mc-msg{position:relative;animation:mcMsgIn .34s cubic-bezier(.2,.7,.3,1) both;}
@keyframes mcMsgIn{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:none;}}
.mc-actions{opacity:0;transition:opacity .12s,transform .12s;transform:translateY(2px);}
.mc-msg:hover .mc-actions{opacity:1 !important;transform:translateY(0);}
.mc-conn{width:7px;height:7px;border-radius:50%;flex-shrink:0;transition:background .2s;}
.mc-banner{display:flex;align-items:center;gap:10px;justify-content:center;padding:8px 12px;margin:0 20px 10px;border-radius:10px;background:rgba(255,69,58,.10);border:1px solid var(--mc-danger);color:var(--mc-danger);font-size:12.5px;}
  .mc-banner button{border:none;background:var(--mc-danger);color:#fff;padding:4px 12px;border-radius:7px;cursor:pointer;font-size:12.5px;font-weight:600;}

  /* 真正的流式 Markdown 渲染（对标 WorkBuddy / ChatGPT 正文排版；零依赖） */
  .mc-md{font-size:14px;line-height:1.65;word-break:break-word;}
  .mc-md-block{animation:mcLineIn .26s ease;margin:0;}
  .mc-h1{font-size:19px;font-weight:700;margin:10px 0 6px;line-height:1.3;}
  .mc-h2{font-size:16.5px;font-weight:700;margin:9px 0 5px;line-height:1.3;}
  .mc-h3{font-size:14.5px;font-weight:600;margin:8px 0 4px;}
  .mc-p{margin:6px 0;}
  .mc-list{margin:6px 0;padding-left:22px;}
  .mc-list li{margin:2px 0;}
  .mc-quote{margin:8px 0;padding:6px 12px;border-left:3px solid var(--mc-accent);background:rgba(10,132,255,.06);border-radius:0 8px 8px 0;color:var(--mc-muted);}
  .mc-md code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;background:var(--mc-seg);border:1px solid var(--mc-hair);padding:1px 5px;border-radius:5px;color:#c0341d;}
  [data-theme="dark"] .mc-md code{color:#f87171;}
  .mc-pre{background:#1e1e24;border-radius:10px;padding:12px;overflow-x:auto;margin:8px 0;}
  .mc-pre code{background:none;border:none;padding:0;color:#e6e6e6;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.6;white-space:pre;}
  .mc-kw{color:#ff7ab2;}
  .mc-ty{color:#5ac8fa;}
  .mc-tbl{border-collapse:collapse;width:100%;margin:8px 0;font-size:13px;}
  .mc-tbl th,.mc-tbl td{border:1px solid var(--mc-hair);padding:5px 9px;text-align:left;}
  .mc-tbl th{background:var(--mc-seg);font-weight:600;color:var(--mc-text);}
  [data-theme="dark"] .mc-banner{background:rgba(248,113,113,.12);}
  [data-theme="dark"] .mc-pre{background:#1a1d27;}
  [data-theme="dark"] .mc-pre code{color:#d1d5db;}
  [data-theme="dark"] .mc-kw{color:#f472b6;}
  [data-theme="dark"] .mc-ty{color:#38bdf8;}
  [data-theme="dark"] .mc-quote{background:rgba(129,140,248,.08);}
`;

const LEVELS = [
  { name: '极简', temp: 0.30 },
  { name: '简洁', temp: 0.50 },
  { name: '均衡', temp: 0.70 },
  { name: '深入', temp: 0.40 },
  { name: '深度', temp: 0.25 },
];
const CTX_LIMIT_FALLBACK = 65536; // 本地兜底上限（tokens）；真实值由服务端 /api/sessions/:id/context 提供

interface Session {
  id: string;
  title: string;
  pinned: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

interface OpenReq {
  pane: 'A' | 'B';
  sessionId: string | null;
  nonce: number;
}

interface ModelOption {
  providerId: string;
  providerName: string;
  type: string;
  defaultModel: string;
  models: string[];
}

interface SelectedModel {
  providerId: string;
  model: string;
}

// ─── 自绘线条 SVG 图标（不用 emoji）──────────────────────────────────────
const svg = (size: number, children: ReactNode, sw = 2) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IconChat = () => svg(15, <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></>);
const IconFiles = () => svg(15, <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="14 3 14 9 20 9" /></>);
const IconSearch = () => svg(14, <><circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" /><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" /></>);
const IconThink = () => svg(13, <><circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>);
const IconCaret = () => svg(11, <path d="M6 9l6 6 6-6" />, 2.5);
const IconContext = () => svg(14, <><line x1="4" y1="20" x2="4" y2="13" /><line x1="10" y1="20" x2="10" y2="8" /><line x1="16" y1="20" x2="16" y2="11" /><line x1="22" y1="20" x2="22" y2="4" /></>);
const IconTrace = () => svg(14, <><circle cx="5" cy="6" r="2" /><circle cx="19" cy="12" r="2" /><circle cx="5" cy="18" r="2" /><path d="M7 6h6a2 2 0 0 1 2 2v2" /><path d="M7 18h6a2 2 0 0 0 2-2v-2" /></>);
const IconTool = () => svg(14, <><path d="M14.7 6.3a4 4 0 0 0-5.4-5.4L3 10l-1 5 5-1 7.7-7.7z" /></>);
const IconGlobe = () => svg(14, <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" /></>);
const IconCheck = () => svg(13, <><polyline points="20 6 9 17 4 12" /></>);
const IconCross = () => svg(13, <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>);
const IconModel = () => svg(14, <><rect x="3" y="4" width="18" height="10" rx="2" /><line x1="8" y1="20" x2="16" y2="20" /><line x1="12" y1="14" x2="12" y2="20" /></>);
const IconSkills = () => svg(14, <><path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></>);
const IconPlus = () => svg(14, <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>);
const IconFile = () => svg(14, <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><polyline points="14 3 14 8 19 8" /></>);
const IconSend = () => svg(14, <><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></>);
const IconStop = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>;
const IconPin = () => svg(14, <><path d="M12 17v4" /><path d="M9 3h6l-1 6 3 3H7l3-3-1-6z" /></>);
const IconTrash = () => svg(14, <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></>);
const IconEdit = () => svg(15, <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>);
const IconShare = () => svg(15, <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" /></>);
const IconDots = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>;
const IconNew = () => svg(15, <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>, 2.2);
const IconFileHtml = () => svg(18, <><polyline points="8 7 3 12 8 17" /><polyline points="16 7 21 12 16 17" /><line x1="13" y1="5" x2="11" y2="19" /></>);
const IconFileDoc = () => svg(18, <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="14 3 14 9 20 9" /></>);
const IconFileImage = () => svg(18, <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></>);

function fileIcon(kind: string) {
  if (kind === 'html') return <IconFileHtml />;
  if (kind === 'image') return <IconFileImage />;
  return <IconFileDoc />;
}
function typeLabel(k: string) {
  return { html: 'HTML', markdown: 'Markdown', code: 'Code', image: '图片', url: '链接' }[k] || k;
}

// 把一次 SSE 增量（span 的 start/end）合并进当前 trace 对象（实时边收边画）
function mergeTraceSpan(trace: any, _phase: string, span: any): any {
  if (!trace) return { traceId: span?.traceId || '', sessionId: null, rootName: '', startedAt: span?.startedAt || Date.now(), endedAt: null, status: 'ok', spans: [span] };
  const spans = Array.isArray(trace.spans) ? trace.spans.slice() : [];
  const idx = spans.findIndex((s: any) => s.spanId === span.spanId);
  if (idx >= 0) spans[idx] = { ...spans[idx], ...span };
  else spans.push(span);
  return { ...trace, spans };
}

function formatAttrs(attrs: any): string {
  if (!attrs || typeof attrs !== 'object') return String(attrs ?? '');
  const out: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    out.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  }
  return out.join('\n');
}

// ─── 简易 Trace 瀑布：把一次请求的 Span 树画成时间条（失败段标红，行可点击展开详情）──
function TraceWaterfall({ trace }: { trace: any }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  if (!trace || !Array.isArray(trace.spans) || trace.spans.length === 0) {
    return (
      <div style={{ borderBottom: '1px solid var(--mc-hair)', background: 'var(--mc-glass)', padding: '12px 16px', color: 'var(--mc-muted2)', fontSize: 12 }}>
        暂无 Trace 数据。发送一条消息后，这里会实时显示本次请求的调用瀑布（根请求 → LLM 调用 / 工具 / 流式耗时，点击任意行可展开参数与耗时，失败段标红）。
      </div>
    );
  }
  const starts = trace.spans.map((s: any) => s.startedAt);
  const ends = trace.spans.map((s: any) => s.endedAt ?? s.startedAt);
  const t0 = Math.min(trace.startedAt, ...starts);
  const t1 = Math.max(trace.endedAt ?? t0, ...ends);
  const total = Math.max(1, t1 - t0);
  const byId = new Map(trace.spans.map((s: any) => [s.spanId, s]));
  const depthOf = (s: any) => {
    let d = 0; let cur: any = s;
    while (cur && cur.parentSpanId) { const p = byId.get(cur.parentSpanId); if (!p || p === cur || d > 20) break; cur = p; d++; }
    return d;
  };
  const kindColor: Record<string, string> = { root: 'var(--mc-accent)', llm: '#BF5AF2', tool: 'var(--mc-pin)', db: '#34C759', stream: '#5AC8FA' };
  const live = !trace.endedAt;
  return (
    <div className="mc-scroll" style={{ borderBottom: '1px solid var(--mc-hair)', background: 'var(--mc-glass)', padding: '10px 14px', maxHeight: 240, overflowY: 'auto', flexShrink: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--mc-text)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          本次请求 Trace
          {live && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#34C759', display: 'inline-block', animation: 'mcDotPulse 1.2s infinite' }} title="进行中" />}
        </span>
        <span style={{ fontSize: 11, color: trace.status === 'error' ? 'var(--mc-danger)' : 'var(--mc-muted)' }}>
          {(total / 1000).toFixed(2)}s · {trace.spans.length} spans{live ? ' · 进行中' : ''}
        </span>
      </div>
      <div style={{ fontFamily: 'ui-monospace,Menlo,Consolas,monospace', fontSize: 11.5 }}>
        {trace.spans.map((s: any) => {
          const d = depthOf(s);
          const start = (s.startedAt - t0) / total;
          const durMs = (s.endedAt ?? s.startedAt) - s.startedAt;
          const dur = Math.max(0.02, durMs / total);
          const color = s.status === 'error' ? 'var(--mc-danger)' : (kindColor[s.kind] || '#8E8E93');
          const tok = (s.attrs && s.attrs.promptTokens != null) ? ` (${s.attrs.promptTokens}+${s.attrs.completionTokens} tok)` : '';
          const label = (s.attrs && s.attrs.model ? `${s.name} · ${s.attrs.model}` : s.name) + tok;
          const isOpen = open.has(s.spanId);
          return (
            <div key={s.spanId}>
              <div onClick={() => toggle(s.spanId)} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '3px 0', cursor: 'pointer', padding: '1px 4px', borderRadius: 6 }}>
                <span style={{ width: 14 * d, flexShrink: 0 }} />
                <span title={label} style={{ width: 150, flexShrink: 0, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
                <div style={{ flex: 1, position: 'relative', height: 12, background: 'var(--mc-seg)', borderRadius: 3 }}>
                  <div style={{ position: 'absolute', left: `${start * 100}%`, width: `${dur * 100}%`, top: 1, height: 10, background: color, borderRadius: 3, opacity: s.status === 'error' ? 0.95 : 0.8 }} />
                </div>
                <span style={{ width: 52, flexShrink: 0, textAlign: 'right', color: 'var(--mc-muted)', fontVariantNumeric: 'tabular-nums' }}>{(durMs / 1000).toFixed(2)}s</span>
                <span style={{ width: 12, flexShrink: 0, color: 'var(--mc-muted2)', transform: isOpen ? 'rotate(-90deg)' : 'none', transition: 'transform .15s', display: 'inline-flex' }}><IconCaret /></span>
              </div>
              {isOpen && (
                <div style={{ marginLeft: 14 * d + 162, marginRight: 16, marginBottom: 6, padding: '7px 10px', background: 'var(--mc-seg)', border: '1px solid var(--mc-hair)', borderRadius: 8, fontSize: 11, lineHeight: 1.5 }}>
                  <div style={{ color: 'var(--mc-text)', marginBottom: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <span>状态：<b style={{ color: s.status === 'error' ? 'var(--mc-danger)' : 'var(--mc-accent)' }}>{s.status === 'error' ? '失败' : '成功'}</b></span>
                    <span>耗时：<b>{durMs}ms</b>{s.endedAt == null ? '（进行中）' : ''}</span>
                    <span>类型：<b>{s.kind}</b></span>
                  </div>
                  <div style={{ color: 'var(--mc-muted2)', marginBottom: 2 }}>属性：</div>
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace,Menlo,Consolas,monospace', fontSize: 10.5, color: 'var(--mc-text)' }}>{formatAttrs(s.attrs)}</pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 把一次 SSE 增量 step（running→done/error）合并进当前 steps 列表（实时累积）
function mergeStep(steps: any[], step: any): any[] {
  if (!step || !step.stepId) return steps || [];
  const arr = Array.isArray(steps) ? steps.slice() : [];
  const idx = arr.findIndex((s: any) => s.stepId === step.stepId);
  if (idx >= 0) arr[idx] = { ...arr[idx], ...step };
  else arr.push(step);
  return arr;
}

// ─── 后台任务阶段标签 / 图标（底部任务栏 + 侧边栏徽章共用）─────────────────
function taskPhaseInfo(p: string) {
  switch (p) {
    case 'searching': return { label: '联网搜索', icon: <IconSearch />, color: 'var(--mc-accent)' };
    case 'fetching': return { label: '抓取页面', icon: <IconGlobe />, color: 'var(--mc-accent)' };
    case 'writing': return { label: '撰写回答', icon: <IconChat />, color: 'var(--mc-accent)' };
    case 'done': return { label: '已完成', icon: <IconCheck />, color: '#34C759' };
    case 'error': return { label: '出错', icon: <IconCross />, color: 'var(--mc-danger)' };
    default: return { label: '思考中', icon: <IconThink />, color: 'var(--mc-accent)' };
  }
}

// ─── 底部任务栏单个任务芯片：标题 + 阶段 + 已用时（每 10s 校准）────────────
function TaskChip({ task, onClick }: { task: RunningTaskFront; onClick: () => void }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (task.done || task.error) return;
    const t = setInterval(() => force(x => x + 1), 1000);
    return () => clearInterval(t);
  }, [task.sessionId, task.done, task.error]);
  const info = taskPhaseInfo(task.phase);
  const secs = Math.max(0, Math.floor((Date.now() - task.startedAt) / 1000));
  const mm = Math.floor(secs / 60), ss = secs % 60;
  const still = !task.done && task.phase !== 'error';
  return (
    <button onClick={onClick} title={`${task.title}\n${info.label} · ${mm}:${String(ss).padStart(2, '0')}`}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 12, border: '1px solid var(--mc-hair)', background: 'var(--mc-glass-strong)', backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)', boxShadow: 'var(--mc-shadow-md)', cursor: 'pointer', color: 'var(--mc-text)', fontSize: 12.5, whiteSpace: 'nowrap', transition: 'transform .12s, background .12s' }}
      onMouseDown={e => e.stopPropagation()}>
      {still ? (
        <span style={{ color: info.color, display: 'flex', flexShrink: 0 }}><span className="mc-spin" style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid ' + info.color, borderTopColor: 'transparent' }} /></span>
      ) : (
        <span style={{ color: info.color, display: 'flex', flexShrink: 0 }}>{info.icon}</span>
      )}
      <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 }}>{task.title}</span>
      <span style={{ color: 'var(--mc-muted2)', display: 'inline-flex', alignItems: 'center', gap: 5, fontVariantNumeric: 'tabular-nums' }}>
        {info.label} · {mm}:{String(ss).padStart(2, '0')}
      </span>
    </button>
  );
}

// ─── 任务规划清单（WorkBuddy 式）：规划阶段 [TODO:...] 步骤，随工具步骤完成逐个打勾 ──
function TodoList({ todos, doneCount }: { todos: { id: string; content: string; status: 'pending' | 'running' | 'done' }[]; doneCount: number }) {
  if (!todos || todos.length === 0) return null;
  return (
    <div className="mc-scroll" style={{ border: '1px solid var(--mc-hair)', background: 'var(--mc-glass)', borderRadius: 12, padding: '8px 10px', margin: '0 0 10px', fontSize: 12.5, boxShadow: 'var(--mc-shadow-sm)' }}>
      <div style={{ fontSize: 11, color: 'var(--mc-muted)', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
        <IconCheck /> 任务清单
        <span style={{ marginLeft: 'auto', fontWeight: 400, color: 'var(--mc-muted2)' }}>{Math.min(doneCount, todos.length)}/{todos.length} 完成</span>
      </div>
      {todos.map((t, i) => {
        const st = i < doneCount ? 'done' : i === doneCount ? 'running' : 'pending';
        const color = st === 'done' ? '#34C759' : st === 'running' ? 'var(--mc-accent)' : 'var(--mc-muted2)';
        return (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 8 }}>
            <span style={{ color, display: 'inline-flex', flexShrink: 0, width: 16, justifyContent: 'center' }}>
              {st === 'done' ? <IconCheck /> : st === 'running' ? (
                <span className="mc-spin" style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid ' + color, borderTopColor: 'transparent' }} />
              ) : (
                <span style={{ fontSize: 11, opacity: 0.6 }}>{i + 1}</span>
              )}
            </span>
            <span style={{ flex: 1, color: st === 'pending' ? 'var(--mc-muted)' : 'var(--mc-text)', textDecoration: st === 'done' ? 'line-through' : 'none' }}>{t.content}</span>
          </div>
        );
      })}
    </div>
  );
}

// 长文本折叠阈值（字符数）：超过则默认收起，显示行数/字符数 + 展开 + 复制
const TEXT_FOLD_CHARS = 600;

// 通用长文本折叠组件：超长内容默认收起（「N 行 · M 字符 · 点击展开」），支持一键复制
function FoldText({ text, foldChars = TEXT_FOLD_CHARS }: { text: string; foldChars?: number }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const isLong = (text?.length || 0) > foldChars;
  const lines = (text || '').split('\n').length;
  if (!isLong) {
    return <div style={{ color: 'var(--mc-text)', wordBreak: 'break-word' }}>{text}</div>;
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };
  return (
    <div style={{ border: '1px solid var(--mc-hair)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--mc-seg)', fontSize: 11, color: 'var(--mc-muted2)' }}>
        <button onClick={() => setOpen(o => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'transparent', color: 'var(--mc-accent)', cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: 0 }}>
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform .15s', transform: open ? 'rotate(90deg)' : 'none' }}><polyline points="9 18 15 12 9 6" /></svg>
          {open ? '收起' : `展开全部 ${lines} 行 · ${text.length.toLocaleString()} 字符`}
        </button>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <button onClick={copy} style={{ border: 'none', background: 'transparent', color: copied ? '#34C759' : 'var(--mc-muted2)', cursor: 'pointer', fontSize: 11, padding: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {copied ? '✓ 已复制' : '复制'}
          </button>
        </span>
      </div>
      {open && (
        <div style={{ maxHeight: 260, overflowY: 'auto', padding: '6px 10px', color: 'var(--mc-text)', wordBreak: 'break-word', fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{text}</div>
      )}
    </div>
  );
}

// ─── 工具调用提示卡片：对话流内实时展示「正在调用工具」（对标 WorkBuddy 中间步骤）──
function ToolSteps({ steps }: { steps: any[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  if (!steps || steps.length === 0) return null;
  return (
    <div className="mc-scroll" style={{ border: '1px solid var(--mc-hair)', background: 'var(--mc-glass)', borderRadius: 12, padding: '8px 10px', margin: '0 0 10px', fontSize: 12.5, boxShadow: 'var(--mc-shadow-sm)' }}>
      <div style={{ fontSize: 11, color: 'var(--mc-muted)', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
        <IconTool /> 工具调用
        <span style={{ marginLeft: 'auto', fontWeight: 400, color: 'var(--mc-muted2)' }}>
          {steps.filter((s: any) => s.status !== 'running').length}/{steps.length} 完成
        </span>
      </div>
      {steps.map((s: any) => {
        const isOpen = open.has(s.stepId);
        const accent = s.status === 'error' ? 'var(--mc-danger)' : s.status === 'done' ? '#34C759' : 'var(--mc-accent)';
        return (
          <div key={s.stepId}>
            <div onClick={() => toggle(s.stepId)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 8, cursor: 'pointer' }}>
              <span style={{ color: accent, display: 'flex', flexShrink: 0 }}>{s.tool === 'fetch' ? <IconGlobe /> : <IconSearch />}</span>
              <span style={{ flex: 1, color: 'var(--mc-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
              {s.status === 'running' && <span className="mc-spin" style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid ' + accent, borderTopColor: 'transparent', flexShrink: 0 }} />}
              {s.status === 'done' && <span style={{ color: accent, display: 'flex', flexShrink: 0 }}><IconCheck /></span>}
              {s.status === 'error' && <span style={{ color: accent, display: 'flex', flexShrink: 0 }}><IconCross /></span>}
              <span style={{ color: 'var(--mc-muted2)', transform: isOpen ? 'rotate(-90deg)' : 'none', transition: 'transform .15s', display: 'flex', flexShrink: 0 }}><IconCaret /></span>
            </div>
            {isOpen && (
              <div style={{ margin: '0 6px 6px 28px', padding: '6px 8px', background: 'var(--mc-seg)', border: '1px solid var(--mc-hair)', borderRadius: 8, fontSize: 11, lineHeight: 1.5 }}>
                {Array.isArray(s.args) && s.args.length > 0 && (
                  <div style={{ marginBottom: 4 }}>
                    <div style={{ color: 'var(--mc-muted2)', marginBottom: 2 }}>输入</div>
                    {s.args.map((a: any, i: number) => <div key={i} style={{ color: 'var(--mc-text)', fontFamily: 'ui-monospace,monospace', wordBreak: 'break-all' }}>· {a}</div>)}
                  </div>
                )}
                {s.result && (<div style={{ marginBottom: 4 }}><div style={{ color: 'var(--mc-muted2)', marginBottom: 2 }}>结果</div><FoldText text={String(s.result)} /></div>)}
                {s.error && (<div style={{ color: 'var(--mc-danger)' }}>{s.error}</div>)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── 真正的流式 Markdown 渲染器（对标 WorkBuddy / ChatGPT 正文排版）────
// 把累积文本按「块」（标题/段落/代码块/列表/表格/引用）切分，每块稳定 key，
// 已渲染块内容不变则不重绘（dangerouslySetInnerHTML 浅比较），仅新增块淡入，
// 避免纯文本流「哑」感与重播闪烁。代码块做轻量语法高亮（零依赖，避免引入重型库）。
function escHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as Record<string, string>)[c]);
}
function hlCode(code: string): string {
  let h = escHtml(code);
  h = h.replace(/\b(function|const|let|var|return|switch|case|break|import|export|type|interface|class|new|await|async|if|else|for|of|in|from|public|private|void|true|false|null|def|print|echo|require|module|func|fn)\b/g, '<span class="mc-kw">$1</span>');
  h = h.replace(/\b(string|number|boolean|Event|any|void|Promise|Array|object|int|float|bool|str|dict|list)\b/g, '<span class="mc-ty">$1</span>');
  return h;
}
function inlineMd(s: string): string {
  return escHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
function parseMdBlocks(md: string): string[] {
  const lines = (md || '').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push('<pre class="mc-pre"><code>' + hlCode(buf.join('\n')) + '</code></pre>');
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = line.split('|').slice(1, -1).map((c) => c.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
        i++;
      }
      let t = '<table class="mc-tbl"><thead><tr>' + head.map((h) => '<th>' + inlineMd(h) + '</th>').join('') + '</tr></thead><tbody>';
      rows.forEach((r) => { t += '<tr>' + r.map((c) => '<td>' + inlineMd(c) + '</td>').join('') + '</tr>'; });
      t += '</tbody></table>';
      out.push(t);
      continue;
    }
    const hm = line.match(/^(#{1,3})\s+(.*)/);
    if (hm) { const lv = (hm[1] || '#').length; out.push('<h' + lv + ' class="mc-h' + lv + '">' + inlineMd(hm[2] || '') + '</h' + lv + '>'); i++; continue; }
    if (/^>\s?/.test(line)) { out.push('<blockquote class="mc-quote">' + inlineMd(line.replace(/^>\s?/, '')) + '</blockquote>'); i++; continue; }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+.\s+/.test(line)) {
      const ordered = /^\s*\d+.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+.\s+/.test(lines[i]))) {
        items.push('<li>' + inlineMd(lines[i].replace(/^\s*(?:[-*]|\d+.)\s+/, '')) + '</li>');
        i++;
      }
      out.push('<' + (ordered ? 'ol' : 'ul') + ' class="mc-list">' + items.join('') + '</' + (ordered ? 'ol' : 'ul') + '>');
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' &&
      !/^(#{1,3}\s|```|>|[\s]*[-*]\s|[\s]*\d+.\s|\|.*\|\s*$)/.test(lines[i])) {
      para.push(inlineMd(lines[i])); i++;
    }
    out.push('<p class="mc-p">' + para.join('<br>') + '</p>');
  }
  return out;
}

// 代码块折叠阈值：超过该行数的代码块默认收起，避免大文件一次性铺满对话流
const CODE_FOLD_LINES = 40;

// 可折叠代码块：超长代码默认收起，显示「N 行 · 点击展开」，展开后保留语法高亮
function CodeFoldingBlock({ html, streaming }: { html: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const lineCount = (html.match(/\n/g) || []).length + 1;
  const isLong = lineCount > CODE_FOLD_LINES;
  if (!isLong) {
    return <div className="mc-md-block" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return (
    <div style={{ margin: '6px 0', borderRadius: 12, border: '1px solid var(--mc-hair)', overflow: 'hidden', background: 'var(--mc-seg)' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 12px', border: 'none', background: 'transparent', color: 'var(--mc-muted)', cursor: 'pointer', fontSize: 12, fontWeight: 500, textAlign: 'left' }}>
        <span style={{ display: 'inline-flex', color: 'var(--mc-accent)', transition: 'transform .15s', transform: open ? 'rotate(90deg)' : 'none' }}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </span>
        <span style={{ flex: 1 }}>{open ? '收起代码块' : `代码块 ${lineCount} 行（点击展开）`}</span>
        {streaming && <span className="mc-caret" />}
      </button>
      {open && <div className="mc-md-block" style={{ borderTop: '1px solid var(--mc-hair)' }} dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  );
}

function MarkdownStream({ text, streaming }: { text: string; streaming: boolean }) {
  const blocks = parseMdBlocks(text);
  return (
    <div className="mc-md">
      {blocks.map((b, idx) => {
        if (b.startsWith('<pre class="mc-pre">')) {
          return <CodeFoldingBlock key={idx} html={b} streaming={streaming} />;
        }
        return <div key={idx} className="mc-md-block" dangerouslySetInnerHTML={{ __html: b }} />;
      })}
      {streaming && <span className="mc-caret" />}
    </div>
  );
}

// ─── 选择题卡片（quiz-generator 技能）：共享组件 QuizCard 解析 [QUIZ] JSON 渲染 ──
// （组件定义见 components/QuizCard.tsx，主窗与悬浮窗共用）

/** 助手消息正文：优先渲染选择题卡片（[QUIZ] 解析成功时），否则走 Markdown */
function AssistantBody({ text, streaming }: { text: string; streaming: boolean }) {
  const quiz = parseQuiz(text);
  if (quiz) return <QuizCard data={quiz} streaming={streaming} />;
  return <MarkdownStream text={text} streaming={streaming} />;
}

// ─── 阶段进度指示：思考中 → 调用工具 → 撰写回答（实时推进，对标 WorkBuddy 阶段条 / OpenCode 状态栏）──
function StageIndicator({ stage, hasTool }: { stage: 'thinking' | 'tooling' | 'writing'; hasTool: boolean }) {
  const order = ['thinking', 'tooling', 'writing'] as const;
  const labels: Record<string, string> = { thinking: '思考中', tooling: '调用工具', writing: '撰写回答' };
  const icons: Record<string, ReactNode> = { thinking: <IconThink />, tooling: <IconTool />, writing: <IconChat /> };
  const ci = order.indexOf(stage);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 2px 2px', marginBottom: 8, fontSize: 12, flexWrap: 'wrap' }}>
      {order.map((name, ni) => {
        let st: 'done' | 'active' | 'todo' | 'skip' = 'todo';
        if (ni < ci) st = 'done';
        else if (ni === ci) st = 'active';
        else if (name === 'tooling' && !hasTool && stage === 'writing') st = 'skip';
        const color = st === 'done' ? '#34C759' : st === 'active' ? 'var(--mc-accent)' : st === 'skip' ? 'var(--mc-muted2)' : 'var(--mc-muted2)';
        return (
          <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color, fontWeight: st === 'active' ? 600 : 400 }}>
            <span style={{ display: 'inline-flex', flexShrink: 0, opacity: st === 'todo' ? 0.5 : 1 }}>
              {st === 'active' ? <span className="mc-spin" style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid ' + color, borderTopColor: 'transparent' }} />
                : st === 'done' ? <IconCheck /> : icons[name]}
            </span>
            <span>{st === 'skip' ? '未使用工具' : labels[name]}</span>
            {ni < order.length - 1 && <span style={{ color: 'var(--mc-muted2)', margin: '0 2px' }}>·</span>}
          </span>
        );
      })}
    </div>
  );
}

// ─── 多文案轮播加载提示：等待期切换不同提示语（想法沉淀/整理论据/检索记忆等）──
// 思考态文案池：随思考强度档位选不同语系；每 3.6s 淡入淡出切下一句。
const THINK_PHRASES: Record<'low' | 'mid' | 'high', string[]> = {
  low: ['正在组织语言', '检索相关上下文', '整理思路'],
  mid: ['想法沉淀一下', '整理论据', '权衡不同方案', '回顾相关记忆'],
  high: ['深度推演中', '校验逻辑链路', '权衡取舍与边界', '凝练结论', '复盘推演'],
};
function StatusTextRotation({ level, elapsed }: { level: 0 | 1 | 2; elapsed: number }) {
  const pool = level === 0 ? THINK_PHRASES.low : level === 1 ? THINK_PHRASES.mid : THINK_PHRASES.high;
  // 每 3.6s（与 mcRotFade 一个周期对齐）推进下标
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (pool.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % pool.length), 3600);
    return () => clearInterval(t);
  }, [pool.length]);
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', minWidth: 60 }}>
      <span style={{ animation: 'mcDotPulse 1.2s infinite', display: 'inline-block' }}>●</span>
      <span style={{ animation: 'mcDotPulse 1.2s infinite .2s', display: 'inline-block' }}>●</span>
      <span style={{ animation: 'mcDotPulse 1.2s infinite .4s', display: 'inline-block' }}>●</span>
      <span className="mc-rot-fade" style={{ marginLeft: 6, fontSize: 12, color: 'var(--mc-muted)' }}>{pool[idx]}</span>
      <span style={{ fontSize: 11, color: 'var(--mc-muted2)', marginLeft: 4 }}>{elapsed}s</span>
    </span>
  );
}

// ─── 等待徽章：图标呼吸微动 + 状态轮播文案（正文尚未到达的等待期）──
// 覆盖「工具调用中 / 文件读取中 / 网络等待」等场景，避免单一静态文案。
// hasTool=true → 文件读取态（文件夹图标呼吸 + 读取系文案）；否则通用等待态。
function WaitingIndicator({ hasTool }: { hasTool: boolean }) {
  const phrases = hasTool
    ? ['正在读取文件', '检索工作区内容', '解析上下文', '整理素材']
    : ['正在组织语言', '检索上下文', '准备回复', '稍等片刻'];
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (phrases.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % phrases.length), 3200);
    return () => clearInterval(t);
  }, [phrases.length]);
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', color: 'var(--mc-muted)', fontSize: 13 }}>
      {/* 呼吸徽章：文件读取态用文件夹图标，通用态用对话泡图标，均走 mcBreath 呼吸 */}
      <span className="mc-breath" style={{ display: 'inline-flex', color: 'var(--mc-accent)' }}>
        {hasTool ? <IconFiles /> : <IconChat />}
      </span>
      {/* 轮播文案：淡入淡出切换 */}
      <span className="mc-rot-fade" style={{ color: 'var(--mc-muted)' }}>{phrases[idx]}</span>
      {/* 备用：保留一个慢转 spinner 作为兜底动感（不抢主视觉） */}
      <span className="mc-spin" style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid var(--mc-hair)', borderTopColor: 'var(--mc-accent)', opacity: 0.5 }} />
    </span>
  );
}

// ─── 思考/推理块：可折叠，随 reasoning 流式增长实时渲染（对标 OpenCode --thinking / WorkBuddy 思考块）──
function ReasoningBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(true);
  if (!text) return null;
  return (
    <div style={{ border: '1px solid var(--mc-hair)', background: 'var(--mc-glass)', borderRadius: 12, padding: '8px 10px', margin: '0 0 10px', fontSize: 12.5 }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--mc-muted)', fontWeight: 600 }}>
        <span style={{ color: 'var(--mc-accent)', display: 'inline-flex' }}><IconThink /></span>
        思考过程
        <span style={{ marginLeft: 'auto', color: 'var(--mc-muted2)', display: 'inline-flex', transform: open ? 'rotate(-90deg)' : 'none', transition: 'transform .15s' }}><IconCaret /></span>
      </div>
      {open && (
        <div style={{ marginTop: 6, padding: '6px 8px', background: 'var(--mc-seg)', border: '1px solid var(--mc-hair)', borderRadius: 8, color: 'var(--mc-muted)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflowY: 'auto' }}>
          {text}
        </div>
      )}
    </div>
  );
}

// ─── 上下文用量计算（真实数据：优先服务端 /api/sessions/:id/context 权威值，缺失时本地估算兜底）──
interface ServerCtx { limit: number; used: number; sys: number; hist: number; tools: number; files: number; model?: string }
function computeCtx(msgs: { role: string; content: string; tokens?: number }[], server?: ServerCtx | null) {
  // 服务端权威值：模型真实 context window + 系统提示/历史/工具/文件分项估算
  if (server && server.limit > 0) {
    return {
      used: server.used || 0,
      limit: server.limit,
      cats: [
        { key: 'sys', label: '系统提示', color: '#0A84FF', value: server.sys || 0 },
        { key: 'history', label: '对话历史', color: '#34C759', value: server.hist || 0 },
        { key: 'tools', label: '工具', color: '#FF9F0A', value: server.tools || 0 },
        { key: 'files', label: '文件', color: '#BF5AF2', value: server.files || 0 },
      ],
    };
  }
  // 本地兜底估算（接口不可用/会话为空时）
  let sys = 0, hist = 0;
  for (const m of msgs) {
    const t = (m.tokens && m.tokens > 0) ? m.tokens : Math.ceil((m.content?.length || 0) / 4);
    if (m.role === 'system') sys += t; else hist += t;
  }
  const used = sys + hist;
  return {
    used, limit: CTX_LIMIT_FALLBACK,
    cats: [
      { key: 'sys', label: '系统提示', color: '#0A84FF', value: sys },
      { key: 'history', label: '对话历史', color: '#34C759', value: hist },
      { key: 'tools', label: '工具', color: '#FF9F0A', value: 0 },
      { key: 'files', label: '文件', color: '#BF5AF2', value: 0 },
    ],
  };
}

// =========================================================================
// ChatPane —— 单个分栏（对话 / 文件）
// =========================================================================
// ─── 工作区浏览器：目录树 + 文件预览 + 文件变更 diff/撤销 ───────────────
const IconFolder = () => svg(15, <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>);
const IconFileCode = () => svg(15, <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="14 3 14 9 20 9" /><polyline points="10 12 8 14 10 16" /><polyline points="14 12 16 14 14 16" /></>);

/** 行级 LCS diff：返回 ctx/del/add 序列，驱动变更卡片的「前后对比」。 */
function lcsLineDiff(oldText: string, newText: string) {
  const a = (oldText || '').split('\n');
  const b = (newText || '').split('\n');
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { t: 'ctx' | 'del' | 'add'; s: string }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: 'ctx', s: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: 'del', s: a[i] }); i++; }
    else { out.push({ t: 'add', s: b[j] }); j++; }
  }
  while (i < n) { out.push({ t: 'del', s: a[i] }); i++; }
  while (j < m) { out.push({ t: 'add', s: b[j] }); j++; }
  return out;
}

function WorkspaceExplorer({ changes, onRevert, onToast }: { changes: any[]; onRevert: (id: string) => void; onToast?: (msg: string) => void }) {
  const [root, setRoot] = useState<string | null>(null);
  const [treeCache, setTreeCache] = useState<Record<string, any[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<any>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [wsInput, setWsInput] = useState('');
  const [editingWs, setEditingWs] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const loadWorkspace = () => {
    fetch('/api/workspace').then(r => r.json()).then(d => {
      setRoot(d.root || null);
      if (d.root) loadTree('');
    }).catch(() => setStatus('加载工作区失败'));
  };
  const loadTree = (rel: string) => {
    fetch('/api/fs/tree?path=' + encodeURIComponent(rel)).then(r => r.json()).then(d => {
      setTreeCache(prev => ({ ...prev, [rel]: d.nodes || [] }));
    }).catch(() => {});
  };
  useEffect(() => { loadWorkspace(); }, []);

  const toggleDir = (rel: string) => {
    setExpanded(prev => {
      const next = { ...prev, [rel]: !prev[rel] };
      if (next[rel] && !treeCache[rel]) loadTree(rel);
      return next;
    });
  };
  const openFile = (rel: string) => {
    setSelectedPath(rel); setFileLoading(true); setFileContent(null);
    fetch('/api/fs/read?path=' + encodeURIComponent(rel)).then(r => r.json()).then(d => {
      setFileContent(d.content); setFileMeta(d); setFileLoading(false);
    }).catch(() => { setFileLoading(false); setStatus('读取失败：' + rel); });
  };
  const setWorkspace = () => {
    const p = wsInput.trim();
    if (!p) return;
    fetch('/api/workspace', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p }) })
      .then(r => r.json()).then(d => {
        if (d.ok) { setRoot(d.root); setTreeCache({}); setExpanded({}); setEditingWs(false); setStatus('工作区已设为 ' + d.root); loadTree(''); }
        else setStatus('设置失败：' + (d.error || ''));
      }).catch(e => setStatus('设置失败：' + e.message));
  };
  const sendToChat = (rel: string) => {
    window.dispatchEvent(new CustomEvent('mc-send', { detail: `请阅读并在必要时修改工作区文件：${rel}` }));
    onToast?.('已把文件提示发到对话');
  };
  // 关闭工作区：清空配置，恢复纯对话直接流式（不再走文件工具规划阶段）
  const closeWorkspace = () => {
    fetch('/api/workspace', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '' }) })
      .then(r => r.json()).then(d => {
        if (d.ok) { setRoot(null); setTreeCache({}); setExpanded({}); setStatus('已关闭工作区（纯对话模式，首 token 更快）'); }
        else setStatus('操作失败：' + (d.error || ''));
      }).catch(e => setStatus('操作失败：' + e.message));
  };

  const rowStyle = (depth: number, active = false): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', cursor: 'pointer',
    borderRadius: 7, fontSize: 12.5, color: active ? 'var(--mc-accent)' : 'var(--mc-text)',
    background: active ? 'var(--mc-accent-soft)' : 'transparent',
    paddingLeft: 8 + depth * 14,
  });

  const renderTree = (rel: string, depth: number): ReactNode => {
    const nodes = treeCache[rel] || [];
    return nodes.map((node: any) => {
      if (node.type === 'dir') {
        const open = !!expanded[node.path];
        return (
          <Fragment key={node.path}>
            <div style={rowStyle(depth)} onClick={() => toggleDir(node.path)}>
              <span style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform .15s', display: 'flex', color: 'var(--mc-muted)' }}><IconCaret /></span>
              <span style={{ color: 'var(--mc-muted)', display: 'flex' }}><IconFolder /></span>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
            </div>
            {open && renderTree(node.path, depth + 1)}
          </Fragment>
        );
      }
      return (
        <div key={node.path} style={rowStyle(depth, selectedPath === node.path)} onClick={() => openFile(node.path)}>
          <span style={{ width: 11, display: 'flex', color: 'var(--mc-muted2)' }}><IconCaret /></span>
          <span style={{ color: 'var(--mc-muted)', display: 'flex' }}><IconFileCode /></span>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
        </div>
      );
    });
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* 工作区配置条 */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--mc-hair)', background: 'var(--mc-glass)' }}>
        {!editingWs ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--mc-text)', flexShrink: 0 }}>工作区</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: root ? 'var(--mc-muted)' : 'var(--mc-pin)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {root || '未配置（AI 无法读写文件）'}
            </span>
            {root && <button className="mc-pill" onClick={closeWorkspace} title="关闭工作区，恢复纯对话直接流式">关闭</button>}
            <button className="mc-pill" onClick={() => { setEditingWs(true); setWsInput(root || ''); }}>{root ? '更改' : '设置'}</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input value={wsInput} onChange={e => setWsInput(e.target.value)} placeholder="工作区绝对路径，如 D:/projects/myapp"
              style={{ width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: 9, border: '1px solid var(--mc-hair)', fontSize: 12.5, background: 'var(--mc-glass-strong)', color: 'var(--mc-text)' }} />
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="mc-send" style={{ height: 32, flex: 1 }} onClick={setWorkspace}>设为工作区</button>
              <button className="mc-pill" onClick={() => setEditingWs(false)}>取消</button>
            </div>
          </div>
        )}
        {status && <div style={{ fontSize: 11, color: 'var(--mc-muted)', marginTop: 6 }}>{status}</div>}
      </div>

      {root ? (
        <div className="mc-scroll" style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0 }}>
          {renderTree('', 0)}
          {(!treeCache[''] || treeCache[''].length === 0) && <div style={{ fontSize: 12, color: 'var(--mc-muted2)', padding: 8 }}>目录为空或加载中…</div>}
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center', fontSize: 12.5, color: 'var(--mc-muted2)', lineHeight: 1.6 }}>
          工作区已关闭（纯对话模式）。<br />点「设置」可开启——系统已在<br />「用户主目录 / MiniClawWorkspace」<br />自动建好默认工作区，也可改为你的项目目录。
        </div>
      )}

      {/* 选中文件预览 */}
      {selectedPath && (
        <div style={{ flexShrink: 0, maxHeight: '40%', borderTop: '1px solid var(--mc-hair)', display: 'flex', flexDirection: 'column', background: 'var(--mc-glass-strong)', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderBottom: '1px solid var(--mc-hair)' }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedPath}</span>
            <button className="mc-pill" onClick={() => sendToChat(selectedPath)}>发给对话</button>
          </div>
          <div className="mc-scroll" style={{ flex: 1, overflow: 'auto', padding: 10 }}>
            {fileLoading ? <div style={{ fontSize: 12, color: 'var(--mc-muted2)' }}>读取中…</div>
              : fileContent ? (
                <div>
                  {fileMeta?.truncated && (
                    <div style={{ marginBottom: 8, padding: '5px 9px', borderRadius: 8, background: 'rgba(255,149,0,.08)', border: '1px solid rgba(255,149,0,.3)', color: 'var(--mc-pin)', fontSize: 11 }}>
                      ⚠️ 文件较大（{fileMeta.size?.toLocaleString?.() ?? ''} 字节），已截断显示，如需完整内容可在对话中让 AI 分段读取。
                    </div>
                  )}
                  <FoldText text={fileContent} />
                </div>
              ) : <div style={{ fontSize: 12, color: 'var(--mc-muted2)' }}>选择左侧文件查看内容</div>}
          </div>
        </div>
      )}

      {/* 变更记录（AI 读写文件后自动出现，可 diff + 撤销） */}
      {changes.length > 0 && (
        <div style={{ flexShrink: 0, maxHeight: '42%', borderTop: '1px solid var(--mc-hair)', display: 'flex', flexDirection: 'column', background: 'var(--mc-glass)', minHeight: 0 }}>
          <div style={{ padding: '7px 10px', fontSize: 12, fontWeight: 600, color: 'var(--mc-text)', borderBottom: '1px solid var(--mc-hair)' }}>
            文件变更（{changes.length}）· 可一键撤销
          </div>
          <div className="mc-scroll" style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {changes.map((c: any) => {
              const diff = lcsLineDiff(c.old || '', c.new || '').slice(0, 240);
              const adds = diff.filter(d => d.t === 'add').length;
              const dels = diff.filter(d => d.t === 'del').length;
              return (
                <div key={c.changeId} style={{ border: '1px solid var(--mc-hair)', borderRadius: 10, background: 'var(--mc-glass-strong)', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 9px', borderBottom: '1px solid var(--mc-hair)', background: 'var(--mc-glass)' }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.path}</span>
                    <span style={{ fontSize: 10.5, color: 'var(--mc-danger)' }}>-{dels}</span>
                    <span style={{ fontSize: 10.5, color: '#34C759' }}>+{adds}</span>
                    <button className="mc-pill" style={{ padding: '3px 8px' }} onClick={() => onRevert(c.changeId)}>撤销</button>
                  </div>
                  <div className="mc-scroll" style={{ maxHeight: 160, overflow: 'auto', padding: '4px 0', fontFamily: 'ui-monospace,Menlo,Consolas,monospace', fontSize: 11, lineHeight: 1.5 }}>
                    {diff.map((ln, idx) => (
                      <div key={idx} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', padding: '0 8px', color: ln.t === 'del' ? 'var(--mc-danger)' : ln.t === 'add' ? '#1a7f37' : 'var(--mc-muted)', background: ln.t === 'del' ? 'rgba(255,69,58,.08)' : ln.t === 'add' ? 'rgba(52,199,89,.10)' : 'transparent' }}>{ln.t === 'del' ? '- ' : ln.t === 'add' ? '+ ' : '  '}{ln.s}</div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// HistoryNavPanel —— 对话历史导航面板
// 左侧固定宽度 240px，列出当前对话最近 20 条消息（角色图标 + 前 30 字摘要 + 时间戳）。
// 点击任意条目 → 主区域滚动到对应消息 DOM 并高亮激活项；支持折叠/展开。
// =========================================================================
interface NavItem {
  id: string;
  role: string;
  content: string;
  ts: number;
}

function HistoryNavPanel({
  items,
  collapsed,
  onToggleCollapse,
  scrollRootRef,
}: {
  items: NavItem[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  scrollRootRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // 最近 20 条（倒序展示，最新在顶部，符合导航直觉）
  const recent = items.slice(-20).reverse();

  // 监听主滚动区，用 IntersectionObserver 计算当前可视区内最靠上的消息作为激活项。
  useEffect(() => {
    if (collapsed) return;
    const root = scrollRootRef.current;
    if (!root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        // 选与 root 相交、且 top 最接近 root 顶部的那条作为激活项
        let best: { id: string; top: number } | null = null;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const id = (e.target as HTMLElement).dataset.msgId;
          if (!id) continue;
          const top = e.boundingClientRect.top;
          if (!best || top < best.top) best = { id, top };
        }
        if (best) setActiveId(best.id);
      },
      { root, threshold: [0, 0.25, 0.5, 1], rootMargin: '0px 0px -70% 0px' },
    );
    // 观察所有带 data-msg-id 的消息 DOM
    const targets = root.querySelectorAll('[data-msg-id]');
    targets.forEach((t) => obs.observe(t));
    return () => obs.disconnect();
  }, [collapsed, items.length, scrollRootRef]);

  // 折叠态：只留一个竖条按钮，点击展开
  if (collapsed) {
    return (
      <div
        onClick={onToggleCollapse}
        title="展开对话历史导航"
        style={{
          width: 18,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          background: 'var(--mc-glass)',
          borderRight: '1px solid var(--mc-hair)',
          color: 'var(--mc-muted)',
          fontSize: 11,
        }}
      >
        ▶
      </div>
    );
  }

  return (
    <div
      style={{
        width: 240,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--mc-glass)',
        borderRight: '1px solid var(--mc-hair)',
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 10px',
          borderBottom: '1px solid var(--mc-hair)',
          gap: 6,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--mc-muted)' }}>对话历史</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={onToggleCollapse}
          title="收起"
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--mc-muted)',
            cursor: 'pointer',
            fontSize: 11,
            padding: '2px 4px',
            borderRadius: 4,
          }}
        >
          ▶
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {recent.length === 0 && (
          <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--mc-muted2)' }}>
            暂无消息
          </div>
        )}
        {recent.map((it) => {
          const isUser = it.role === 'user';
          const summary = it.content.replace(/\s+/g, ' ').trim().slice(0, 30) || (isUser ? '（空消息）' : '…');
          const time = new Date(it.ts);
          const hh = String(time.getHours()).padStart(2, '0');
          const mm = String(time.getMinutes()).padStart(2, '0');
          const active = activeId === it.id;
          return (
            <div
              key={it.id}
              onClick={() => {
                // 主滚动区位于面板右侧的同级容器；通过 data-msg-id 定位消息 DOM
                const root = scrollRootRef.current;
                const host = root?.closest('[data-mc-chatview]') as HTMLElement | null;
                const target = (host || document).querySelector(`[data-msg-id="${it.id}"]`) as HTMLElement | null;
                if (target) {
                  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  setActiveId(it.id);
                }
              }}
              style={{
                display: 'flex',
                gap: 6,
                padding: '6px 10px',
                cursor: 'pointer',
                fontSize: 12,
                lineHeight: 1.45,
                color: active ? 'var(--mc-accent)' : 'var(--mc-text)',
                background: active ? 'var(--mc-accent-soft)' : 'transparent',
                borderLeft: active ? '2px solid var(--mc-accent)' : '2px solid transparent',
                transition: 'background .12s, color .12s',
              }}
              onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--mc-hair)'; }}
              onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#fff',
                  background: isUser ? 'var(--mc-accent)' : '#8e8e93',
                }}
                title={isUser ? '用户' : 'AI'}
              >
                {isUser ? '我' : 'AI'}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {summary}
                </span>
                <span style={{ display: 'block', fontSize: 10, color: 'var(--mc-muted2)', fontVariantNumeric: 'tabular-nums' }}>
                  {hh}:{mm}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ChatPaneProps {
  paneId: 'A' | 'B';
  focused: boolean;
  view: 'chat' | 'files';
  openReq: OpenReq | null;
  initialSearchOn: boolean;
  sessions: Session[];
  modelOptions: ModelOption[];
  selectedModel: SelectedModel | null;
  onSelectModel: (m: SelectedModel) => void;
  onFocus: () => void;
  onViewChange: (v: 'chat' | 'files') => void;
  onPaneSessionKnown: (id: string | null) => void;
  onSessionsMutated: () => void;
  onOpenPreview?: (html: string) => void;
  onToast?: (msg: string) => void;
  runningSessionIds?: string[];
  style?: CSSProperties;
}

// 把消息时间戳格式化为「年-月-日 时:分」（支持 Date/epoch 数值，以及 SQLite 的 UTC 字符串）
function fmtMsgTime(ts?: number | string): string {
  if (ts === undefined || ts === null || ts === '') return '';
  let d: Date;
  if (typeof ts === 'number') d = new Date(ts);
  else {
    const s = String(ts);
    d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  }
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${da} ${hh}:${mm}`;
}

function ChatPane(props: ChatPaneProps) {
  const { paneId, focused, view, openReq, initialSearchOn, modelOptions, selectedModel, onSelectModel, onFocus, onViewChange, onPaneSessionKnown, onSessionsMutated, onOpenPreview, onToast, runningSessionIds } = props;

  const [sid, setSid] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<{ role: string; content: string; tokens?: number; error?: boolean; reasoning?: string; ts?: number | string; model?: string }[]>([]);
  // 服务端真实上下文用量（limit=模型 context window，used/sys/hist/tools/files 分项）
  const [ctxData, setCtxData] = useState<ServerCtx | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [thinkLevel, setThinkLevel] = useState(() => {
    const saved = localStorage.getItem('thinkLevel');
    return saved !== null ? Math.max(0, Math.min(4, parseInt(saved, 10))) : 2;
  });
  const [thinkTemp, setThinkTemp] = useState(() => LEVELS[thinkLevel].temp);
  const [searchOn, setSearchOn] = useState(initialSearchOn);
  const [showThink, setShowThink] = useState(false);
  const [showCtx, setShowCtx] = useState(false);
  const [showModel, setShowModel] = useState(false);
  // 对话栏「技能选择」：用户手动勾选、本次对话强制注入的技能（不受设置里 enabled 开关限制）
  const [showSkills, setShowSkills] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [skillOptions, setSkillOptions] = useState<{ name: string; description: string; enabled: number; source: string }[]>([]);
  // 对话栏「+」引用的文件（本地文件 / 对话中提到的文件）：inline=前端已读内容；path=后端安全读取
  const [showAttach, setShowAttach] = useState(false);
  const [attachments, setAttachments] = useState<{ id: string; name: string; path?: string; content?: string; mode: 'inline' | 'path' }[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [activeArtifact, setActiveArtifact] = useState<string | null>(null);
  // 文件视图内的子视图切换：产出文件（变更 + 产物统一列表，点击即预览）/ 工作区（文件系统浏览器）。
  const [wsTab, setWsTab] = useState<'output' | 'workspace'>('output');
  // 产出文件视图中选中的工作区文件变更（与 activeArtifact 互斥，点击列表即切换右侧面板）
  const [activeChangeId, setActiveChangeId] = useState<string | null>(null);
  // 文件变更：AI 在工作区读/写/编辑后由网关广播，跨会话订阅（sessionId=*），
  // 驱动「工作区」视图里的变更卡片（diff + 一键撤销）。仅 revertible 的 edit/write 进列表。
  const [fileChanges, setFileChanges] = useState<any[]>([]);
  // 撤销某次文件变更（调用后端 fsRevert 并移除卡片）
  const revertFile = (changeId: string) => {
    fetch('/api/fs/revert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changeId }) })
      .then(r => r.json()).then(d => {
        if (d.ok) { setFileChanges(prev => prev.filter(c => c.changeId !== changeId)); onToast?.('已撤销：' + changeId); }
        else onToast?.('撤销失败：' + (d.error || ''));
      }).catch(e => onToast?.('撤销失败：' + e.message));
  };

  // 拉取全部技能（含未启用的），供对话栏「技能选择」使用——用户可手动勾选任意技能强制注入
  const loadSkillOptions = () => {
    fetch('/api/skills').then(r => r.json()).then(d => {
      if (Array.isArray(d)) {
        setSkillOptions(d.map((s: any) => ({ name: s.name, description: s.description || '', enabled: s.enabled ? 1 : 0, source: s.source || '' })));
      }
    }).catch(() => {});
  };
  useEffect(() => { loadSkillOptions(); }, []);

  // 连接状态与看门狗：SSE 连接断开/长时间无令牌时给出反馈
  const [conn, setConn] = useState<'connecting' | 'open' | 'reconnecting'>('connecting');
  const [stalled, setStalled] = useState(false);
  // 新建会话的「会话创建中」过渡态（点击新对话后短暂展示，对标 WorkBuddy）
  const [creatingSession, setCreatingSession] = useState(false);
  const creatingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTokenRef = useRef<number>(Date.now());
  // 本轮是否收到过 chat-error：防止成功分支的 loadSession 回填把错误提示覆盖掉
  const hadErrorRef = useRef(false);
  // 是否为「新会话首条消息」的生成中（用于把思考态文案显示为「会话创建中…」）
  const isFirstOfSessionRef = useRef(false);

  // 简易 Trace：最近一次请求的调用瀑布（SSE 实时增量推送 / 可历史回看 / 可展开详情）
  const [showTrace, setShowTrace] = useState(false);
  const [trace, setTrace] = useState<any>(null);
  // 工具调用步骤（SSE 实时推送，前端以卡片形式展示「正在调用工具」，配合流式输出）
  const [steps, setSteps] = useState<any[]>([]);
  // 任务规划清单（WorkBuddy 式）：规划阶段 [TODO:...] 步骤清单，随 step 完成逐个打勾
  const [todos, setTodos] = useState<{ id: string; content: string; status: 'pending' | 'running' | 'done' }[]>([]);
  // 思考/推理内容（SSE reasoning 事件实时累积，前端以可折叠「思考过程」块展示）
  const [reasoning, setReasoning] = useState('');
  // 对话历史导航面板的展开/折叠状态（默认折叠，WorkBuddy 风格优先正文宽度；持久化）
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => {
    const saved = localStorage.getItem('mc-nav-collapsed');
    return saved ? saved === '1' : true;
  });
  // 用户若手动关闭过 Trace 面板，则后续请求不再自动弹出（仍可在头部点开）
  const traceUserClosedRef = useRef(false);

  const clientIdRef = useRef<string>('');
  if (!clientIdRef.current) {
    clientIdRef.current = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  }
  const streamKey = sid || clientIdRef.current;
  // 供 previewClient.subscribe 回调读取「当前最新 sid」（回调只注册一次，闭包内 sid 会过期）
  const sidRef = useRef<string | null>(null);
  sidRef.current = sid;

  const bottomRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 对话历史导航面板：指向主消息滚动区，IntersectionObserver 用它作 root
  const historyScrollRef = useRef<HTMLDivElement>(null);

  // 对话历史导航：为每条消息记录稳定 id + 时间戳，驱动左侧导航面板的摘要/时间/跳转。
  // 与 msgs 数组按下标对齐；msgs 变化时只补齐新增项，已有项的 id/timestamp 保持不变。
  const msgMetaRef = useRef<{ id: string; ts: number }[]>([]);
  if (msgMetaRef.current.length !== msgs.length) {
    const next: { id: string; ts: number }[] = [];
    for (let i = 0; i < msgs.length; i++) {
      const prev = msgMetaRef.current[i];
      // 复用既有 meta（保留原 id 与 ts），没有就当场生成
      if (prev) next.push(prev);
      else next.push({
        id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2),
        ts: Date.now(),
      });
    }
    msgMetaRef.current = next;
  }

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  // 同步来自 ChatPage 的搜索开关初值（/api/search-config 异步加载后下发一次）
  useEffect(() => { setSearchOn(initialSearchOn); }, [initialSearchOn]);

  // 计时器：busy 时每秒 +1
  useEffect(() => {
    if (busy) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(p => p + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [busy]);

  // 每条 SSE（按 sessionId 隔离）→ 该 Pane 独立流式接收，杜绝串台
  useEffect(() => {
    const es = new EventSource(`/api/stream?sessionId=${encodeURIComponent(streamKey)}`);
    setConn('connecting');
    es.onopen = () => setConn('open');
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === 'ping') return;
        if (d.type === 'artifact') return; // 预览由 previewClient 处理
        // 文件变更：会话级接收（只收本会话的变更，杜绝跨会话串台）；
        // 仅把可撤销的 edit/write 写入 fileChanges（read 不进列表，仅活动提示）。
        if (d.type === 'file-change' && d.change && d.change.revertible) {
          setFileChanges(prev => {
            if (prev.some(c => c.changeId === d.change.changeId)) return prev;
            // 补 ts 时间戳（SSE 事件本身不带时间）+ sessionId（用于会话隔离展示）
            return [...prev, { ...d.change, sessionId: d.sessionId, ts: Date.now() }];
          });
          return;
        }
        // 简易 Trace：实时流式（start/span 增量边收边画，trace 最终校准）
        if (d.type === 'trace-start') { setTrace(d.trace); if (!traceUserClosedRef.current) setShowTrace(true); return; }
        if (d.type === 'trace-span') { setTrace((prev: any) => mergeTraceSpan(prev, d.phase, d.span)); return; }
        if (d.type === 'trace') { setTrace(d); return; }
        // 工具调用步骤：实时累积（running→done/error），驱动对话流内的「工具调用提示」卡片
        if (d.type === 'step') { setSteps((prev: any[]) => mergeStep(prev, d.step)); return; }
        // 任务规划清单：规划阶段 [TODO:...] 步骤清单，前端实时展示任务清单
        if (d.type === 'todos') {
          setTodos((Array.isArray(d.todos) ? d.todos : []).map((t: any) => ({ id: t.id, content: t.content, status: 'pending' as const })));
          return;
        }
        // 思考/推理内容：实时累积，驱动对话流内的「思考过程」可折叠块。
        // 同时写入当前最后一条 assistant 消息（按消息存储，历史/切换会话后不丢）。
        if (d.type === 'reasoning') {
          const rc = d.content || '';
          setReasoning((prev: string) => prev + rc);
          if (rc) {
            setMsgs((prev) => {
              const c = prev.slice();
              const last = c[c.length - 1];
              if (last && last.role === 'assistant') {
                c[c.length - 1] = { ...last, reasoning: (last.reasoning || '') + rc };
              }
              return c;
            });
          }
          return;
        }
        // 失败事件：在服务端已抛错，这里给出明确反馈而非一直转圈
        if (d.type === 'chat-error') {
          hadErrorRef.current = true;
          setMsgs(prev => {
            const c = prev.slice();
            if (c.length && c[c.length - 1].role === 'assistant') {
              c[c.length - 1] = { ...c[c.length - 1], content: `请求失败：${d.error}`, error: true };
            }
            return c;
          });
          // 兜底：把仍在「进行中」的步骤标记为失败
          setSteps(prev => prev.map((s: any) => s.status === 'running' ? { ...s, status: 'error', error: d.error } : s));
          setBusy(false);
          setConn('open');
          setStalled(false);
          return;
        }
        // token：即使 done 也先拼接内容，避免丢最后一包
        if (d.content) {
          isFirstOfSessionRef.current = false; // 收到首个正文片段，首条创建态结束
          lastTokenRef.current = Date.now();
          setMsgs(prev => {
            const c = prev.slice();
            const last = c[c.length - 1];
            if (last && last.role === 'assistant') c[c.length - 1] = { ...last, content: last.content + d.content };
            return c;
          });
        }
        if (d.done) {
          // 兜底：把仍在「进行中」的步骤标记为完成（防御后端未发终态）
          setSteps(prev => prev.map((s: any) => s.status === 'running' ? { ...s, status: 'done', endedAt: Date.now() } : s));
          // 后端在 done 事件里带回实际生成该回复的模型与 token 数，回填到最后一条 assistant 消息
          if (d.model || d.tokens != null) {
            setMsgs(prev => {
              const c = prev.slice();
              const last = c[c.length - 1];
              if (last && last.role === 'assistant') c[c.length - 1] = { ...last, model: d.model ?? last.model, tokens: d.tokens ?? last.tokens };
              return c;
            });
          }
          setBusy(false); setConn('open'); setStalled(false);
          // 本轮结束：刷新服务端真实上下文用量（新消息已落库，进度条随之更新）
          if (sid) {
            fetch(`/api/sessions/${sid}/context`).then(r => r.json()).then((c: any) => {
              if (c && typeof c.limit === 'number' && c.limit > 0) setCtxData(c);
            }).catch(() => {});
          }
        }
      } catch { /* ignore */ }
    };
    es.onerror = () => { setConn('reconnecting'); }; // EventSource 会自动重连
    return () => es.close();
  }, [streamKey]);

  // 看门狗：生成中若超过 45s 无新令牌，判定连接可能已断开
  useEffect(() => {
    if (!busy) { setStalled(false); return; }
    lastTokenRef.current = Date.now();
    const t = setInterval(() => {
      if (busy && Date.now() - lastTokenRef.current > 45000) setStalled(true);
    }, 5000);
    return () => clearInterval(t);
  }, [busy]);

  // 文件视图：复用 previewClient（SSE 全局订阅 artifact），与 PreviewPage 同源
  useEffect(() => {
    previewClient.start();
    const unsub = previewClient.subscribe((list) => {
      setArtifacts(list);
      // 只自动选中「当前会话」的第一个产物：previewClient 是全应用全局列表，
      // 直接用 list[0] 会把其它会话的产物选进来（双 Pane 串台）。
      setActiveArtifact((prev) => {
        const cur = sidRef.current;
        const pane = cur ? list.filter(a => a.sessionId === cur) : [];
        if (prev && pane.some(a => a.id === prev)) return prev; // 用户已选中且属于本会话则保留
        return pane[0]?.id ?? null;
      });
    });
    return unsub;
  }, []);

  // 切换会话：重置本会话专属的选中项与变更列表。
  // file-change 由会话级 SSE 按新 sid 重新接收；旧会话的产物/变更不再展示。
  useEffect(() => {
    setActiveChangeId(null);
    setFileChanges([]);
    // 选中产物收敛到「当前会话」的第一个（与 previewClient.subscribe 的收敛逻辑一致）
    setActiveArtifact((prev) => {
      const cur = sid;
      const pane = cur ? artifacts.filter(a => a.sessionId === cur) : [];
      if (prev && pane.some(a => a.id === prev)) return prev;
      return pane[0]?.id ?? null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid]);

  // 文件变更已改由会话级 SSE（上方 /api/stream?sessionId=streamKey）接收，
  // 每个 Pane 只收自己会话的变更，不再开全局 sessionId=* 订阅（避免跨会话串台与重复连接）。

  // 「发给对话」桥：工作区浏览器把文件/片段作为提示推给「当前聚焦」的对话窗格
  useEffect(() => {
    function onSend(ev: Event) {
      const text = (ev as CustomEvent).detail;
      if (!text || !focused) return; // 仅聚焦窗格响应，避免双窗同时发送
      setInput(prev => (prev ? prev + '\n' + text : text));
    }
    window.addEventListener('mc-send', onSend as EventListener);
    return () => window.removeEventListener('mc-send', onSend as EventListener);
  }, [focused]);

  // 响应 ChatPage 下发的「打开/新建」请求（nonce 变化才触发）
  useEffect(() => {
    if (!openReq || openReq.pane !== paneId) return;
    if (openReq.sessionId === null) {
      // 新建：清空本 Pane，并进入「会话创建中」过渡态（短暂展示，对标 WorkBuddy 新会话提示）
      setSid(null); setMsgs([]); setBusy(false); setShowThink(false); setShowCtx(false);
      setCreatingSession(true);
      if (creatingTimerRef.current) clearTimeout(creatingTimerRef.current);
      creatingTimerRef.current = setTimeout(() => setCreatingSession(false), 700);
      onPaneSessionKnown(null);
    } else {
      loadSession(openReq.sessionId);
      onPaneSessionKnown(openReq.sessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openReq]);

  async function loadSession(id: string) {
    // 切回一个「仍在后台生成中」的会话时保持 busy（动画恢复），不要误清为空闲
    const stillRunning = runningSessionIds?.includes(id);
    setSid(id); setBusy(!!stillRunning); setShowThink(false); setShowCtx(false);
    try {
      const d = await (await fetch(`/api/sessions/${id}`)).json();
      // 注意：兜底回填仅「以服务端为准」修正流式可能的丢包；若接口异常/格式不符，
      // 保留前端已流式出的内容，绝不把正在显示的回复清空（否则会出现「回复消失了」）。
      if (d && Array.isArray(d.messages)) {
        // 若该会话仍在后台生成：服务端尚未落库 assistant，回填用户消息即可，
        // 已流出的回复内容由本 Pane 的 SSE（streamKey=sid）后续 token 续上。
        setMsgs(d.messages.map((m: any) => ({ role: m.role, content: m.content, tokens: m.tokens, reasoning: m.reasoning || '', ts: m.ts, model: m.model })));
      }
    } catch { /* 保留已流式内容，网络抖动时不要把回复清空 */ }
    // 拉取服务端真实上下文用量（模型 context window + 分项估算），驱动进度条
    try {
      const c = await (await fetch(`/api/sessions/${id}/context`)).json();
      if (c && typeof c.limit === 'number' && c.limit > 0) setCtxData(c);
    } catch { /* 接口失败保留旧值/本地兜底 */ }
  }

  // 发送一条消息。resend=true 时复用既有用户消息（重试失败回复），不再新增气泡。
  async function sendText(text: string, forceSid?: string, resend = false) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setStalled(false);
    hadErrorRef.current = false;
    if (!resend) {
      setInput('');
      setMsgs(prev => [...prev, { role: 'user', content: trimmed }, { role: 'assistant', content: '', reasoning: '', ts: Date.now(), model: '' }]);
    } else {
      setMsgs(prev => [...prev, { role: 'assistant', content: '', reasoning: '', ts: Date.now(), model: '' }]);
    }
    setBusy(true);
    setSteps([]);
    setReasoning('');
    // 新会话：客户端先生成 sessionId 并写入本地 sid，使本 Pane 的 SSE（按 sessionId
    // 隔离广播）与服务端实际使用的 sessionId 一致——后端还会缓冲本轮令牌，连上即回放，
    // 双保险避免首条流式回复串台/丢包、`done` 收不到导致 busy 永不复位。
    const targetSid = forceSid || sid || (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2));
    if (!sid) { setSid(targetSid); isFirstOfSessionRef.current = true; } // 首条消息即会话创建中
    try {
      const data = await (await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: trimmed, sessionId: targetSid, temperature: thinkTemp, resend,
          ...(selectedModel ? { providerId: selectedModel.providerId, model: selectedModel.model } : {}),
          ...(selectedSkills.length ? { skillNames: [...selectedSkills] } : {}),
          ...(attachments.length ? { attachments: attachments.map(a => ({ name: a.name, path: a.path, content: a.content, mode: a.mode })) } : {}),
        }),
      })).json();
      // 首条消息由服务端创建会话 → 回写 sessionId 并刷新侧边栏
      if (data.sessionId && data.sessionId !== sid) {
        setSid(data.sessionId);
        onPaneSessionKnown(data.sessionId);
        onSessionsMutated();
      }
      if (data.error && !hadErrorRef.current) {
        // SSE 已通过 chat-error 事件处理过则跳过，避免重复错误气泡 + 重复 toast
        setMsgs(prev => { const c = prev.slice(); if (c.length) c[c.length - 1] = { ...c[c.length - 1], content: `请求失败：${data.error}`, error: true }; return c; });
        setBusy(false);
        onToast?.('回复失败：' + data.error);
      } else if (data.error && hadErrorRef.current) {
        // SSE 已展示错误，这里仅兜底清 busy（chat-error 处理器已清，双保险）
        setBusy(false);
      } else {
        // 兜底回填：以服务端存储的最终内容为准，确保流式丢包时不丢字
        await loadSession(targetSid);
      }
    } catch (err: any) {
      setMsgs(prev => { const c = prev.slice(); if (c.length) c[c.length - 1] = { ...c[c.length - 1], content: `请求失败：${err.message}`, error: true }; return c; });
      setBusy(false);
      onToast?.('连接异常：' + err.message);
    }
  }

  // 重试最后一条失败回复（复用既有用户消息，标记 resend 避免重复入库）
  function retryLast() {
    const lastUser = [...msgs].reverse().find(m => m.role === 'user');
    if (!lastUser) return;
    setMsgs(prev => {
      const c = prev.slice();
      while (c.length && c[c.length - 1].role === 'assistant' && c[c.length - 1].error) c.pop();
      return c;
    });
    sendText(lastUser.content, sid || undefined, true);
  }

  // 复制/分享结果 → toast
  function handleActionResult(r: any) {
    if (r === 'copied') onToast?.('已复制到剪贴板');
    else if (r === 'shared') onToast?.('已分享');
    else if (r === 'failed') onToast?.('复制失败，请手动选择文本');
  }

  async function handleSend() {
    await sendText(input);
  }

  async function handleStop() {
    if (!sid) return;
    setStalled(false);
    try {
      await fetch('/api/chat/abort', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sid }) });
    } catch { /* ignore */ }
    // 若末条 assistant 仍为空（尚未产出内容），明确标记「已停止」，避免空白气泡无提示
    setMsgs(prev => {
      const c = prev.slice();
      const last = c[c.length - 1];
      if (last && last.role === 'assistant' && !last.content && !last.error) {
        c[c.length - 1] = { ...last, content: '（已停止生成）' };
      }
      return c;
    });
    setBusy(false);
  }

  function setLevel(v: number) {
    const l = Math.max(0, Math.min(4, Math.round(v)));
    setThinkLevel(l);
    setThinkTemp(LEVELS[l].temp);
    localStorage.setItem('thinkLevel', String(l));
  }

  function extractHtml(text: string): string | null {
    const m = text.match(/```html\s*\n?([\s\S]*?)```/);
    return m ? m[1] : null;
  }

  // 会话隔离：previewClient 的产物是全应用全局列表，这里只取「当前会话」的产物与变更
  // （每个对话独立，文件提及只属于本对话，避免双 Pane 串台）。附件面板与文件视图共用。
  const paneArtifacts = sid ? artifacts.filter(a => a.sessionId === sid) : [];
  const paneChanges = sid ? fileChanges.filter(c => c.sessionId === sid) : [];

  const sessionTitle = (() => {
    if (view === 'files') return '文件预览';
    const s = props.sessions.find(x => x.id === sid);
    return s ? s.title : '未选择对话';
  })();

  const ctx = computeCtx(msgs, ctxData);
  const ctxPct = Math.min(100, Math.round(ctx.used / ctx.limit * 100));
  const ctxColor = ctxPct > 90 ? 'var(--mc-danger)' : ctxPct > 70 ? 'var(--mc-pin)' : 'var(--mc-accent)';

  // ── 视图切换（对话 / 文件）──
  function setView(v: 'chat' | 'files') { onViewChange(v); setShowThink(false); setShowCtx(false); }

  // ── 工具栏：联网搜索 / 思考强度 / 上下文用量 ──
  function toggleSearch() {
    const next = !searchOn;
    setSearchOn(next);
    fetch('/api/search-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: next, provider: 'duckduckgo' }) }).catch(() => {});
  }
  function toggleThink() {
    const open = !showThink;
    setShowThink(open); setShowCtx(false); setShowAttach(false);
  }
  function toggleCtx() {
    const open = !showCtx;
    setShowCtx(open); setShowThink(false); setShowAttach(false);
  }
  function toggleModel() {
    const open = !showModel;
    setShowModel(open); setShowThink(false); setShowCtx(false); setShowAttach(false);
  }
  function toggleSkills() {
    const open = !showSkills;
    setShowSkills(open); setShowModel(false); setShowThink(false); setShowCtx(false); setShowAttach(false);
  }
  function toggleAttach() {
    const open = !showAttach;
    setShowAttach(open); setShowModel(false); setShowSkills(false); setShowThink(false); setShowCtx(false);
  }

  // 用户从「+」本地文件选择框选中的文件：小文本内联（前端读内容），大文件/二进制仅引用路径（后端安全读取）。
  const INLINE_LIMIT = 60 * 1024; // 60KB 以下小文本内联
  const TEXT_EXT = ['txt', 'md', 'markdown', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'hpp', 'cs', 'css', 'scss', 'less', 'html', 'htm', 'xml', 'yml', 'yaml', 'toml', 'ini', 'conf', 'sh', 'bash', 'bat', 'ps1', 'log', 'csv', 'sql', 'tex', 'vue', 'svelte', 'php', 'rb', 'swift', 'kt', 'dart', 'r', 'pl'];
  const isTextLike = (name: string) => TEXT_EXT.includes((name.split('.').pop() || '').toLowerCase());
  const handlePickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (fileInputRef.current) fileInputRef.current.value = '';
    const next: { id: string; name: string; path?: string; content?: string; mode: 'inline' | 'path' }[] = [];
    for (const f of files) {
      const small = f.size <= INLINE_LIMIT;
      if (small && isTextLike(f.name)) {
        const reader = new FileReader();
        reader.onload = () => {
          setAttachments(prev => [...prev, { id: 'att-' + Math.random().toString(36).slice(2), name: f.name, content: String(reader.result || ''), mode: 'inline' }]);
        };
        reader.readAsText(f);
      } else if ((f as any).path) {
        // 大文件 / 二进制：仅引用路径。Electron 渲染端 file.path 在 contextIsolation 下可能缺失——缺失则提示（后续由 IPC 通道补强）。
        next.push({ id: 'att-' + Math.random().toString(36).slice(2), name: f.name, path: (f as any).path, mode: 'path' });
      } else {
        onToast?.('无法引用「' + f.name + '」：文件过大且无法获取本地路径，请改用设置里配置的工作区，或等待 IPC 文件选择通道接入。');
      }
    }
    if (next.length) setAttachments(prev => [...prev, ...next]);
  };

  // ── Chat 视图 ──
  // 本轮生成阶段（思考中 → 调用工具 → 撰写回答），驱动 StageIndicator 实时推进
  const lastMsg = msgs[msgs.length - 1];
  const lastIsAssistant = lastMsg?.role === 'assistant';
  const hasContent = !!lastIsAssistant && (lastMsg.content?.length || 0) > 0;
  const stage: 'thinking' | 'tooling' | 'writing' = !hasContent ? (steps.length > 0 ? 'tooling' : 'thinking') : 'writing';

  const chatView = (
    <div data-mc-chatview style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {showTrace && <TraceWaterfall trace={trace} />}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <HistoryNavPanel
          items={msgs.map((m, i) => ({
            id: msgMetaRef.current[i]?.id || String(i),
            role: m.role,
            content: m.content,
            ts: msgMetaRef.current[i]?.ts || Date.now(),
          }))}
          collapsed={navCollapsed}
          onToggleCollapse={() => {
            const next = !navCollapsed;
            setNavCollapsed(next);
            localStorage.setItem('mc-nav-collapsed', next ? '1' : '0');
          }}
          scrollRootRef={historyScrollRef}
        />
        <div className="mc-scroll" style={{ flex: 1, overflowY: 'auto', background: 'transparent' }} ref={historyScrollRef}>
        {/* 消息居中窄列（WorkBuddy / ChatGPT 式正文排版） */}
        <div style={{ maxWidth: 780, margin: '0 auto', padding: '24px 28px 40px' }}>
        {msgs.length === 0 && (
          <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mc-muted2)', fontSize: 14, gap: 8 }}>
            {creatingSession ? (
              <>
                <span className="mc-spin" style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid var(--mc-accent)', borderTopColor: 'transparent' }} />
                <span>会话创建中…</span>
              </>
            ) : (
              <>
                <IconChat /><span>开始新对话</span>
              </>
            )}
          </div>
        )}
        {stalled && (
          <div className="mc-banner">
            <span>正在等待回复，服务端超过 45s 未返回新内容，可能是网络或服务端较慢。可点重试，或检查连接。</span>
            <button onClick={retryLast}>重试</button>
          </div>
        )}
        {msgs.map((m, i) => {
          const isAssistant = m.role === 'assistant';
          const isLast = i === msgs.length - 1;
          const showThinking = isAssistant && busy && isLast && !m.content && !m.error && steps.length === 0 && reasoning.length === 0;
          return (
            <Fragment key={i}>
              {isAssistant && (
                <>
                  {m.reasoning && m.reasoning.length > 0 && <ReasoningBlock text={m.reasoning} />}
                  {isLast && todos.length > 0 && <TodoList todos={todos} doneCount={steps.filter((s: any) => s.status !== 'running').length} />}
                  {isLast && steps.length > 0 && <ToolSteps steps={steps} />}
                  {isLast && busy && <StageIndicator stage={stage} hasTool={steps.length > 0} />}
                  {isLast && busy && isFirstOfSessionRef.current && !m.content && !m.error && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--mc-muted)', margin: '2px 0 8px' }}>
                      <span className="mc-spin" style={{ width: 13, height: 13, borderRadius: '50%', border: '2px solid var(--mc-accent)', borderTopColor: 'transparent' }} />
                      <span>会话创建中…</span>
                    </div>
                  )}
                </>
              )}
              <div className="mc-msg" data-msg-id={msgMetaRef.current[i]?.id} style={{ position: 'relative', display: 'flex', marginBottom: 16, gap: 10, justifyContent: isAssistant ? 'flex-start' : 'flex-end' }}>
              {/* AI 头像（WorkBuddy 式：左侧渐变圆形标识） */}
              {isAssistant && (
                <div style={{
                  width: 32, height: 32, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 55%, #a855f7 100%)',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: 'var(--mc-shadow-sm)',
                }}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a7 7 0 0 0-7 7c0 2.5 1.3 4.7 3.2 6 .5.3.8.9.8 1.5V18a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-1.5c0-.6.3-1.2.8-1.5A7 7 0 0 0 19 9a7 7 0 0 0-7-7z" />
                  </svg>
                </div>
              )}
              <div style={{ maxWidth: isAssistant ? 'calc(100% - 44px)' : '82%', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <div style={{
                padding: isAssistant ? '12px 16px' : '10px 16px',
                borderRadius: isAssistant ? '4px 16px 16px 16px' : '16px 16px 4px 16px',
                lineHeight: 1.65, fontSize: 14,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', boxShadow: 'var(--mc-shadow-sm)',
                background: m.error ? 'rgba(255,69,58,.10)' : isAssistant ? 'var(--mc-bubble-ai)' : 'var(--mc-accent)',
                color: m.error ? 'var(--mc-danger)' : isAssistant ? 'var(--mc-msg-ai)' : '#fff',
                border: m.error ? '1px solid var(--mc-danger)' : isAssistant ? '1px solid var(--mc-hair)' : 'none',
              }}>
                {showThinking ? (
                  <StatusTextRotation level={thinkLevel <= 1 ? 0 : thinkLevel === 2 ? 1 : 2} elapsed={elapsed} />
                ) : isAssistant ? (
                  (busy && isLast && !m.content && !m.error) ? (
                    // 生成中但正文尚未到达（如工具调用/文件读取等待期）：呼吸徽章 + 轮播文案
                    <WaitingIndicator hasTool={steps.length > 0} />
                  ) : <AssistantBody text={m.content} streaming={isLast && busy && !m.error} />
                ) : (
                  m.content
                )}
              </div>
              {isAssistant && (m.content || m.error) && (
                <div style={{ fontSize: 11, color: 'var(--mc-muted2)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingLeft: 2 }}>
                  <span>{fmtMsgTime(m.ts)}</span>
                  {m.model && <span>· {m.model}</span>}
                  {typeof m.tokens === 'number' && m.tokens > 0 && <span>· {m.tokens.toLocaleString()} tokens</span>}
                </div>
              )}
              </div>
              {isAssistant && (m.content || m.error) && (
                <div className="mc-actions" style={{ position: 'absolute', top: -12, left: 40, display: 'flex', alignItems: 'center', gap: 2, background: 'var(--mc-glass-strong)', border: '1px solid var(--mc-hair)', borderRadius: 10, padding: 2, boxShadow: 'var(--mc-shadow-sm)', zIndex: 5 }}>
                  <MessageActions text={m.content} title="MiniClaw 回复" iconColor="var(--mc-muted)" hoverBg="var(--mc-seg)" onResult={handleActionResult} />
                  {m.error && (
                    <button title="重试" onClick={retryLast}
                      style={{ border: 'none', background: 'transparent', color: 'var(--mc-accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '0 8px 0 4px' }}>
                      重试
                    </button>
                  )}
                </div>
              )}
              {isAssistant && !busy && !m.error && extractHtml(m.content) && onOpenPreview && (
                <button onClick={() => onOpenPreview(extractHtml(m.content)!)}
                  style={{ marginTop: 4, padding: '3px 10px', background: 'var(--mc-glass)', border: '1px solid var(--mc-hair)', borderRadius: 8, cursor: 'pointer', fontSize: 11, color: 'var(--mc-muted)' }}>
                  在预览中打开
                </button>
              )}
            </div>
            </Fragment>
          );
        })}
        <div ref={bottomRef} />
        </div>{/* 消息居中窄列 */}
        </div>
      </div>

      {/* 底部输入区：与消息列同宽居中（WorkBuddy 式） */}
      <div className="mc-composer" style={{ borderTop: '1px solid var(--mc-hair)', padding: '10px 16px 14px', background: 'var(--mc-glass)', backdropFilter: 'blur(16px) saturate(180%)', WebkitBackdropFilter: 'blur(16px) saturate(180%)' }}>
        <div style={{ maxWidth: 780, margin: '0 auto' }}>
        {selectedSkills.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {selectedSkills.map(n => (
              <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, padding: '3px 8px', borderRadius: 14, background: 'var(--mc-accent-soft)', color: 'var(--mc-accent)' }}>
                <IconSkills />{n}
                <span onClick={() => setSelectedSkills(prev => prev.filter(x => x !== n))} style={{ cursor: 'pointer', display: 'flex', marginLeft: 1 }}><IconCross /></span>
              </span>
            ))}
            <span onClick={() => setSelectedSkills([])} style={{ cursor: 'pointer', fontSize: 11.5, color: 'var(--mc-muted2)', alignSelf: 'center', padding: '3px 4px' }}>清除</span>
          </div>
        )}
        {attachments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {attachments.map(a => (
              <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, padding: '3px 8px', borderRadius: 14, background: 'rgba(128,128,128,0.16)', color: 'var(--mc-text)' }}>
                <IconFile />{a.name}
                <span onClick={() => setAttachments(prev => prev.filter(x => x.id !== a.id))} style={{ cursor: 'pointer', display: 'flex', marginLeft: 1 }}><IconCross /></span>
              </span>
            ))}
            <span onClick={() => setAttachments([])} style={{ cursor: 'pointer', fontSize: 11.5, color: 'var(--mc-muted2)', alignSelf: 'center', padding: '3px 4px' }}>清除</span>
          </div>
        )}
        <div className="mc-tools" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, position: 'relative' }}>
          {/* 模型选择（opencode/workbuddy 风） */}
          <button className={`mc-pill ${showModel ? 'open' : ''}`} onClick={toggleModel} title="切换模型 / 服务商">
            <IconModel />
            <span style={{ maxWidth: 130, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {selectedModel?.model || modelOptions[0]?.models?.[0] || '选择模型'}
            </span>
          </button>
          {showModel && (
            <div style={{ position: 'absolute', bottom: 38, left: 0, zIndex: 7, minWidth: 240, maxWidth: 320, maxHeight: 260, overflowY: 'auto', background: 'var(--mc-glass-strong)', backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)', border: '1px solid var(--mc-hair)', borderRadius: 14, padding: 6, boxShadow: 'var(--mc-shadow-md)' }}>
              {modelOptions.length === 0 && (
                <div style={{ padding: '10px 12px', fontSize: 12.5, color: 'var(--mc-muted)' }}>没有可用的服务商，请到「设置」启用。</div>
              )}
              {modelOptions.map(opt => (
                <div key={opt.providerId}>
                  <div style={{ fontSize: 11, color: 'var(--mc-muted2)', padding: '6px 10px 3px', fontWeight: 600 }}>{opt.providerName}</div>
                  {opt.models.map(m => {
                    const isActive = selectedModel?.providerId === opt.providerId && selectedModel?.model === m;
                    return (
                      <button key={m} onClick={() => { onSelectModel({ providerId: opt.providerId, model: m }); setShowModel(false); }}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                          padding: '6px 10px', border: 'none', background: isActive ? 'var(--mc-accent-soft)' : 'transparent',
                          borderRadius: 9, fontSize: 12.5, color: isActive ? 'var(--mc-accent)' : 'var(--mc-text)',
                          cursor: 'pointer', textAlign: 'left', margin: '1px 0',
                        }}>
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m}</span>
                        {isActive && <span style={{ color: 'var(--mc-accent)', fontSize: 12 }}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          {/* 技能选择（WorkBuddy 风：手动勾选本次对话要强制启用的技能） */}
          <button className={`mc-pill ${showSkills ? 'open' : ''}`} onClick={toggleSkills} title="选择本次对话要启用的技能">
            <IconSkills />
            <span>技能{selectedSkills.length > 0 ? ` · ${selectedSkills.length}` : ''}</span>
          </button>
          {showSkills && (
            <div style={{ position: 'absolute', bottom: 38, left: 0, zIndex: 7, minWidth: 260, maxWidth: 340, maxHeight: 300, overflowY: 'auto', background: 'var(--mc-glass-strong)', backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)', border: '1px solid var(--mc-hair)', borderRadius: 14, padding: 6, boxShadow: 'var(--mc-shadow-md)' }}>
              <div style={{ fontSize: 11, color: 'var(--mc-muted2)', padding: '4px 10px 6px', fontWeight: 600 }}>选择技能（勾选后本次对话强制启用）</div>
              {skillOptions.length === 0 && (
                <div style={{ padding: '10px 12px', fontSize: 12.5, color: 'var(--mc-muted)' }}>还没有技能，请到「设置 → 技能」导入。</div>
              )}
              {skillOptions.map(opt => {
                const checked = selectedSkills.includes(opt.name);
                return (
                  <button key={opt.name} onClick={() => setSelectedSkills(prev => checked ? prev.filter(n => n !== opt.name) : [...prev, opt.name])}
                    style={{ width: '100%', display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 10px', border: 'none', background: 'transparent', borderRadius: 9, fontSize: 12.5, color: 'var(--mc-text)', cursor: 'pointer', textAlign: 'left', margin: '1px 0' }}>
                    <span style={{ marginTop: 1, width: 15, height: 15, borderRadius: 4, border: `1.5px solid ${checked ? 'var(--mc-accent)' : 'var(--mc-hair)'}`, background: checked ? 'var(--mc-accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {checked && <IconCheck />}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{opt.name}</span>
                      {opt.description && <span style={{ display: 'block', fontSize: 11, color: 'var(--mc-muted2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{opt.description}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {/* 引用文件（WorkBuddy「+」风：本地文件 / 对话中提到的文件） */}
          <button className={`mc-pill ${showAttach ? 'open' : ''}`} onClick={toggleAttach} title="引用文件（本地 / 对话中提到的）">
            <IconPlus />
            <span>引用{attachments.length > 0 ? ` · ${attachments.length}` : ''}</span>
          </button>
          {showAttach && (
            <div style={{ position: 'absolute', bottom: 38, left: 0, zIndex: 7, minWidth: 260, maxWidth: 340, maxHeight: 320, overflowY: 'auto', background: 'var(--mc-glass-strong)', backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)', border: '1px solid var(--mc-hair)', borderRadius: 14, padding: 6, boxShadow: 'var(--mc-shadow-md)' }}>
              <div style={{ fontSize: 11, color: 'var(--mc-muted2)', padding: '4px 10px 6px', fontWeight: 600 }}>本地文件</div>
              <button onClick={() => fileInputRef.current?.click()} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: 'none', background: 'transparent', borderRadius: 9, fontSize: 12.5, color: 'var(--mc-text)', cursor: 'pointer', textAlign: 'left', margin: '1px 0' }}>
                <IconFile /><span>选择文件…（可多选，≤60KB 文本内联）</span>
              </button>
              <div style={{ fontSize: 11, color: 'var(--mc-muted2)', padding: '8px 10px 4px', fontWeight: 600 }}>对话中提到的文件</div>
              {paneArtifacts.filter(a => a.kind !== 'image' && typeof a.content === 'string').length === 0 && paneChanges.length === 0 && (
                <div style={{ padding: '8px 12px', fontSize: 12.5, color: 'var(--mc-muted)' }}>还没有可引用的产物或变更。</div>
              )}
              {paneArtifacts.filter(a => a.kind !== 'image' && typeof a.content === 'string').map(a => {
                const already = attachments.some(x => x.id === 'art-' + a.id);
                return (
                  <button key={a.id} disabled={already} onClick={() => setAttachments(prev => [...prev, { id: 'art-' + a.id, name: a.title || a.id, content: a.content, mode: 'inline' as const }])}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', border: 'none', background: 'transparent', borderRadius: 9, fontSize: 12.5, color: already ? 'var(--mc-muted2)' : 'var(--mc-text)', cursor: already ? 'default' : 'pointer', textAlign: 'left', margin: '1px 0', opacity: already ? 0.5 : 1 }}>
                    <IconFile /><span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title || a.id}</span>
                    {already && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--mc-accent)' }}>已引用</span>}
                  </button>
                );
              })}
              {paneChanges.map(c => {
                const cid = 'chg-' + (c.changeId || c.path);
                const already = attachments.some(x => x.id === cid);
                return (
                  <button key={c.changeId || c.path} disabled={already} onClick={() => setAttachments(prev => [...prev, { id: cid, name: c.path, path: c.path, mode: 'path' as const }])}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', border: 'none', background: 'transparent', borderRadius: 9, fontSize: 12.5, color: already ? 'var(--mc-muted2)' : 'var(--mc-text)', cursor: already ? 'default' : 'pointer', textAlign: 'left', margin: '1px 0', opacity: already ? 0.5 : 1 }}>
                    <IconFile /><span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.path}</span>
                    {already && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--mc-accent)' }}>已引用</span>}
                  </button>
                );
              })}
            </div>
          )}
          <button className={`mc-pill ${searchOn ? 'on' : ''}`} onClick={toggleSearch} title="联网搜索">
            <IconSearch /><span>联网搜索</span>
          </button>
          <button className={`mc-pill ${showThink ? 'open' : ''}`} onClick={toggleThink} title="思考强度">
            <IconThink /><span>{LEVELS[thinkLevel].name}</span>
          </button>
          {/* 上下文用量：折叠按钮（与联网搜索同排）+ 点开的分色明细 */}
          <button className={`mc-pill ${showCtx ? 'on' : ''}`} onClick={toggleCtx} title="上下文用量（点击展开）">
            <IconContext />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ width: 40, height: 5, background: '#e6e6e6', borderRadius: 3, overflow: 'hidden', display: 'inline-block' }}>
                <span style={{ display: 'block', height: '100%', width: ctxPct + '%', background: ctxColor, transition: 'width .3s ease, background .3s ease' }} />
              </span>
              <span>{ctxPct}%</span>
            </span>
          </button>

          {/* 思考强度滑块（弹层，互斥于上下文明细） */}
          {showThink && (
            <div style={{ position: 'absolute', bottom: 38, left: 0, zIndex: 5, width: 240, background: 'var(--mc-glass-strong)', backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)', border: '1px solid var(--mc-hair)', borderRadius: 14, padding: '12px 14px', boxShadow: 'var(--mc-shadow-md)' }}>
              <div style={{ fontSize: 11, color: 'var(--mc-muted)', marginBottom: 8 }}>思考强度</div>
              <input type="range" min={0} max={4} step={1} value={thinkLevel} onChange={e => setLevel(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--mc-accent)' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                {LEVELS.map((l, i) => (
                  <span key={i} onClick={() => setLevel(i)} style={{ fontSize: 10, color: i === thinkLevel ? 'var(--mc-accent)' : 'var(--mc-muted2)', cursor: 'pointer', fontWeight: i === thinkLevel ? 600 : 400 }}>{l.name}</span>
                ))}
              </div>
            </div>
          )}

          {/* 上下文用量明细（分色堆叠 + 图例） */}
          {showCtx && (
            <div style={{ position: 'absolute', bottom: 38, left: 0, zIndex: 6, width: 300, background: 'var(--mc-glass-strong)', backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)', border: '1px solid var(--mc-hair)', borderRadius: 14, padding: '12px 14px', boxShadow: 'var(--mc-shadow-md)', fontSize: 12, color: 'var(--mc-muted)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                <span style={{ color: 'var(--mc-muted2)', display: 'flex' }}><IconContext /></span>
                <span style={{ flex: 1, color: 'var(--mc-text)', fontSize: 12.5, fontWeight: 500 }}>上下文用量</span>
                <span style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums', color: ctxPct > 90 ? 'var(--mc-danger)' : ctxPct > 70 ? 'var(--mc-pin)' : 'var(--mc-text)' }}>
                  {ctx.used.toLocaleString()} / {ctx.limit.toLocaleString()} tokens
                </span>
              </div>
              <div style={{ width: '100%', height: 10, background: '#ececec', borderRadius: 5, overflow: 'hidden', display: 'flex' }}>
                {ctx.cats.map(c => (
                  <div key={c.key} style={{ height: '100%', width: (ctx.used > 0 ? Math.round(c.value / ctx.limit * 100) : 0) + '%', background: c.color, transition: 'width .3s ease' }} />
                ))}
              </div>
              <div style={{ display: 'flex', gap: '10px 14px', flexWrap: 'wrap', marginTop: 10, fontSize: 11 }}>
                {ctx.cats.map(c => {
                  const ratio = ctx.used > 0 ? Math.round(c.value / ctx.used * 100) : 0;
                  return (
                    <span key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color, flexShrink: 0 }} />
                      {c.label} {c.value.toLocaleString()} · {ratio}%
                    </span>
                  );
                })}
              </div>
              {/* 接近上限警告：进度超过 85% 时提示开新会话，避免长对话质量下滑 */}
              {ctxPct > 85 && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 10, padding: '7px 9px', borderRadius: 8, background: ctxPct > 90 ? 'rgba(255,59,48,.08)' : 'rgba(255,149,0,.08)', border: '1px solid ' + (ctxPct > 90 ? 'rgba(255,59,48,.3)' : 'rgba(255,149,0,.3)'), fontSize: 11.5, color: ctxPct > 90 ? 'var(--mc-danger)' : 'var(--mc-pin)' }}>
                  <span style={{ flexShrink: 0, marginTop: 1 }}>{ctxPct > 90 ? '⚠️' : '⚡'}</span>
                  <span>
                    {ctxPct > 90 ? '上下文已接近上限（' + ctxPct + '%），继续对话可能被截断或影响质量，建议新建对话。' : '上下文用量较高（' + ctxPct + '%），可考虑新建对话以保持回答质量。'}
                    {ctxData?.model ? <span style={{ opacity: .7 }}>（模型 {ctxData.model}，上限 {ctx.limit.toLocaleString()} tokens）</span> : null}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* WorkBuddy 式大圆角输入框：textarea 融入圆角容器，右侧圆形发送 */}
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 8,
          background: 'var(--mc-glass-strong)', border: '1px solid var(--mc-hair)',
          borderRadius: 18, padding: '6px 6px 6px 16px',
          boxShadow: 'var(--mc-shadow-sm)', transition: 'border-color .15s, box-shadow .15s, background 0.25s',
        }}
          onFocusCapture={e => { e.currentTarget.style.borderColor = 'var(--mc-accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--mc-accent-soft)'; }}
          onBlurCapture={e => { e.currentTarget.style.borderColor = 'var(--mc-hair)'; e.currentTarget.style.boxShadow = 'var(--mc-shadow-sm)'; }}>
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="输入消息…（回车发送）" disabled={busy}
            style={{ flex: 1, resize: 'none', height: 42, maxHeight: 140, padding: '10px 0', border: 'none', background: 'transparent', outline: 'none', fontSize: 14, fontFamily: 'inherit', color: 'var(--mc-text)', boxShadow: 'none' }} />
          {busy ? (
            <button className="mc-send" onClick={handleStop} title="停止生成"
              style={{ width: 42, height: 42, padding: 0, borderRadius: '50%', background: 'var(--mc-danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <IconStop />
            </button>
          ) : (
            <button className="mc-send" onClick={handleSend} disabled={!input.trim()} title="发送"
              style={{ width: 42, height: 42, padding: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <IconSend />
            </button>
          )}
        </div>
        <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handlePickFiles} />
        </div>{/* 输入区居中窄列 */}
      </div>
    </div>
  );

  // ── 文件视图（产出文件：变更 + 产物统一列表 + 右侧预览/审查，点击即打开）──
  const active = paneArtifacts.find(a => a.id === activeArtifact) || null;
  const activeChange = paneChanges.find(c => c.changeId === activeChangeId) || null;
  const activeDiff = activeChange ? lcsLineDiff(activeChange.old || '', activeChange.new || '') : null;
  const diffAdds = activeDiff?.filter(d => d.t === 'add').length ?? 0;
  const diffDels = activeDiff?.filter(d => d.t === 'del').length ?? 0;
  // 变更 / 产物列表项的时间展示（毫秒时间戳 → HH:MM）
  const fmtClock = (t?: number) => { if (!t) return ''; const d = new Date(t); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}`; };
  // 路径是否为可预览的网页文件（HTML / Markdown），用于变更的「实时预览」入口
  const isHtmlLike = (p: string) => /\.(html?|htm|md|markdown)$/i.test(p || '');
  const fileView = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* 子视图切换：产出文件 / 工作区 */}
      <div style={{ display: 'flex', gap: 2, alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid var(--mc-hair)', background: 'var(--mc-glass)' }}>
        <button className={`mc-pill ${wsTab === 'output' ? 'on' : ''}`} onClick={() => setWsTab('output')}>产出文件</button>
        <button className={`mc-pill ${wsTab === 'workspace' ? 'on' : ''}`} onClick={() => setWsTab('workspace')}>工作区</button>
        {wsTab === 'output' && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--mc-muted2)', whiteSpace: 'nowrap' }}>
            {paneChanges.length} 变更 · {paneArtifacts.length} 产物
          </span>
        )}
      </div>
      {wsTab === 'workspace' ? (
        <WorkspaceExplorer changes={paneChanges} onRevert={revertFile} onToast={onToast} />
      ) : (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>
        {/* ── 左：产出文件列表（变更 + 产物）── */}
        <div className="mc-scroll" style={{ width: 280, flexShrink: 0, overflowY: 'auto', borderRight: '1px solid var(--mc-hair)', padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {paneChanges.length === 0 && paneArtifacts.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--mc-muted2)', fontSize: 12.5, lineHeight: 1.7 }}>
              还没有产出文件。<br />AI 写入 / 编辑工作区文件、<br />或生成 HTML / Markdown 后<br />会自动列在这里，点击即可预览。
            </div>
          )}
          {/* 文件变更组：可审查 diff + 一键撤销 */}
          {paneChanges.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--mc-muted)', padding: '4px 8px' }}>文件变更（{paneChanges.length}）· 可撤销</div>
              {paneChanges.map(c => {
                const d = lcsLineDiff(c.old || '', c.new || '');
                const adds = d.filter(x => x.t === 'add').length;
                const dels = d.filter(x => x.t === 'del').length;
                const sel = activeChangeId === c.changeId;
                return (
                  <div key={c.changeId} onClick={() => { setActiveChangeId(c.changeId); setActiveArtifact(null); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 9, cursor: 'pointer', border: '1px solid ' + (sel ? 'var(--mc-accent)' : 'transparent'), background: sel ? 'var(--mc-accent-soft)' : 'transparent' }}>
                    <span style={{ color: 'var(--mc-muted)', display: 'flex', flexShrink: 0 }}><IconFileCode /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--mc-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.path}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--mc-muted2)', display: 'flex', gap: 6 }}>
                        <span style={{ color: c.existed ? 'var(--mc-pin)' : '#34C759' }}>{c.existed ? '修改' : '新增'}</span>
                        <span style={{ color: 'var(--mc-danger)' }}>-{dels}</span>
                        <span style={{ color: '#34C759' }}>+{adds}</span>
                        <span style={{ marginLeft: 'auto' }}>{fmtClock(c.ts)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
          {/* AI 产物组：点击即预览 */}
          {paneArtifacts.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--mc-muted)', padding: '4px 8px', marginTop: paneChanges.length ? 8 : 0 }}>AI 产物（{paneArtifacts.length}）· 点击预览</div>
              {paneArtifacts.map(a => {
                const sel = activeArtifact === a.id;
                return (
                  <div key={a.id} onClick={() => { setActiveArtifact(a.id); setActiveChangeId(null); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 9, cursor: 'pointer', border: '1px solid ' + (sel ? 'var(--mc-accent)' : 'transparent'), background: sel ? 'var(--mc-accent-soft)' : 'transparent' }}>
                    <span style={{ color: 'var(--mc-muted)', display: 'flex', flexShrink: 0 }}>{fileIcon(a.kind)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--mc-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title || '(无标题)'}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--mc-muted2)' }}>{typeLabel(a.kind)} · {fmtClock(a.updatedAt)}</div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
        {/* ── 右：预览 / 审查面板 ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          {/* 面板头：标题 + 操作 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderBottom: '1px solid var(--mc-hair)', background: 'var(--mc-glass)', flexShrink: 0 }}>
            {activeChange ? (
              <>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeChange.path}</span>
                <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 6, background: 'var(--mc-seg)', color: activeChange.existed ? 'var(--mc-pin)' : '#34C759' }}>{activeChange.existed ? '修改' : '新增'}</span>
                {isHtmlLike(activeChange.path) && (
                  <button className="mc-pill" onClick={() => onOpenPreview?.(activeChange.new || '')} title="在「预览」页实时预览">实时预览</button>
                )}
                <button className="mc-pill" onClick={() => revertFile(activeChange.changeId)}>撤销</button>
              </>
            ) : active ? (
              <>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{active.title || '(无标题)'}</span>
                <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 6, background: 'var(--mc-seg)', color: 'var(--mc-muted)' }}>{typeLabel(active.kind)}</span>
                {active.kind === 'html' && (
                  <button className="mc-pill" onClick={() => onOpenPreview?.(active.content)} title="在「预览」页实时预览">实时预览</button>
                )}
                <button className="mc-pill" onClick={() => previewClient.openExternal(active.id)} title="在系统浏览器打开">外部打开</button>
              </>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--mc-muted2)' }}>点击左侧文件查看预览 / 审查</span>
            )}
          </div>
          {/* 面板体：diff 审查 / 实时预览 / 源码 */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--mc-glass-strong)' }}>
            {activeChange && activeDiff && (
              <div style={{ padding: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 11, color: 'var(--mc-muted2)' }}>
                  <span style={{ color: 'var(--mc-danger)' }}>-{diffDels}</span>
                  <span style={{ color: '#34C759' }}>+{diffAdds}</span>
                  <span style={{ marginLeft: 'auto' }}>差异审查 · 可一键撤销</span>
                </div>
                <div style={{ border: '1px solid var(--mc-hair)', borderRadius: 10, overflow: 'hidden', background: 'var(--mc-glass)' }}>
                  <div style={{ maxHeight: '100%', overflow: 'auto', padding: '4px 0', fontFamily: 'ui-monospace,Menlo,Consolas,monospace', fontSize: 11, lineHeight: 1.5 }}>
                    {activeDiff.map((ln, idx) => (
                      <div key={idx} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', padding: '0 8px', color: ln.t === 'del' ? 'var(--mc-danger)' : ln.t === 'add' ? '#1a7f37' : 'var(--mc-muted)', background: ln.t === 'del' ? 'rgba(255,69,58,.08)' : ln.t === 'add' ? 'rgba(52,199,89,.10)' : 'transparent' }}>{ln.t === 'del' ? '- ' : ln.t === 'add' ? '+ ' : '  '}{ln.s}</div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {!activeChange && active && active.kind === 'html' && (
              <iframe sandbox={previewSandbox(active.source)} title={active.title} srcDoc={active.content} style={{ width: '100%', height: '100%', border: 'none', background: 'var(--mc-bg)' }} />
            )}
            {!activeChange && active && active.kind === 'image' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <img src={active.content} alt={active.title} style={{ maxWidth: '100%', maxHeight: '100%' }} />
              </div>
            )}
            {!activeChange && active && active.kind === 'markdown' && (
              <div style={{ padding: 12 }}><MarkdownStream text={active.content} streaming={false} /></div>
            )}
            {!activeChange && active && active.kind === 'code' && (
              <div style={{ padding: 12 }}><CodeFoldingBlock html={'<pre class="mc-pre"><code>' + hlCode(active.content) + '</code></pre>'} streaming={false} /></div>
            )}
            {!activeChange && active && active.kind !== 'html' && active.kind !== 'image' && active.kind !== 'markdown' && active.kind !== 'code' && (
              <pre style={{ margin: 0, padding: 16, fontFamily: 'ui-monospace,Menlo,Consolas,monospace', fontSize: 12, lineHeight: 1.6, color: 'var(--mc-text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{active.content}</pre>
            )}
            {!activeChange && !active && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--mc-muted2)', fontSize: 13 }}>点击左侧文件查看预览 / 审查</div>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );

  const paneBase: CSSProperties = {
    display: 'flex', flexDirection: 'column', minWidth: 0,
    background: 'var(--mc-glass-strong)',
    backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    border: '1px solid var(--mc-hair)', borderRadius: 16, overflow: 'hidden',
    boxShadow: 'var(--mc-shadow-md)', transition: 'box-shadow .18s',
  };

  return (
    <div className={`mc-pane ${focused ? 'mc-focused' : ''}`} style={{ ...paneBase, ...(props.style || {}) }} onMouseDown={onFocus}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: '1px solid var(--mc-hair)', background: 'var(--mc-glass)', flexShrink: 0 }}>
        <span className="mc-conn" title={conn === 'open' ? '已连接' : conn === 'reconnecting' ? '连接中断，正在重连…' : '连接中…'} style={{ background: conn === 'open' ? '#34C759' : conn === 'reconnecting' ? 'var(--mc-pin)' : '#aeaeb2', flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sessionTitle}</span>
        <span style={{ display: 'flex', gap: 2, background: 'var(--mc-seg)', borderRadius: 9, padding: 2, flexShrink: 0 }}>
          <button className={`mc-viewbtn ${view === 'chat' ? 'on' : ''}`} onClick={() => setView('chat')} title="对话"><IconChat /></button>
          <button className={`mc-viewbtn ${view === 'files' ? 'on' : ''}`} onClick={() => setView('files')} title="文件"><IconFiles /></button>
        </span>
        <button className={`mc-viewbtn ${showTrace ? 'on' : ''}`} onClick={() => { setShowTrace(v => { const nv = !v; traceUserClosedRef.current = !nv; return nv; }); }} title="本次请求的调用瀑布（Trace，点击行可展开详情）"><IconTrace /></button>
      </div>
      <div style={{ flex: 1, display: view === 'chat' ? 'flex' : 'none', flexDirection: 'column', minHeight: 0 }}>
        {chatView}
      </div>
      <div style={{ flex: 1, display: view === 'files' ? 'flex' : 'none', flexDirection: 'column', minHeight: 0 }}>
        {fileView}
      </div>
    </div>
  );
}

// =========================================================================
// ChatPage —— 外壳：侧边栏 + 分栏视图
// =========================================================================
export default function ChatPage({ onOpenPreview }: { onOpenPreview?: (html: string) => void }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [hasProvider, setHasProvider] = useState<boolean | null>(null);
  const [initialSearchOn, setInitialSearchOn] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(null);
  const [focused, setFocused] = useState<'A' | 'B'>('A');
  const [paneInfo, setPaneInfo] = useState<{ A: { sessionId: string | null; view: 'chat' | 'files' }; B: { sessionId: string | null; view: 'chat' | 'files' } }>({
    A: { sessionId: null, view: 'chat' },
    B: { sessionId: null, view: 'files' },
  });
  const [openReq, setOpenReq] = useState<OpenReq | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; onUndo?: () => void } | null>(null);

  // 后台任务（生成中/已完成的会话）：底部任务栏数据源，切走不打断、随时可点回
  const [runningTasks, setRunningTasks] = useState<RunningTaskFront[]>([]);
  const runningTasksRef = useRef<RunningTaskFront[]>([]);
  runningTasksRef.current = runningTasks;

  // Splitter 状态
  const [splitPct, setSplitPct] = useState(50);
  const [collapsed, setCollapsed] = useState<null | 'A' | 'B'>(null);
  const [dragging, setDragging] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  // 侧边栏折叠（WorkBuddy 式图标条）：持久化到 localStorage
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('mc-sidebar-collapsed') === '1'; } catch { return false; }
  });
  const toggleSidebar = () => {
    setSidebarCollapsed(v => {
      try { localStorage.setItem('mc-sidebar-collapsed', v ? '0' : '1'); } catch { /* ignore */ }
      return !v;
    });
  };

  // 计时 toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.onUndo ? 4000 : 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // 初始加载：状态 / 会话列表 / 搜索开关
  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(d => {
      setHasProvider(d.hasProviders);
      if (d.hasProviders) {
        fetch('/api/sessions').then(r => r.json()).then((list: Session[]) => {
          setSessions(list);
          if (list.length > 0) {
            setPaneInfo(p => ({ ...p, A: { sessionId: list[0].id, view: 'chat' } }));
            setOpenReq({ pane: 'A', sessionId: list[0].id, nonce: Date.now() });
          }
        });
      }
    });
    fetch('/api/search-config').then(r => r.json()).then(cfg => { if (cfg && cfg.enabled) setInitialSearchOn(true); }).catch(() => {});
    loadModels();
    previewClient.start();

    // 运行任务订阅：先拉一次快照对齐（兼容页面刷新时已有后台任务），再收实时事件
    previewClient.subscribeRunning(onRunState);
    fetch('/api/running-tasks').then(r => r.json()).then((d: any) => {
      if (Array.isArray(d.tasks)) setRunningTasks(prev => mergeRunning(prev, d.tasks.map((t: any) => ({ ...t }))));
    }).catch(() => {});
  }, []);

  // 合并 run-state 事件到 runningTasks（按 sessionId upsert / done 标记 / removed 移除）
  function mergeRunning(prev: RunningTaskFront[], next: RunningTaskFront[]): RunningTaskFront[] {
    const map = new Map<string, RunningTaskFront>();
    for (const t of prev) map.set(t.sessionId, t);
    for (const t of next) map.set(t.sessionId, { ...t });
    return [...map.values()].sort((a, b) => a.startedAt - b.startedAt);
  }
  function onRunState(d: { sessionId: string; task?: RunningTaskFront; done?: boolean; error?: string; removed?: boolean }) {
    setRunningTasks(prev => {
      let next: RunningTaskFront[];
      if (d.removed || (d.done && !d.task)) {
        next = prev.filter(t => t.sessionId !== d.sessionId);
      } else if (d.task) {
        next = mergeRunning(prev, [{ ...d.task, done: d.done, error: d.error }]);
      } else {
        next = prev;
      }
      return next;
    });
  }

  async function loadModels() {
    try {
      const [opts, sel] = await Promise.all([
        fetch('/api/model-options').then(r => r.json()),
        fetch('/api/model').then(r => r.json()),
      ]);
      const optsArr = Array.isArray(opts) ? opts as ModelOption[] : [];
      setModelOptions(optsArr);
      if (sel && sel.providerId && sel.model) {
        setSelectedModel({ providerId: sel.providerId, model: sel.model });
      } else if (optsArr.length > 0) {
        setSelectedModel({ providerId: optsArr[0].providerId, model: optsArr[0].models[0] });
      }
    } catch { /* ignore */ }
  }

  function selectModel(m: SelectedModel) {
    setSelectedModel(m);
    fetch('/api/model', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) }).catch(() => {});
  }

  // Splitter 拖动（<84px 自动收起该侧）
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const el = contentRef.current; if (!el) return;
      const r = el.getBoundingClientRect();
      const aW = e.clientX - r.left;
      if (aW < 84) { setCollapsed('A'); setDragging(false); return; }
      if (r.width - aW < 84) { setCollapsed('B'); setDragging(false); return; }
      setSplitPct(Math.max(20, Math.min(80, (aW / r.width) * 100)));
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging]);

  function refreshSessions() {
    fetch('/api/sessions').then(r => r.json()).then(setSessions).catch(() => {});
  }

  // 在「当前聚焦 Pane」打开会话（自动切到对话视图）
  function openInPane(id: string) {
    const fid = focused;
    setFocused(fid);
    setPaneInfo(p => ({ ...p, [fid]: { sessionId: id, view: 'chat' } }));
    setOpenReq({ pane: fid, sessionId: id, nonce: Date.now() });
  }
  function newConversation() {
    const fid = focused;
    setFocused(fid);
    setPaneInfo(p => ({ ...p, [fid]: { sessionId: null, view: 'chat' } }));
    setOpenReq({ pane: fid, sessionId: null, nonce: Date.now() });
  }

  async function togglePin(id: string) {
    try {
      await fetch(`/api/sessions/${id}/pin`, { method: 'PUT' });
      refreshSessions();
    } catch { /* ignore */ }
  }
  async function renameSession(id: string, title: string) {
    const t = title.trim();
    if (!t) { setRenamingId(null); return; }
    try {
      await fetch(`/api/sessions/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t }) });
      refreshSessions();
    } catch { /* ignore */ }
    setRenamingId(null);
  }
  async function shareSession(id: string) {
    try {
      const r = await fetch(`/api/sessions/${id}/share`, { method: 'POST' });
      const d = await r.json();
      if (d.markdown) {
        try { await navigator.clipboard.writeText(d.markdown); } catch { /* 剪贴板不可用时忽略 */ }
        setToast({ msg: '已复制分享内容（含导出 Markdown）' });
      }
    } catch { setToast({ msg: '分享失败' }); }
  }
  async function deleteSession(id: string) {
    try {
      const r = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      if (!r.ok) return;
      refreshSessions();
      setToast({
        msg: '已隐藏对话',
        onUndo: () => { fetch(`/api/sessions/${id}/restore`, { method: 'POST' }).then(refreshSessions).catch(() => {}); },
      });
    } catch { /* ignore */ }
  }

  function openMenu(id: string, x: number, y: number) {
    setMenu({ id, x, y });
  }

  if (hasProvider === false) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 16, color: 'var(--mc-muted)' }}>请先在设置页添加 API 服务商</div>
        <div style={{ fontSize: 13, color: 'var(--mc-muted2)' }}>点击上方「设置」标签，填写 API Key</div>
      </div>
    );
  }
  if (hasProvider === null) {
    return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mc-muted2)', fontSize: 14 }}>加载中...</div>;
  }

  const sorted = [...sessions].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (a.updated_at < b.updated_at ? 1 : -1));
  const activeSessionIds = new Set(
    (['A', 'B'] as const)
      .filter(p => paneInfo[p].view === 'chat' && paneInfo[p].sessionId)
      .map(p => paneInfo[p].sessionId as string)
  );
  // 仍在后台生成中的会话 id（切回时恢复 busy 动画）
  const runningIds = runningTasks.filter(t => !t.done && t.phase !== 'error').map(t => t.sessionId);

  // Pane 宽度计算
  const paneAWidth = collapsed === 'B' ? '100%' : collapsed === 'A' ? '0' : `${splitPct}%`;
  const paneBWidth = collapsed === 'A' ? '100%' : collapsed === 'B' ? '0' : `${100 - splitPct}%`;
  const paneAFlex = collapsed ? 1 : 0;
  const paneBFlex = collapsed ? 1 : 0;

  return (
    <div style={{ height: '100%', display: 'flex', background: 'var(--mc-bg)', fontFamily: '-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif', fontSize: 14, color: 'var(--mc-text)', WebkitFontSmoothing: 'antialiased' }}>
      <style>{MC_CSS}</style>

      {/* 侧边栏：可折叠（WorkBuddy 式图标条） */}
      <aside style={{ width: sidebarCollapsed ? 60 : 216, flexShrink: 0, background: 'var(--mc-glass)', backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)', borderRight: '1px solid var(--mc-hair)', display: 'flex', flexDirection: 'column', transition: 'width .2s ease' }}>
        <div style={{ padding: '10px 10px 8px', borderBottom: '1px solid var(--mc-hair)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="mc-newbtn" onClick={newConversation} style={{ flex: 1, minWidth: 0, padding: sidebarCollapsed ? '9px 0' : '8px' }} title="新对话">
            <IconNew />{!sidebarCollapsed && '新对话'}
          </button>
          {!sidebarCollapsed && (
            <button onClick={toggleSidebar} title="收起侧边栏"
              style={{ width: 28, height: 28, flexShrink: 0, border: 'none', borderRadius: 8, background: 'var(--mc-seg)', color: 'var(--mc-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .15s, color .15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--mc-hair)'; e.currentTarget.style.color = 'var(--mc-text)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--mc-seg)'; e.currentTarget.style.color = 'var(--mc-muted)'; }}>
              «
            </button>
          )}
        </div>
        <div className="mc-scroll" style={{ flex: 1, overflowY: 'auto', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sorted.map(s => {
            const isActive = activeSessionIds.has(s.id);
            const isRunning = runningTasks.some(t => t.sessionId === s.id && !t.done && t.phase !== 'error');
            if (sidebarCollapsed) {
              return (
                <div key={s.id} title={(s.title || '新对话') + (s.pinned ? '（已置顶）' : '')}
                  onClick={() => openInPane(s.id)}
                  style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px 0', cursor: 'pointer', borderRadius: 9, background: isActive ? 'var(--mc-accent-soft)' : 'transparent', transition: 'background .15s' }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--mc-hair)'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}>
                  <span style={{
                    width: 32, height: 32, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 600, flexShrink: 0,
                    background: isActive ? 'var(--mc-accent)' : 'var(--mc-seg)',
                    color: isActive ? '#fff' : 'var(--mc-text)',
                    boxShadow: 'var(--mc-shadow-sm)',
                  }}>
                    {(s.title || '新对话').slice(0, 1)}
                  </span>
                  {s.pinned && <span style={{ position: 'absolute', top: 2, right: 4, color: 'var(--mc-pin)', fontSize: 9 }}>★</span>}
                  {isRunning && <span className="mc-spin" style={{ position: 'absolute', bottom: 3, right: 5, width: 8, height: 8, borderRadius: '50%', border: '2px solid var(--mc-accent)', borderTopColor: 'transparent' }} />}
                </div>
              );
            }
            return (
              <div key={s.id}
                className={`mc-row ${isActive ? 'active' : ''} ${s.pinned ? 'pinned' : ''} ${renamingId === s.id ? 'renaming' : ''}`}
                onClick={() => { if (renamingId !== s.id) openInPane(s.id); }}
                style={renamingId === s.id ? { background: 'transparent' } : undefined}>
                {renamingId === s.id ? (
                  <input autoFocus defaultValue={s.title}
                    onKeyDown={e => { if (e.key === 'Enter') renameSession(s.id, (e.target as HTMLInputElement).value); else if (e.key === 'Escape') setRenamingId(null); }}
                    onBlur={e => renameSession(s.id, e.target.value)}
                    style={{ width: '100%', fontSize: 13.5, fontFamily: 'inherit', border: '1px solid var(--mc-accent)', borderRadius: 5, padding: '2px 5px', outline: 'none', background: 'var(--mc-glass-strong)', color: 'var(--mc-text)' }} />
                ) : (
                  <>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {s.pinned && <span style={{ color: 'var(--mc-pin)', display: 'flex', flexShrink: 0 }}><IconPin /></span>}
                      <span>{s.title || '新对话'}</span>
                      {isRunning && (
                        <span className="mc-spin" style={{ width: 11, height: 11, borderRadius: '50%', border: '2px solid var(--mc-accent)', borderTopColor: 'transparent', flexShrink: 0 }} title="后台生成中" />
                      )}
                    </span>
                    <button className="mc-more" onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); openMenu(s.id, r.right - 168, r.bottom + 4); }} title="更多操作"><IconDots /></button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* 内容区：Vertical Split View */}
      <main ref={contentRef} style={{ flex: 1, display: 'flex', minWidth: 0, gap: 10, padding: 10, position: 'relative' }}>
        <ChatPane
          paneId="A" focused={focused === 'A'} view={paneInfo.A.view} openReq={openReq} initialSearchOn={initialSearchOn} sessions={sessions}
          modelOptions={modelOptions} selectedModel={selectedModel} onSelectModel={selectModel}
          onFocus={() => setFocused('A')} onViewChange={v => setPaneInfo(p => ({ ...p, A: { ...p.A, view: v } }))}
          onPaneSessionKnown={id => setPaneInfo(p => ({ ...p, A: { ...p.A, sessionId: id } }))}
          onSessionsMutated={refreshSessions} onOpenPreview={onOpenPreview} onToast={(msg) => setToast({ msg })}
          runningSessionIds={runningIds}
          style={{ width: paneAWidth, flex: paneAFlex, flexBasis: collapsed ? '100%' : paneAWidth, display: collapsed === 'A' ? 'none' : 'flex' }}
        />
        <div className="mc-splitter" style={{ width: 6, flex: '0 0 6px', display: collapsed ? 'none' : 'block' }}
          onMouseDown={() => { if (!collapsed) setDragging(true); }} />
        <ChatPane
          paneId="B" focused={focused === 'B'} view={paneInfo.B.view} openReq={openReq} initialSearchOn={initialSearchOn} sessions={sessions}
          modelOptions={modelOptions} selectedModel={selectedModel} onSelectModel={selectModel}
          onFocus={() => setFocused('B')} onViewChange={v => setPaneInfo(p => ({ ...p, B: { ...p.B, view: v } }))}
          onPaneSessionKnown={id => setPaneInfo(p => ({ ...p, B: { ...p.B, sessionId: id } }))}
          onSessionsMutated={refreshSessions} onOpenPreview={onOpenPreview} onToast={(msg) => setToast({ msg })}
          runningSessionIds={runningIds}
          style={{ width: paneBWidth, flex: paneBFlex, flexBasis: collapsed ? '100%' : paneBWidth, display: collapsed === 'B' ? 'none' : 'flex' }}
        />

        {/* 收起后的恢复条 */}
        {collapsed && (
          <div className="mc-restore" style={collapsed === 'A' ? { left: 0 } : { right: 0 }}
            onClick={() => setCollapsed(null)}>
            {collapsed === 'A' ? '恢复对话 A' : '恢复对话 B'}
          </div>
        )}
      </main>

      {/* ⋯ 浮动菜单 */}
      {menu && (
        <div className="mc-menu" style={{ top: menu.y, left: Math.max(8, menu.x) }}>
          <button onClick={() => { togglePin(menu.id); setMenu(null); }}>
            <span className="mi"><IconPin /></span><span>{sorted.find(s => s.id === menu.id)?.pinned ? '取消置顶' : '置顶'}</span>
          </button>
          <button onClick={() => { setRenamingId(menu.id); setMenu(null); }}>
            <span className="mi"><IconEdit /></span><span>重命名</span>
          </button>
          <button onClick={() => { shareSession(menu.id); setMenu(null); }}>
            <span className="mi"><IconShare /></span><span>分享任务</span>
          </button>
          <div className="sep" />
          <button className="danger" onClick={() => { deleteSession(menu.id); setMenu(null); }}>
            <span className="mi"><IconTrash /></span><span>删除</span>
          </button>
        </div>
      )}
      {menu && <div style={{ position: 'fixed', inset: 0, zIndex: 55 }} onClick={() => setMenu(null)} />}

      {/* 后台任务栏：任意会话生成时固定在底部，随阶段实时刷新；点击即切回对应会话 */}
      {runningTasks.length > 0 && (
        <div style={{ position: 'fixed', left: '50%', bottom: 16, transform: 'translateX(-50%)', zIndex: 70, display: 'flex', gap: 8, maxWidth: 'min(92vw, 760px)', flexWrap: 'nowrap', overflowX: 'auto' }}>
          {runningTasks.map(t => <TaskChip key={t.sessionId} task={t} onClick={() => openInPane(t.sessionId)} />)}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 80 }}>
          <div className="mc-toast">
            <span>{toast.msg}</span>
            {toast.onUndo && (
              <button className="undo" onClick={() => { toast.onUndo?.(); setToast(null); }}>撤销</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
