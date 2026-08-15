// 对话页（ChatPage）组件级样式与常量。
// 只放内联 style 无法表达的部分：伪类 / 关键帧 / 滚动条，前缀 mc- 避免污染其它组件。
export const MC_CSS = `
:root{
  --mc-bg:#f5f5f7;
  --mc-glass:rgba(255,255,255,.5);
  --mc-glass-strong:rgba(255,255,255,.64);
  --mc-glass-grad:linear-gradient(160deg, rgba(255,255,255,.66), rgba(255,255,255,.34));
  --mc-glass-border:rgba(255,255,255,.62);
  --mc-hair:rgba(0,0,0,.08);
  --mc-hair-soft:rgba(0,0,0,.05);
  --mc-text:#1d1d1f; --mc-muted:#86868b; --mc-muted2:#aeaeb2;
  --mc-accent:#00B96B; --mc-accent-soft:rgba(0,185,107,.12);
  --mc-danger:#FF453A; --mc-pin:#FF9F0A;
  --mc-blue:#1677FF; --mc-blue-soft:rgba(22,119,255,.12);
  --mc-purple:#8B5CF6; --mc-purple-soft:rgba(139,92,246,.14);
  --mc-cyan:#06B6D4; --mc-cyan-soft:rgba(6,182,212,.12);
  --mc-seg:rgba(118,118,128,.12);
  --mc-shadow-sm:0 1px 2px rgba(0,0,0,.06),0 1px 1px rgba(0,0,0,.04);
  --mc-shadow-md:0 8px 24px rgba(0,0,0,.10),0 2px 6px rgba(0,0,0,.06);
  --mc-glow-hi:inset 0 1px 0 rgba(255,255,255,.75), inset 0 0 18px rgba(255,255,255,.06);
  --mc-msg-ai:#1d1d1f; --mc-bubble-ai:#e9e9eb;
}
[data-theme="dark"]{
  --mc-bg:#121214;                                   /* 1. 页面全局主背景 */
  --mc-glass:rgba(35,35,39,.62);                     /* 3. 卡片/弹窗/悬浮面板/输入框容器背景 */
  --mc-glass-strong:rgba(35,35,39,.76);
  --mc-glass-grad:linear-gradient(160deg, rgba(35,35,39,.62), rgba(30,30,34,.48));
  --mc-glass-border:rgba(255,255,255,.1);
  --mc-hair:rgba(255,255,255,.07);
  --mc-hair-soft:rgba(255,255,255,.04);
  --mc-text:#e8e8eb; --mc-muted:#9a9aa3; --mc-muted2:#71717a;
  --mc-accent:#34d399; --mc-accent-soft:rgba(52,211,153,.12);
  --mc-danger:#f87171; --mc-pin:#fbbf24;
  --mc-blue:#60a5fa; --mc-blue-soft:rgba(96,165,250,.14);
  --mc-purple:#a78bfa; --mc-purple-soft:rgba(167,139,250,.14);
  --mc-cyan:#22d3ee; --mc-cyan-soft:rgba(34,211,238,.12);
  --mc-seg:rgba(43,43,48,.55);                       /* 5. 按钮/普通组件底色 */
  --mc-shadow-sm:0 1px 2px rgba(0,0,0,.3);
  --mc-shadow-md:0 8px 24px rgba(0,0,0,.4);
  --mc-glow-hi:inset 0 1px 0 rgba(255,255,255,.12), inset 0 0 18px rgba(255,255,255,.03);
  --mc-msg-ai:#c4b5fd; --mc-bubble-ai:rgba(139,92,246,.12);
}
.mc-scroll::-webkit-scrollbar{width:8px;height:8px;}
.mc-scroll::-webkit-scrollbar-thumb{background:rgba(128,128,128,.3);border-radius:8px;}
.mc-scroll::-webkit-scrollbar-thumb:hover{background:rgba(128,128,128,.5);}
.mc-scroll::-webkit-scrollbar-track{background:transparent;}

/* 对话区输入框 placeholder 弱化（对齐品牌色系 muted） */
.mc-composer textarea::placeholder, .mc-tools textarea::placeholder { color: var(--mc-muted2); opacity: .85; }

.mc-row{position:relative;display:flex;align-items:center;gap:6px;padding:4px 6px;cursor:pointer;border-radius:7px;border-left:2px solid transparent;transition:background .15s,border-color .15s,opacity .22s,max-height .22s,padding .22s,transform .16s cubic-bezier(.2,.7,.3,1);}
.mc-row:hover{background:var(--mc-hair);transform:translateX(2px);}
.mc-row:active{background:var(--mc-accent-soft);transform:translateX(2px);}
.mc-row.active{background:var(--mc-accent-soft);}
/* 分支路径高亮：当前会话的父链行（非自身）——hair 底 + accent 标题，区别于 active 的 accent-soft 底 */
.mc-row.on-path{background:var(--mc-hair);}
.mc-row.on-path .mc-title{color:var(--mc-accent);}
/* 侧边栏分支计数徽章：根会话下的子对话数量 */
.mc-branch-count{font-size:10px;line-height:14px;padding:0 5px;border-radius:8px;background:var(--mc-seg);color:var(--mc-muted2);flex-shrink:0;font-variant-numeric:tabular-nums;}
.mc-row:hover .mc-branch-count{color:var(--mc-accent);}
.mc-row.pinned{border-left-color:var(--mc-pin);}
.mc-row.removing{max-height:0;opacity:0;padding-top:0;padding-bottom:0;overflow:hidden;}
.mc-row.flash{animation:mcFlash .55s ease;}
@keyframes mcFlash{0%{background:var(--mc-accent-soft);}100%{background:transparent;}}
/* 工具步骤完成：柔和辉光（克制的一次性高亮，替代原闪回，仅在状态转为 done 时触发） */
.mc-step-done{animation:mcStepDone .9s ease;}
@keyframes mcStepDone{0%{background:var(--mc-accent-soft);}100%{background:transparent;}}
.mc-more{width:20px;height:20px;border:none;background:transparent;border-radius:5px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--mc-muted);opacity:0;transition:opacity .15s,background .12s,color .12s;flex-shrink:0;}
.mc-row:hover .mc-more{opacity:1;}
.mc-more:hover{background:var(--mc-hair);color:var(--mc-text);}
.mc-more:active{background:var(--mc-accent-soft);color:var(--mc-accent);}

.mc-newbtn{width:100%;padding:8px;border:none;border-radius:10px;background:var(--mc-accent);color:#fff;font-size:13.5px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:var(--mc-shadow-sm);transition:background .15s,transform .08s,box-shadow .15s;}
.mc-newbtn:hover{background:#00a85f;box-shadow:var(--mc-shadow-md);}
.mc-newbtn:active{transform:scale(.98);background:#00925c;}

.mc-pill{display:flex;align-items:center;gap:5px;padding:5px 11px;border-radius:18px;border:none;font-size:12px;cursor:pointer;background:var(--mc-seg);color:var(--mc-muted);transition:background .15s,color .15s,transform .16s cubic-bezier(.2,.7,.3,1),box-shadow .16s;}
.mc-pill:hover{color:var(--mc-accent);transform:translateY(-1px);box-shadow:var(--mc-shadow-sm);}
.mc-pill:hover svg{color:var(--mc-accent);}
.mc-pill:hover .mc-caret{color:var(--mc-accent);}
.mc-pill.on{background:var(--mc-accent-soft);color:var(--mc-accent);}
.mc-pill.open{background:var(--mc-accent-soft);color:var(--mc-accent);}
.mc-pill.open svg{color:var(--mc-accent);}
.mc-pill .mc-caret{transition:transform .2s,color .16s;}
.mc-pill.open .mc-caret{transform:rotate(180deg);}
.mc-pill:active{transform:translateY(0) scale(.97);box-shadow:none;background:var(--mc-accent-soft);color:var(--mc-accent);}

.mc-send{height:42px;padding:0 18px;border:none;border-radius:11px;background:var(--mc-accent);color:#fff;font-size:13.5px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;box-shadow:var(--mc-shadow-sm);transition:background .15s,transform .08s,box-shadow .15s;}
.mc-send:hover{background:#00a85f;box-shadow:var(--mc-shadow-md);transform:translateY(-1px);}
.mc-send:active{transform:scale(.97);background:linear-gradient(135deg,#00925c,#105cd0);}
.mc-send:disabled{background:var(--mc-seg);color:var(--mc-muted2);cursor:not-allowed;box-shadow:none;transform:none;}

.mc-viewbtn{width:28px;height:25px;border:none;background:transparent;border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--mc-muted);transition:background .18s,color .18s;}
.mc-viewbtn.on{background:var(--mc-glass-strong);color:var(--mc-accent);box-shadow:var(--mc-shadow-sm);}
.mc-viewbtn:hover{color:var(--mc-text);}
.mc-viewbtn:active{background:var(--mc-accent-soft);color:var(--mc-accent);}

.mc-filecard{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--mc-hair);border-radius:12px;background:var(--mc-glass);cursor:pointer;transition:border-color .15s,background .15s,box-shadow .15s,transform .12s;}
.mc-filecard:hover{border-color:var(--mc-accent);background:var(--mc-accent-soft);box-shadow:var(--mc-shadow-sm);transform:translateY(-1px);}
.mc-filecard:active{border-color:var(--mc-accent);background:var(--mc-accent-soft);transform:translateY(0) scale(.99);}

.mc-splitter{background:var(--mc-seg);border-radius:3px;transition:background .12s;position:relative;}
.mc-splitter:hover{background:var(--mc-accent);}
.mc-splitter.dragging{background:var(--mc-accent);}

.mc-restore{position:absolute;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;justify-content:center;width:24px;padding:12px 4px;background:var(--mc-glass-strong);border:1px solid var(--mc-hair);border-radius:10px;cursor:pointer;color:var(--mc-muted);font-size:12px;writing-mode:vertical-rl;letter-spacing:1px;z-index:40;transition:background .12s,color .12s;}
.mc-restore:hover{background:var(--mc-accent-soft);color:var(--mc-accent);}

.mc-menu{position:fixed;z-index:60;min-width:158px;background:var(--mc-glass-strong);border:1px solid var(--mc-hair);border-radius:14px;padding:6px;box-shadow:var(--mc-shadow-md);}
.mc-menu button{width:100%;display:flex;align-items:center;gap:10px;padding:8px 10px;margin:1px 0;border:none;background:transparent;border-radius:9px;font-size:13px;color:var(--mc-text);cursor:pointer;text-align:left;transition:background .12s;}
.mc-menu button:hover{background:var(--mc-hair);}
.mc-menu button:active{background:var(--mc-accent-soft);color:var(--mc-accent);}
.mc-menu button.danger:active{background:rgba(255,69,58,.12);color:var(--mc-danger);}
.mc-menu button .mi{color:var(--mc-muted);display:flex;flex-shrink:0;}
.mc-menu button.danger{color:var(--mc-danger);}
.mc-menu button.danger .mi{color:var(--mc-danger);}
.mc-menu .sep{height:1px;background:var(--mc-hair);margin:4px 6px;}

.mc-toast{display:flex;align-items:center;gap:14px;background:var(--mc-glass-strong);border:1px solid var(--mc-hair);color:var(--mc-text);padding:10px 14px;border-radius:14px;font-size:13px;box-shadow:var(--mc-shadow-md);animation:mcToastIn .2s ease;}
.mc-toast .undo{border:none;background:transparent;color:var(--mc-accent);font-weight:600;cursor:pointer;font-size:13px;}
@keyframes mcToastIn{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
@keyframes mcDotPulse{0%,80%,100%{opacity:.3;transform:scale(.8);}40%{opacity:1;transform:scale(1.2);}}
.mc-spin{animation:mcSpin .8s linear infinite;}@keyframes mcSpin{to{transform:rotate(360deg);}}
/* 侧边栏「正在回复」的对话行：内发光柔和呼吸（不影响 active 高亮背景与 hover 态） */
.mc-row-running{animation:mcRowGlow 2.2s ease-in-out infinite;border-left-color:var(--mc-accent);}
@keyframes mcRowGlow{0%,100%{box-shadow:inset 0 0 0 rgba(0,185,107,0);}50%{box-shadow:inset 0 0 12px rgba(0,185,107,.22);}}
/* 侧边栏「回复中」三点脉冲（错峰呼吸，复用 mcDotPulse） */
.mc-dots{display:inline-flex;gap:2px;align-items:center;flex-shrink:0;}
.mc-dots i{width:4px;height:4px;border-radius:50%;background:var(--mc-accent);display:inline-block;animation:mcDotPulse 1.2s ease-in-out infinite;}
.mc-dots i:nth-child(2){animation-delay:.2s;}
.mc-dots i:nth-child(3){animation-delay:.4s;}
/* 多文案轮播：按键淡入切换（等待/思考期提示语）——文案始终可见，不再闪回 */
.mc-rot-in{animation:mcRotIn .5s ease both;}
@keyframes mcRotIn{from{opacity:0;transform:translateY(3px);}to{opacity:1;transform:none;}}
/* 状态徽章呼吸：图标轻微缩放脉动（文件读取指示器） */
.mc-breath{animation:mcBreath 1.6s ease-in-out infinite;}
@keyframes mcBreath{0%,100%{opacity:.55;transform:scale(.92);}50%{opacity:1;transform:scale(1.08);}}
/* 流式正文：逐段（按行）淡入 + 打字光标（对标 ChatGPT/LibreChat/WorkBuddy 生成动感） */
.mc-line{white-space:pre-wrap;word-break:break-word;animation:mcLineIn .26s ease;}
@keyframes mcLineIn{from{opacity:0;transform:translateY(3px);}to{opacity:1;transform:none;}}
.mc-caret{display:inline-block;width:2px;height:1.05em;background:var(--mc-accent);margin-left:1px;vertical-align:text-bottom;animation:mcBlink 1.05s step-end infinite;transform:translateY(1px);border-radius:1px;}
@keyframes mcBlink{50%{opacity:0;}}

.mc-pane{transition:box-shadow .18s,transform .18s;}
.mc-pane.mc-focused{box-shadow:0 0 0 2px var(--mc-accent),var(--mc-shadow-md);}

.mc-msg{position:relative;animation:mcMsgIn .34s cubic-bezier(.2,.7,.3,1) both;}
@keyframes mcMsgIn{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:none;}}
.mc-actions{opacity:0;transition:opacity .12s,transform .12s,border-color .12s;transform:translateY(2px);border:1px solid transparent;}
.mc-msg:hover .mc-actions{opacity:1 !important;transform:translateY(0);}
.mc-msg:hover .mc-actions:hover{border-color:var(--mc-accent);}
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

  /* 流式正文：正在输入的尾部段落（关闭淡入动画，避免每 token 重放闪烁） */
  .mc-tail-stream{animation:none;}

  /* ── 入场动画：新任务开始页（Hero）整块淡入上浮，预设卡片逐个 staggered 进入 ── */
  @keyframes mcHeroIn{
    from{opacity:0;transform:translateY(16px) scale(.985);}
    to{opacity:1;transform:none;}
  }
  .mc-hero-in{animation:mcHeroIn .5s cubic-bezier(.2,.7,.3,1) both;}
  @keyframes mcCardIn{
    from{opacity:0;transform:translateY(12px) scale(.96);}
    to{opacity:1;transform:none;}
  }
  .mc-card-in{animation:mcCardIn .42s cubic-bezier(.2,.7,.3,1) both;}
  @keyframes mcFadeUp{
    from{opacity:0;transform:translateY(8px);}
    to{opacity:1;transform:none;}
  }
  .mc-fade-up{animation:mcFadeUp .35s cubic-bezier(.2,.7,.3,1) both;}
  /* 右屏（预览面板）滑入 */
  @keyframes mcSlideInRight{
    from{opacity:0;transform:translateX(24px);}
    to{opacity:1;transform:none;}
  }
  .mc-slide-in-right{animation:mcSlideInRight .3s cubic-bezier(.2,.7,.3,1) both;}

  /* ── 浮动 hover 动效：鼠标落上时轻微上浮 + 阴影加深 + 主色强调（背景/文字泛品牌色） ── */
  .mc-float{transition:transform .16s cubic-bezier(.2,.7,.3,1),box-shadow .16s,background .16s,color .16s,border-color .16s,filter .16s;}
  .mc-float:hover{transform:translateY(-2px);box-shadow:var(--mc-shadow-md);filter:brightness(1.07);}
  .mc-float:hover .mc-float-icon{color:var(--mc-accent);}
  .mc-float-icon{transition:color .16s;}

  /* ── 工具面板菜单项 hover：背景高亮 + 右移浮动 + 图标泛品牌绿 ── */
  .mc-toolitem{transition:background .15s,color .15s,transform .16s cubic-bezier(.2,.7,.3,1),box-shadow .16s;}
  .mc-toolitem:hover:not(:disabled){background:var(--mc-hair);transform:translateX(2px);box-shadow:var(--mc-shadow-sm);}
.mc-toolitem:active:not(:disabled){background:var(--mc-accent-soft);transform:translateX(0) scale(.98);}

  /* ── 输入框聚焦高光（高级配套）：品牌绿描边 + 呼吸光晕动画。
     动画层优先于内联样式，聚焦时 classList 加 mc-input-glow 即可生效，失焦移除。 ── */
  .mc-input-glow{animation:mcGlowPulse 1.8s ease-in-out infinite;}
  @keyframes mcGlowPulse{
    0%,100%{border-color:var(--mc-accent);box-shadow:0 0 0 3px var(--mc-accent-soft),0 0 16px rgba(0,185,107,.16),var(--mc-glow-hi),var(--mc-shadow-md);}
    50%{border-color:var(--mc-accent);box-shadow:0 0 0 5px var(--mc-accent-soft),0 0 30px rgba(0,185,107,.30),var(--mc-glow-hi),var(--mc-shadow-md);}
  }

  /* ── 发送按钮品牌渐变（绿→蓝，对应 demo 双主色） ── */
  .mc-send{background:linear-gradient(135deg,#00B96B,#1677FF);box-shadow:0 2px 10px rgba(0,185,107,.28);}
  .mc-send:hover{background:linear-gradient(135deg,#00c475,#1a86ff);}

  /* ── 欢迎页书本 Logo：WorkBuddy 级组合动画 ──
     ① 3D 悬浮：方块在空间中俯仰/偏转摆动（preserve-3d）
     ② 多页翻书：SVG 内 3 张页（p1/p2/p3）依次错开翻动，形成连续翻页
     ③ 粒子光点：方块四周 3 个彩色亮点各自轨道漂浮
     ④ 渐变流动 + 阴影呼吸（延续）                                        */
  .mc-book-3d{perspective:280px;}
  .mc-book-stage{transform-style:preserve-3d;animation:mcBookFloat 4.6s ease-in-out infinite;}
  @keyframes mcBookFloat{
    0%,100%{transform:translateY(0) rotateX(7deg) rotateY(-10deg);}
    25%{transform:translateY(-4px) rotateX(11deg) rotateY(4deg);}
    50%{transform:translateY(-7px) rotateX(6deg) rotateY(12deg);}
    75%{transform:translateY(-3px) rotateX(9deg) rotateY(-2deg);}
  }
  .mc-book-grad{background:linear-gradient(135deg,#00B96B,#1677FF,#00A85F,#0BC5EA,#00B96B);background-size:340% 340%;animation:mcBookGrad 8s ease infinite;}
  @keyframes mcBookGrad{0%,100%{background-position:0% 50%;}50%{background-position:100% 50%;}}
  .mc-book-glow{animation:mcBookGlow 4.6s ease-in-out infinite;}
  @keyframes mcBookGlow{
    0%,100%{box-shadow:0 10px 28px rgba(0,185,107,.28),0 0 0 0 rgba(22,119,255,0);}
    50%{box-shadow:0 20px 44px rgba(22,119,255,.38),0 0 0 6px rgba(0,185,107,.08);}
  }
  /* 多页翻页：同一页形状分 3 层错开相位（延迟 -1.4s / -2.8s），一页接一页翻动 */
  .mc-book-page{transform-box:view-box;transform-origin:6.5px 11px;animation:mcBookPage 5.6s cubic-bezier(.6,.05,.4,.95) infinite;}
  .mc-book-page.p1{animation-delay:0s;}
  .mc-book-page.p2{animation-delay:-1.87s;opacity:.9;}
  .mc-book-page.p3{animation-delay:-3.73s;opacity:.8;}
  @keyframes mcBookPage{
    0%{transform:rotateY(0deg) translateX(0);}
    12%{transform:rotateY(-72deg) translateX(-2px);}
    24%{transform:rotateY(-72deg) translateX(-4px);opacity:.6;}
    36%{transform:rotateY(0deg) translateX(0);}
    100%{transform:rotateY(0deg) translateX(0);}
  }
  /* 粒子光点：3 颗不同颜色/位置/相位，各自轨道漂浮 + 缩放闪烁 */
  .mc-book-particle{position:absolute;border-radius:50%;pointer-events:none;animation:mcBookParticle 4.2s ease-in-out infinite;will-change:transform,opacity;}
  .mc-book-particle.a{width:7px;height:7px;top:-7px;left:14px;background:#7DF3C0;box-shadow:0 0 10px rgba(0,185,107,.9);}
  .mc-book-particle.b{width:5px;height:5px;top:9px;right:-6px;background:#9DC4FF;box-shadow:0 0 9px rgba(22,119,255,.9);animation-delay:-1.4s;}
  .mc-book-particle.c{width:6px;height:6px;bottom:-6px;left:22px;background:#FFE08A;box-shadow:0 0 9px rgba(255,200,80,.9);animation-delay:-2.8s;}
  @keyframes mcBookParticle{
    0%,100%{transform:translate(0,0) scale(1);opacity:.95;}
    25%{transform:translate(4px,-6px) scale(1.2);opacity:.65;}
    50%{transform:translate(-3px,-9px) scale(.9);opacity:1;}
    75%{transform:translate(2px,-3px) scale(1.1);opacity:.7;}
  }

  /* ── 主屏背景装饰层：浮动关键词 + 灵动线条 ──
     ① 浮动词：低透明度散落背景，缓慢漂移 + 微旋转（各自相位），hover 变亮/变色
     ② 灵动线条：SVG 波浪线 dashoffset 流动 + 轻微摆动
     ③ 主标题 hover：轻微放大 + 品牌绿强调（小反馈）                              */
  .mc-decor-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:0;}
  .mc-dword{position:absolute;user-select:none;font-weight:600;letter-spacing:.5px;pointer-events:auto;cursor:default;
    opacity:.14;font-size:16px !important;animation:mcDwordFloat 9s ease-in-out infinite;transition:opacity .3s,color .3s,transform .3s;}
  .mc-dword:hover{opacity:.65 !important;transform:scale(1.18);}
  .mc-dword.g{color:#00B96B;} .mc-dword.b{color:#1677FF;} .mc-dword.t{color:var(--mc-text);}
  /* 漂移动画变体：f2 横向漂、f3 斜向缩放、f4 大弧线，增加背景层次多样性 */
  .mc-dword.f2{animation-name:mcDwordFloat2;}
  .mc-dword.f3{animation-name:mcDwordFloat3;}
  .mc-dword.f4{animation-name:mcDwordFloat4;}
  /* 淡入淡出变体：漂移的同时叠加透明度呼吸（6s 周期，hover 提亮用 !important 覆盖动画） */
  .mc-dword.fade{animation:mcDwordFloat 9s ease-in-out infinite,mcDwordFade 6s ease-in-out infinite;}
  .mc-dword.fade.f2{animation:mcDwordFloat2 9s ease-in-out infinite,mcDwordFade 6s ease-in-out infinite;}
  .mc-dword.fade.f3{animation:mcDwordFloat3 9s ease-in-out infinite,mcDwordFade 6s ease-in-out infinite;}
  .mc-dword.fade.f4{animation:mcDwordFloat4 9s ease-in-out infinite,mcDwordFade 6s ease-in-out infinite;}
  @keyframes mcDwordFade{0%,100%{opacity:.06;}50%{opacity:.3;}}
  /* 样式变体：pill 胶囊背景 / outline 描边 / icon 图标前缀 / lg 大字 */
  .mc-dword.pill{background:rgba(0,185,107,.12);border:1px solid rgba(0,185,107,.25);padding:3px 10px;border-radius:20px;}
  .mc-dword.pill.b{background:rgba(22,119,255,.12);border-color:rgba(22,119,255,.25);}
  .mc-dword.pill.t{background:rgba(128,128,128,.12);border-color:rgba(128,128,128,.25);}
  .mc-dword.outline{-webkit-text-stroke:1px rgba(0,185,107,.35);color:transparent;}
  .mc-dword.outline.b{-webkit-text-stroke:1px rgba(22,119,255,.35);}
  .mc-dword.icon::before{content:attr(data-ic);margin-right:5px;font-size:1.1em;}
  .mc-dword.lg{font-size:34px !important;font-weight:800;letter-spacing:2px;}
  @keyframes mcDwordFloat{
    0%,100%{transform:translate(0,0) rotate(-3deg);}
    33%{transform:translate(10px,-16px) rotate(2deg);}
    66%{transform:translate(-8px,10px) rotate(3deg);}
  }
  @keyframes mcDwordFloat2{
    0%,100%{transform:translate(0,0) rotate(2deg);}
    50%{transform:translate(-16px,6px) rotate(-2deg);}
  }
  @keyframes mcDwordFloat3{
    0%,100%{transform:translate(0,0) scale(1) rotate(-1deg);}
    50%{transform:translate(12px,12px) scale(1.07) rotate(2deg);}
  }
  @keyframes mcDwordFloat4{
    0%,100%{transform:translate(0,0) rotate(1deg);}
    33%{transform:translate(-14px,-8px) rotate(-2deg);}
    66%{transform:translate(6px,-18px) rotate(3deg);}
  }
  .mc-dline{position:absolute;pointer-events:none;opacity:.22;}
  .mc-dline svg{display:block;overflow:visible;animation:mcLineSway 6s ease-in-out infinite;}
  @keyframes mcLineSway{
    0%,100%{transform:translateY(0) rotate(0deg);}
    50%{transform:translateY(-10px) rotate(1.5deg);}
  }
  .mc-dline .dash{stroke-dasharray:6 10;animation:mcLineFlow 1.6s linear infinite;}
  @keyframes mcLineFlow{from{stroke-dashoffset:16;}to{stroke-dashoffset:0;}}
  .mc-hero-title{transition:transform .25s cubic-bezier(.2,.7,.3,1),color .25s;}
  .mc-hero-title:hover{transform:scale(1.03);}

  /* ── 吉祥物 Mascot：书精灵角色动画 ──
     待机：呼吸浮动 + 嫩芽摆动 + 眨眼；hover：睁眼前倾；点击：弹跳 + 粒子
     扩展状态：sleep 打瞌睡(Zzz) / wonder 好奇(问号+歪头) / wave 招手 /
               think 思考(省略号) / laugh 大笑(晃动)
     气泡：随机文字框弹入弹出；地面阴影：随浮动/弹跳呼吸                         */
  .mc-mascot{cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent;position:relative;filter:drop-shadow(0 6px 14px rgba(0,0,0,.14));}
  .mc-mascot .mc-mascot-body,.mc-mascot .mc-mascot-face,.mc-mascot .mc-mascot-limbs{transition:transform .22s cubic-bezier(.2,.7,.3,1);}
  /* 质感：身体高光描边 */
  .mc-mascot-body path{stroke:#fff;stroke-width:1;stroke-opacity:.18;}
  /* 待机：整体浮动 */
  .mc-mascot-idle{animation:mcMascotIdle 3.2s ease-in-out infinite;}
  @keyframes mcMascotIdle{0%,100%{transform:translateY(0);}50%{transform:translateY(-5px);}}
  /* hover：放大 + 前倾 */
  .mc-mascot-hover{transform:scale(1.08) rotate(-2deg);transition:transform .22s cubic-bezier(.2,.7,.3,1);}
  .mc-mascot-hover .mc-mascot-eye{transform:scale(1.18);}
  .mc-mascot-hover .mc-mascot-sprout{animation:mcSproutWave 1.2s ease-in-out infinite;}
  /* 点击：弹跳 */
  .mc-mascot-click{animation:mcMascotBounce .6s cubic-bezier(.34,1.56,.64,1);}
  @keyframes mcMascotBounce{
    0%{transform:translateY(0) scale(1);}
    30%{transform:translateY(-26px) scale(1.12,.88);}
    55%{transform:translateY(0) scale(.94,1.06);}
    75%{transform:translateY(-10px) scale(1.05,.95);}
    100%{transform:translateY(0) scale(1);}
  }
  /* 打瞌睡：身体微垂 + 轻微点头 */
  .mc-mascot-sleep{animation:mcMascotSleep 2.6s ease-in-out infinite;}
  @keyframes mcMascotSleep{
    0%,100%{transform:rotate(-3deg) translateY(2px);}
    50%{transform:rotate(3deg) translateY(4px);}
  }
  /* 好奇：歪头摆动 */
  .mc-mascot-wonder{animation:mcMascotWonder 2.2s ease-in-out infinite;}
  @keyframes mcMascotWonder{0%,100%{transform:rotate(-10deg);}50%{transform:rotate(6deg);}}
  /* 招手：身体小晃 + 手臂摆（手臂由组件内 class 驱动） */
  .mc-mascot-wave{animation:mcMascotWave 1.4s ease-in-out infinite;}
  @keyframes mcMascotWave{0%,100%{transform:rotate(-4deg) translateY(0);}50%{transform:rotate(4deg) translateY(-3px);}}
  /* 思考：倾斜 + 上下微动 */
  .mc-mascot-think{animation:mcMascotThink 3s ease-in-out infinite;}
  @keyframes mcMascotThink{0%,100%{transform:rotate(2deg) translateY(0);}50%{transform:rotate(-2deg) translateY(-4px);}}
  /* 大笑：身体晃动 */
  .mc-mascot-laugh{animation:mcMascotLaugh 1.1s ease-in-out infinite;}
  @keyframes mcMascotLaugh{0%,100%{transform:rotate(-6deg) scale(1.02);}50%{transform:rotate(6deg) scale(1.05);}}
  /* 嫩芽摆动 */
  .mc-mascot-sprout{transform-box:fill-box;transform-origin:50% 100%;animation:mcSproutWave 3.4s ease-in-out infinite;}
  @keyframes mcSproutWave{0%,100%{transform:rotate(-4deg);}50%{transform:rotate(4deg);}}
  /* 眼睛眨眼：3.8s 周期，hover 睁大时暂停眨眼 */
  .mc-mascot-idle .mc-mascot-eye{transform-box:fill-box;transform-origin:50% 90%;animation:mcEyeBlink 3.8s ease-in-out infinite;}
  @keyframes mcEyeBlink{0%,92%,100%{transform:scaleY(1);}95%{transform:scaleY(.12);}97%{transform:scaleY(1);}}
  /* 打瞌睡闭眼（组件里眼睛渲染为闭线，这里留空占位保持选择器语义） */
  .mc-mascot-sleep .mc-mascot-eye{animation:none;}
  /* 招手右手摆动 */
  .mc-mascot-wave .mc-arm-r{transform-box:fill-box;transform-origin:50% 0%;animation:mcArmWave 1.4s ease-in-out infinite;}
  @keyframes mcArmWave{0%,100%{transform:rotate(0deg);}50%{transform:rotate(-28deg);}}
  /* 思考省略号浮动 */
  .mc-mascot-think .mc-think-dots{transform-box:fill-box;animation:mcThinkDots 1.6s ease-in-out infinite;}
  @keyframes mcThinkDots{0%,100%{opacity:.35;transform:translateY(0);}50%{opacity:1;transform:translateY(-3px);}}
  /* 点击粒子：8 颗按 --dx/--dy 爆发 */
  .mc-mascot-burst{position:absolute;inset:0;pointer-events:none;z-index:5;}
  .mc-burst-p{position:absolute;left:50%;top:50%;border-radius:50%;animation:mcBurstP .65s cubic-bezier(.2,.7,.3,1) both;transform:translate(-50%,-50%);}
  @keyframes mcBurstP{
    0%{transform:translate(-50%,-50%) scale(.4);opacity:1;}
    100%{transform:translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1);opacity:0;}
  }
  /* 随机文字气泡：从头顶弹出（scale + 上浮），带小尾巴 */
  .mc-bubble{position:absolute;top:-26px;left:50%;transform:translateX(-50%);z-index:6;pointer-events:none;
    background:rgba(255,255,255,.92);border:1px solid rgba(0,185,107,.3);border-radius:12px;
    padding:4px 10px;font-size:11.5px;font-weight:600;color:#1d1d1f;white-space:nowrap;
    box-shadow:0 4px 12px rgba(0,185,107,.18);animation:mcBubbleIn 2.4s cubic-bezier(.2,.7,.3,1) both;}
  .mc-bubble::after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);
    border:5px solid transparent;border-top-color:rgba(255,255,255,.95);}
  @keyframes mcBubbleIn{
    0%{opacity:0;transform:translateX(-50%) translateY(8px) scale(.6);}
    14%{opacity:1;transform:translateX(-50%) translateY(-3px) scale(1.06);}
    22%{opacity:1;transform:translateX(-50%) translateY(0) scale(1);}
    82%{opacity:1;transform:translateX(-50%) translateY(0) scale(1);}
    100%{opacity:0;transform:translateX(-50%) translateY(-6px) scale(.9);}
  }
  /* 地面阴影：随吉祥物浮动/弹跳呼吸（scaleX 表示远近） */
  .mc-mascot-shadow{position:absolute;left:50%;bottom:-14px;transform:translateX(-50%);width:56px;height:10px;border-radius:50%;
    background:radial-gradient(ellipse at center, rgba(0,0,0,.22), transparent 70%);pointer-events:none;
    animation:mcShadowBreath 3.2s ease-in-out infinite;}
  @keyframes mcShadowBreath{0%,100%{transform:translateX(-50%) scaleX(1);opacity:.75;}50%{transform:translateX(-50%) scaleX(.72);opacity:.45;}}

  .mc-dots i{width:3px;height:3px;border-radius:50%;background:var(--mc-accent);animation:mcDotP 1.2s infinite;}
  .mc-dots i:nth-child(2){animation-delay:.18s;}
  .mc-dots i:nth-child(3){animation-delay:.36s;}
  @keyframes mcDotP{0%,60%,100%{opacity:.25;transform:translateY(0);}30%{opacity:1;transform:translateY(-2px);}}
  @keyframes mcToolIn{from{opacity:0;transform:translateY(-4px) scale(.98);}to{opacity:1;transform:none;}}
`;

/** 本地兜底上下文上限（tokens）；真实值由服务端 /api/sessions/:id/context 提供 */
export const CTX_LIMIT_FALLBACK = 65536;

/** 长文本折叠阈值（字符数）：超过则默认收起，显示行数/字符数 + 展开 + 复制 */
export const TEXT_FOLD_CHARS = 600;

/** 代码块折叠阈值：超过该行数的代码块默认收起，避免大文件一次性铺满对话流 */
export const CODE_FOLD_LINES = 40;

/** 思考态文案池：等待期轮播提示语；每 3.6s 淡入淡出切下一句 */
export const THINK_PHRASES: Record<'low' | 'mid' | 'high', string[]> = {
  low: ['正在组织语言', '检索相关上下文', '整理思路'],
  mid: ['想法沉淀一下', '整理论据', '权衡不同方案', '回顾相关记忆'],
  high: ['深度推演中', '校验逻辑链路', '权衡取舍与边界', '凝练结论', '复盘推演'],
};
