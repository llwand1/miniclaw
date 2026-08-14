import { useRef, useState, type ReactNode } from 'react';
import { IconCaret, IconCheck, IconContext, IconFile, IconFileDoc, IconFileHtml, IconGlobe, IconModel, IconSend, IconTool } from './chatIcons';
import { Mascot } from './Mascot';
import type { ModelOption, SelectedModel } from './chatTypes';

/**
 * WelcomeHero —— 空会话「新任务开始页」（对齐 WorkBuddy 浅色风 demo View 1）：
 * 品牌 Logo + 大标题 + 大输入框（附件 / 联网搜索 / 模型选择 / 圆形发送）+ 快捷任务预设卡片。
 * 显示时机：未选中对话（sid 为空）或点击「新对话」后的空会话状态。
 * 模型选择为自包含下拉（不依赖 composer 工具面板，空态下也可切换）；
 * 文件选择使用本地隐藏 input，复用 store 的 handlePickFiles。
 */
export function WelcomeHero({ input, setInput, onSend, busy, modelOptions, selectedModel, onSelectModel, handlePickFiles }: {
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  modelOptions: ModelOption[];
  selectedModel: SelectedModel | null;
  onSelectModel: (m: SelectedModel) => void;
  handlePickFiles: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [modelOpen, setModelOpen] = useState(false);

  const presets: { icon: ReactNode; title: string; desc: string; prompt: string }[] = [
    { icon: <IconFileDoc />, title: '写一份报告', desc: '周报 / 调研 / 总结', prompt: '帮我写一份报告（周报 / 调研 / 总结）' },
    { icon: <IconFileHtml />, title: '生成 PPT', desc: '10-12 页成品', prompt: '帮我生成一份 10-12 页的 PPT 大纲与内容' },
    { icon: <IconContext />, title: '分析数据', desc: 'Excel / CSV 可视化', prompt: '帮我分析一份数据（Excel / CSV），生成可视化报告' },
    { icon: <IconTool />, title: '跑通任务', desc: '多步骤长任务', prompt: '帮我跑一个多步骤的自动化长任务' },
  ];

  const canSend = !busy && input.trim().length > 0;
  const currentModel = selectedModel?.model || modelOptions[0]?.models?.[0] || '选择模型';
  // 联网搜索：studentbuddy 默认开启（对话页不再提供开关），此处只作状态展示
  const webSearchOn = true;

  const toolBtn: React.CSSProperties = {
    width: 32, height: 32, borderRadius: 8, border: 'none', background: 'transparent',
    color: 'var(--mc-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center',
    justifyContent: 'center', transition: 'background .15s, color .15s, transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s', flexShrink: 0,
  };

  return (
    <div className="mc-hero-in" style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '36px 20px 48px', position: 'relative' }}>
      {/* ─── 背景装饰层：浮动关键词（缓慢漂移 + hover 反馈）+ 灵动线条（dash 流动）─── */}
      <div className="mc-decor-layer">
        {/* 灵动线条：三条波浪虚线错相流动 */}
        <div className="mc-dline" style={{ top: '14%', left: '6%', width: 170, color: '#00B96B', animationDelay: '0s' }}>
          <svg viewBox="0 0 170 30" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M2 22 Q 45 2 88 22 T 170 14" />
            <path className="dash" d="M2 14 Q 45 28 88 8 T 170 20" opacity=".6" />
          </svg>
        </div>
        <div className="mc-dline" style={{ bottom: '18%', right: '5%', width: 200, color: '#1677FF', animationDelay: '-2s' }}>
          <svg viewBox="0 0 200 34" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M2 10 Q 52 30 102 10 T 200 22" />
            <path className="dash" d="M2 24 Q 52 4 102 24 T 200 8" opacity=".6" />
          </svg>
        </div>
        {/* 浮动关键词：24 个覆盖屏幕约 75%（四边+四角+中部两侧，避开中央内容区），
            混用 f1-f4 漂移变体 + 三色 + pill/outline/icon/lg 样式，相位错开；fade 词叠加淡入淡出呼吸，hover 变亮放大 */}
        {/* ── 顶部带 ── */}
        <span className="mc-dword g pill fade" style={{ top: '3%', left: '7%', animationDelay: '0s' }}>笔记</span>
        <span className="mc-dword b icon f2" data-ic="📡" style={{ top: '6%', right: '5%', animationDelay: '-1.1s' }}>AI 助手</span>
        <span className="mc-dword t lg outline f3" style={{ top: '11%', left: '2%', animationDelay: '-2.2s' }}>学习</span>
        <span className="mc-dword g icon f4 fade" data-ic="💬" style={{ top: '3%', right: '30%', animationDelay: '-3.3s' }}>问答</span>
        <span className="mc-dword b pill f2" style={{ top: '14%', left: '27%', animationDelay: '-4.4s' }}>刷题</span>
        <span className="mc-dword t icon f1 fade" data-ic="✅" style={{ top: '7%', left: '44%', animationDelay: '-5.5s' }}>打卡</span>
        {/* ── 中部两侧（内容区左右留白）── */}
        <span className="mc-dword g lg outline f4" style={{ top: '26%', left: '1%', animationDelay: '-0.6s' }}>答疑</span>
        <span className="mc-dword b pill f3 fade" style={{ top: '33%', right: '1%', animationDelay: '-1.7s' }}>单词本</span>
        <span className="mc-dword t icon f1" data-ic="⏱" style={{ top: '28%', left: '11%', animationDelay: '-2.8s' }}>专注</span>
        <span className="mc-dword g icon f2 fade" data-ic="📅" style={{ top: '42%', right: '7%', animationDelay: '-3.9s' }}>计划</span>
        <span className="mc-dword b lg outline f1" style={{ top: '48%', left: '4%', animationDelay: '-5s' }}>复习</span>
        <span className="mc-dword t pill f4 fade" style={{ top: '40%', right: '16%', animationDelay: '-6.1s' }}>精读</span>
        <span className="mc-dword g icon f3" data-ic="🎧" style={{ top: '22%', right: '12%', animationDelay: '-7.2s' }}>听力</span>
        <span className="mc-dword b icon f1 fade" data-ic="📒" style={{ top: '18%', left: '18%', animationDelay: '-0.3s' }}>错题本</span>
        {/* ── 底部带 ── */}
        <span className="mc-dword g pill f3 fade" style={{ bottom: '26%', left: '5%', animationDelay: '-1.4s' }}>作业</span>
        <span className="mc-dword t icon f4" data-ic="📝" style={{ bottom: '18%', left: '15%', animationDelay: '-2.5s' }}>总结</span>
        <span className="mc-dword g lg f2 fade" style={{ bottom: '6%', left: '28%', animationDelay: '-3.6s' }}>背单词</span>
        <span className="mc-dword b icon f1" data-ic="🎯" style={{ bottom: '8%', right: '20%', animationDelay: '-4.7s' }}>自测</span>
        <span className="mc-dword t pill f2 fade" style={{ bottom: '22%', right: '5%', animationDelay: '-5.8s' }}>默写</span>
        <span className="mc-dword g icon f3" data-ic="🗓" style={{ bottom: '3%', left: '48%', animationDelay: '-6.9s' }}>日程</span>
        <span className="mc-dword b outline f4 fade" style={{ bottom: '30%', right: '22%', animationDelay: '-0.8s' }}>查词</span>
        <span className="mc-dword g icon f1" data-ic="➗" style={{ top: '16%', right: '22%', animationDelay: '-1.9s' }}>速算</span>
        <span className="mc-dword b pill f3 fade" style={{ bottom: '2%', right: '38%', animationDelay: '-3s' }}>作文</span>
        <span className="mc-dword t lg f4" style={{ bottom: '12%', right: '1%', animationDelay: '-4.1s' }}>好词好句</span>
      </div>

      {/* 吉祥物主视觉：书精灵（可互动——hover 睁眼前倾，点击弹跳 + 开心表情 + 星星粒子爆发） */}
      <div style={{ marginBottom: 20 }}>
        <Mascot size={92} />
      </div>

      {/* 标题 + 副标题（主标题 hover 轻微放大反馈） */}
      <h1 className="mc-hero-title" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-.5px', marginBottom: 8, color: 'var(--mc-text)' }}>
        不止聊天，<span style={{ color: 'var(--mc-accent)' }}>搞定学习</span>
      </h1>
      <p style={{ fontSize: 14, color: 'var(--mc-muted)', marginBottom: 8 }}>
        让 AI 帮你写作业、做笔记、分析数据、跑长任务
      </p>
      <p style={{ fontSize: 12, color: 'var(--mc-muted2)', marginBottom: 28 }}>
        当前模型 {currentModel} · 本地优先 · 数据不出本机
      </p>

      {/* 大输入框：聚焦翠绿描边 + 底部工具行（玻璃质感：半透明渐变 + 顶部高光） */}
      <div style={{
        width: '100%', maxWidth: 660,
        background: 'var(--mc-glass-grad)',
        backdropFilter: 'blur(28px) saturate(180%)', WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border: '1px solid var(--mc-glass-border)', borderRadius: 20,
        padding: '8px 8px 6px 18px', boxShadow: 'var(--mc-glow-hi), var(--mc-shadow-md)',
        transition: 'border-color .15s, box-shadow .15s',
      }}
        onFocusCapture={e => { e.currentTarget.classList.add('mc-input-glow'); }}
        onBlurCapture={e => { e.currentTarget.classList.remove('mc-input-glow'); e.currentTarget.style.borderColor = 'var(--mc-glass-border)'; e.currentTarget.style.boxShadow = 'var(--mc-glow-hi), var(--mc-shadow-md)'; }}
        onMouseEnter={e => { if (!e.currentTarget.classList.contains('mc-input-glow')) { e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--mc-accent) 45%, var(--mc-glass-border))'; } }}
        onMouseLeave={e => { if (!e.currentTarget.classList.contains('mc-input-glow')) { e.currentTarget.style.borderColor = 'var(--mc-glass-border)'; } }}>
        <textarea ref={taRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canSend) onSend(); } }}
          placeholder="描述你想完成的任务，例如：帮我分析磁盘空间占用，生成可视化 HTML 报告"
          style={{ flex: 1, resize: 'none', width: '100%', minHeight: 70, padding: '12px 0', border: 'none', background: 'transparent', outline: 'none', fontSize: 15, fontFamily: 'inherit', lineHeight: 1.6, color: 'var(--mc-text)', boxShadow: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingTop: 4 }}>
          {/* 附件 */}
          <button className="mc-float" style={toolBtn} title="引用文件（≤60KB 文本内联，其余上传服务端）" onClick={() => fileRef.current?.click()}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--mc-hair)'; e.currentTarget.style.color = 'var(--mc-accent)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--mc-muted)'; }}>
            <IconFile />
          </button>
          {/* 联网搜索（默认开启，仅展示） */}
          <button className="mc-float" style={toolBtn} title="联网搜索（默认开启）"
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--mc-hair)'; e.currentTarget.style.color = 'var(--mc-accent)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--mc-muted)'; }}>
            <IconGlobe />
          </button>
          {/* 模型选择器：自包含下拉（空态可切换） */}
          <div style={{ position: 'relative' }}>
            <button className="mc-float" style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8,
              border: 'none', background: webSearchOn ? 'var(--mc-accent-soft)' : 'transparent',
              color: webSearchOn ? 'var(--mc-accent)' : 'var(--mc-muted)',
              fontSize: 12, cursor: 'pointer', transition: 'background .15s, color .15s, transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s',
            }}
              onClick={() => setModelOpen(o => !o)} title="切换模型">
              <IconModel />
              <span style={{ maxWidth: 140, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentModel}</span>
              <span style={{ display: 'inline-flex', transform: modelOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}><IconCaret /></span>
            </button>
            {modelOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 8 }} onClick={() => setModelOpen(false)} />
                <div style={{
                  position: 'absolute', bottom: 44, left: 0, zIndex: 9, minWidth: 240, maxWidth: 300, maxHeight: 280,
                  overflowY: 'auto', background: 'var(--mc-glass-strong)', backdropFilter: 'blur(20px) saturate(180%)',
                  WebkitBackdropFilter: 'blur(20px) saturate(180%)', border: '1px solid var(--mc-hair)', borderRadius: 14,
                  padding: 6, boxShadow: 'var(--mc-shadow-md)',
                }}>
                  {modelOptions.length === 0 && (
                    <div style={{ padding: '10px 12px', fontSize: 12.5, color: 'var(--mc-muted)' }}>没有可用的服务商，请到「设置」启用。</div>
                  )}
                  {modelOptions.map(opt => (
                    <div key={opt.providerId}>
                      <div style={{ fontSize: 11, color: 'var(--mc-muted2)', padding: '6px 10px 3px', fontWeight: 600 }}>{opt.providerName}</div>
                      {opt.models.map(m => {
                        const isActive = selectedModel?.providerId === opt.providerId && selectedModel?.model === m;
                        return (
                          <button key={m} onClick={() => { onSelectModel({ providerId: opt.providerId, model: m }); setModelOpen(false); }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--mc-hair)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                            style={{
                              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                              padding: '7px 10px', margin: '1px 0', border: 'none', background: 'transparent', borderRadius: 9,
                              fontSize: 12.5, color: 'var(--mc-text)', cursor: 'pointer', textAlign: 'left',
                            }}>
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m}</span>
                            {isActive && <span style={{ color: 'var(--mc-accent)', fontSize: 12, display: 'inline-flex' }}><IconCheck /></span>}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <span style={{ flex: 1 }} />
          {/* 圆形发送按钮：品牌渐变（绿→蓝，对齐 demo 双主色）+ 光晕 */}
          <button onClick={onSend} disabled={!canSend} title="发送"
            style={{
              width: 38, height: 38, borderRadius: '50%', border: 'none', flexShrink: 0,
              background: canSend ? 'linear-gradient(135deg, #00B96B, #1677FF)' : 'var(--mc-seg)',
              color: '#fff', cursor: canSend ? 'pointer' : 'not-allowed',
              boxShadow: canSend ? '0 2px 10px rgba(0,185,107,.3)' : 'none',
              opacity: canSend ? 1 : .45, display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'transform .15s, box-shadow .15s, opacity .15s',
            }}
            onMouseEnter={e => { if (canSend) { e.currentTarget.style.transform = 'scale(1.06)'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,185,107,.42)'; } }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 2px 10px rgba(0,185,107,.3)'; }}>
            <IconSend />
          </button>
        </div>
      </div>
      <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={handlePickFiles} />

      {/* 快捷任务预设：点击填入输入框 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, width: '100%', maxWidth: 660, marginTop: 24 }}>
        {presets.map((p, i) => (
          <button key={p.title} onClick={() => { setInput(p.prompt); taRef.current?.focus(); }}
            title="点击填入输入框"
            className="mc-card-in"
            style={{
              animationDelay: `${160 + i * 90}ms`,
              padding: '13px 11px', textAlign: 'left',
              background: 'var(--mc-glass-grad)',
              backdropFilter: 'blur(20px) saturate(160%)', WebkitBackdropFilter: 'blur(20px) saturate(160%)',
              border: '1px solid var(--mc-glass-border)', borderRadius: 14, cursor: 'pointer',
              display: 'flex', flexDirection: 'column', gap: 5,
              boxShadow: 'var(--mc-glow-hi)',
              transition: 'border-color .18s, transform .18s, box-shadow .18s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--mc-accent)'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--mc-glow-hi), var(--mc-shadow-md)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--mc-glass-border)'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--mc-glow-hi)'; }}>
            <span style={{ color: 'var(--mc-accent)', display: 'inline-flex' }}>{p.icon}</span>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--mc-text)' }}>{p.title}</span>
            <span style={{ fontSize: 11, color: 'var(--mc-muted2)' }}>{p.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
