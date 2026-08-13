// 对话页（ChatPage）组件级样式与常量。
// 只放内联 style 无法表达的部分：伪类 / 关键帧 / 滚动条，前缀 mc- 避免污染其它组件。
export const MC_CSS = `
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
/* 工具步骤完成：柔和辉光（克制的一次性高亮，替代原闪回，仅在状态转为 done 时触发） */
.mc-step-done{animation:mcStepDone .9s ease;}
@keyframes mcStepDone{0%{background:var(--mc-accent-soft);}100%{background:transparent;}}
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
/* 多文案轮播：按键淡入切换（等待/思考期提示语）——文案始终可见，不再闪回 */
.mc-rot-in{animation:mcRotIn .5s ease both;}
@keyframes mcRotIn{from{opacity:0;transform:translateY(3px);}to{opacity:1;transform:none;}}
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

/** 思考强度档位：极简→深度，驱动 temperature */
export const LEVELS = [
  { name: '极简', temp: 0.30 },
  { name: '简洁', temp: 0.50 },
  { name: '均衡', temp: 0.70 },
  { name: '深入', temp: 0.40 },
  { name: '深度', temp: 0.25 },
];

/** 本地兜底上下文上限（tokens）；真实值由服务端 /api/sessions/:id/context 提供 */
export const CTX_LIMIT_FALLBACK = 65536;

/** 长文本折叠阈值（字符数）：超过则默认收起，显示行数/字符数 + 展开 + 复制 */
export const TEXT_FOLD_CHARS = 600;

/** 代码块折叠阈值：超过该行数的代码块默认收起，避免大文件一次性铺满对话流 */
export const CODE_FOLD_LINES = 40;

/** 思考态文案池：随思考强度档位选不同语系；每 3.6s 淡入淡出切下一句 */
export const THINK_PHRASES: Record<'low' | 'mid' | 'high', string[]> = {
  low: ['正在组织语言', '检索相关上下文', '整理思路'],
  mid: ['想法沉淀一下', '整理论据', '权衡不同方案', '回顾相关记忆'],
  high: ['深度推演中', '校验逻辑链路', '权衡取舍与边界', '凝练结论', '复盘推演'],
};
