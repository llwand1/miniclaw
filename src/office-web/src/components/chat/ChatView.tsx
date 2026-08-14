import { CSSProperties, Fragment } from 'react';
import MessageActions from '../MessageActions';
import { IconAlert, IconCheck, IconContext, IconCross, IconFile, IconModel, IconPlus, IconQuiz, IconSend, IconSkills, IconStop, IconZap } from './chatIcons';
import { HistoryNavPanel } from './HistoryNavPanel';
import { ProcessPanel } from './ProcessPanel';
import { AssistantBody } from './Markdown';
import { ReasoningBlock, StatusTextRotation, WaitingIndicator } from './StatusIndicators';
import { Mascot } from './Mascot';
import { WelcomeHero } from './WelcomeHero';
import { fmtMsgTime } from './chatUtils';
import type { ChatPaneStore } from './useChatPane';

/** Chat 视图（消息流 + 底部输入区），从 ChatPane.tsx 拆出，纯渲染。 */
export function ChatView({ store }: { store: ChatPaneStore }) {
  const {
    msgs, msgMetaRef, navCollapsed, setNavCollapsed, historyScrollRef,
    creatingSession, stalled, retryLast, busy, todos, steps, reasoning, stage, justDone, stopped,
    isFirstOfSessionRef, elapsed, handleActionResult,
    bottomRef, selectedSkills, setSelectedSkills, attachments, setAttachments,
    showMore, openToolPanel, closeToolPanel, toggleMore,
    showModel, modelOptions, selectedModel, onSelectModel,
    showSkills, skillOptions, showAttach, fileInputRef,
    handlePickFiles, paneArtifacts, paneChanges,
    showCtx, ctxPct, ctxColor, ctx, ctxData,
    input, setInput, handleSend, handleStop, sendText, openSession, sid, sessionTree,
  } = store;

  // 大加号工具面板：菜单项 / 返回按钮 统一样式
  const toolItem: CSSProperties = {
    width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
    border: 'none', background: 'transparent', borderRadius: 9, fontSize: 12.5,
    color: 'var(--mc-text)', cursor: 'pointer', textAlign: 'left', margin: '1px 0',
  };
  const toolBack: CSSProperties = {
    border: 'none', background: 'transparent', color: 'var(--mc-accent)', fontSize: 12,
    fontWeight: 600, cursor: 'pointer', padding: '2px 6px', borderRadius: 6,
  };

  return (
    <div data-mc-chatview style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 空会话（未选中/新建）时隐藏左侧历史导航，让「新任务开始页」整块占满主区（对齐 demo View 1） */}
        {msgs.length > 0 && (
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
          autoHighlightId={msgs.length > 0 ? (msgMetaRef.current[msgs.length - 1]?.id || null) : null}
          sessionTree={sessionTree}
          currentSessionId={sid}
          onOpenSession={openSession}
        />
        )}
        <div className="mc-scroll" style={{ flex: 1, overflowY: 'auto', background: 'transparent' }} ref={historyScrollRef}>
        {/* 消息居中窄列（WorkBuddy / ChatGPT 式正文排版） */}
        <div style={{ maxWidth: 780, margin: '0 auto', padding: '24px 28px 40px' }}>
        {msgs.length === 0 && (
          creatingSession ? (
            <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mc-muted2)', fontSize: 14, gap: 8 }}>
              <span className="mc-spin" style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid var(--mc-accent)', borderTopColor: 'transparent' }} />
              <span>会话创建中…</span>
            </div>
          ) : (
            <WelcomeHero
              input={input} setInput={setInput} onSend={handleSend} busy={busy}
              modelOptions={modelOptions} selectedModel={selectedModel} onSelectModel={onSelectModel}
              handlePickFiles={handlePickFiles}
            />
          )
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
          const showThinking = isAssistant && busy && isLast && !m.content && !m.error && steps.length === 0 && reasoning.length === 0 && !m.quiz;
          return (
            <Fragment key={i}>
              {isAssistant && (
                <>
                  {/* 历史消息的思考块保持独立渲染；最后一条消息统一走 ProcessPanel */}
                  {!isLast && m.reasoning && m.reasoning.length > 0 && <ReasoningBlock text={m.reasoning} />}
                  {isLast && (
                    <ProcessPanel
                      busy={busy} justDone={justDone} stopped={stopped} stage={stage}
                      reasoning={reasoning || m.reasoning || ''} steps={steps} todos={todos} elapsed={elapsed}
                    />
                  )}
                  {isLast && busy && isFirstOfSessionRef.current && !m.content && !m.error && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--mc-muted)', margin: '2px 0 8px' }}>
                      <span className="mc-spin" style={{ width: 13, height: 13, borderRadius: '50%', border: '2px solid var(--mc-accent)', borderTopColor: 'transparent' }} />
                      <span>会话创建中…</span>
                    </div>
                  )}
                </>
              )}
              <div className="mc-msg" data-msg-id={msgMetaRef.current[i]?.id} style={{ position: 'relative', display: 'flex', marginBottom: 26, gap: 12, justifyContent: isAssistant ? 'flex-start' : 'flex-end', alignItems: 'flex-start' }}>
              {/* AI 头像：最后一条消息用书精灵吉祥物（自带动画，仅最后一条），历史消息保留渐变圆形标识 */}
              {isAssistant && (
                isLast ? (
                  <div style={{ flexShrink: 0, marginTop: 0, width: 30, height: 30, position: 'relative' }}>
                    <Mascot size={30} interactive={false} />
                  </div>
                ) : (
                <div style={{
                  width: 30, height: 30, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                  background: 'linear-gradient(135deg, #00B96B 0%, #00A85F 60%, #1677FF 100%)',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 0 0 3px var(--mc-accent-soft), var(--mc-shadow-sm)',
                }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a7 7 0 0 0-7 7c0 2.5 1.3 4.7 3.2 6 .5.3.8.9.8 1.5V18a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-1.5c0-.6.3-1.2.8-1.5A7 7 0 0 0 19 9a7 7 0 0 0-7-7z" />
                  </svg>
                </div>
                )
              )}
              <div style={{ maxWidth: isAssistant ? 'calc(100% - 46px)' : '78%', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <div style={{
                // AI 通栏内容流（无气泡）：正文整行铺开，对标 Trae/WorkBuddy；
                // 用户消息保留右侧圆角气泡（品牌渐变 + 微阴影，大厂统一做法）。
                padding: isAssistant ? '2px 0' : '10px 16px',
                borderRadius: isAssistant ? 0 : '18px 18px 6px 18px',
                lineHeight: isAssistant ? 1.75 : 1.65, fontSize: 14,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                background: m.error ? (isAssistant ? 'transparent' : 'rgba(255,69,58,.10)') : isAssistant ? 'transparent' : 'linear-gradient(135deg, #00B96B, #00A85F)',
                color: m.error ? 'var(--mc-danger)' : isAssistant ? 'var(--mc-msg-ai)' : '#fff',
                border: m.error ? (isAssistant ? '1px solid transparent' : '1px solid var(--mc-danger)') : isAssistant ? 'none' : 'none',
                boxShadow: !isAssistant && !m.error ? '0 2px 8px rgba(0,185,107,.18)' : 'none',
              }}>
                {showThinking ? (
                  <StatusTextRotation level={1} elapsed={elapsed} />
                ) : isAssistant ? (
                  (m.quiz && !m.content && !m.error) ? (
                    // 出题特殊模式：不流式渲染，等待模型输出完毕后一次性渲染题目卡片
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--mc-muted)', margin: '2px 0 8px' }}>
                      <span className="mc-spin" style={{ width: 13, height: 13, borderRadius: '50%', border: '2px solid var(--mc-accent)', borderTopColor: 'transparent' }} />
                      <span>正在生成题目…</span>
                    </div>
                  ) : (busy && isLast && !m.content && !m.error) ? (
                    // 生成中但正文尚未到达（如工具调用/文件读取等待期）：呼吸徽章 + 轮播文案
                    <WaitingIndicator hasTool={steps.length > 0} />
                  ) : <AssistantBody text={m.content} streaming={isLast && busy && !m.error && !m.quiz} sessionId={sid} onSessionCreated={openSession} />
                ) : (
                  m.content
                )}
              </div>
              {isAssistant && (m.content || m.error) && (
                <div style={{ fontSize: 11, color: 'var(--mc-muted2)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingLeft: 2 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--mc-accent)', display: 'inline-block' }} />{fmtMsgTime(m.ts)}</span>
                  {m.model && <span>· {m.model}</span>}
                  {typeof m.tokens === 'number' && m.tokens > 0 && <span>· {m.tokens.toLocaleString()} tokens</span>}
                </div>
              )}
              </div>
              {isAssistant && (m.content || m.error) && (
                <div className="mc-actions" style={{ position: 'absolute', top: -12, left: 40, display: 'flex', alignItems: 'center', gap: 2, background: 'var(--mc-glass-strong)', border: '1px solid var(--mc-hair)', borderRadius: 10, padding: 2, boxShadow: 'var(--mc-shadow-sm)', zIndex: 5 }}>
                  <MessageActions text={m.content} title="studentbuddy 回复" iconColor="var(--mc-muted)" hoverBg="var(--mc-seg)" onResult={handleActionResult} />
                  {m.error && (
                    <button title="重试" onClick={retryLast}
                      style={{ border: 'none', background: 'transparent', color: 'var(--mc-accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '0 8px 0 4px' }}>
                      重试
                    </button>
                  )}
                </div>
              )}
            </div>
            </Fragment>
          );
        })}
        <div ref={bottomRef} />
        </div>{/* 消息居中窄列 */}
        </div>
      </div>

      {/* 底部输入区：与消息列同宽居中（WorkBuddy 式）。空会话时由 WelcomeHero 的大输入框承担，此处隐藏避免双输入框 */}
      {msgs.length > 0 && (
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
          {/* 大加号：全部工具入口（模型 / 技能 / 引用文件 / 一键出题 / 上下文用量），点击向上展开 */}
          <button className={`mc-pill ${showMore ? 'open' : ''}`} onClick={toggleMore} title="工具（模型 / 技能 / 引用文件 / 一键出题 / 上下文用量）">
            <IconPlus />
            <span>工具{selectedSkills.length + attachments.length > 0 ? ` · ${selectedSkills.length + attachments.length}` : ''}</span>
          </button>
          {showMore && (
            <div style={{ position: 'absolute', bottom: 40, left: 0, zIndex: 7, minWidth: 300, maxWidth: 360, maxHeight: 320, overflowY: 'auto', background: 'var(--mc-glass-strong)', backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)', border: '1px solid var(--mc-hair)', borderRadius: 14, padding: 6, boxShadow: 'var(--mc-shadow-md)' }}>
              {/* 菜单视图：未选中子面板时展示入口列表 */}
              {!showModel && !showSkills && !showAttach && !showCtx && (
                <div>
                  <div style={{ fontSize: 11, color: 'var(--mc-muted2)', padding: '4px 10px 6px', fontWeight: 600 }}>工具</div>
                  <button onClick={() => openToolPanel('model')} className="mc-toolitem" style={toolItem}>
                    <span style={{ display: 'inline-flex', color: 'var(--mc-blue)' }}><IconModel /></span><span>模型</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--mc-muted2)', maxWidth: 130, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {selectedModel?.model || modelOptions[0]?.models?.[0] || '选择模型'}
                    </span>
                  </button>
                  <button onClick={() => openToolPanel('skills')} className="mc-toolitem" style={toolItem}>
                    <span style={{ display: 'inline-flex', color: 'var(--mc-purple)' }}><IconSkills /></span><span>技能</span>
                    {selectedSkills.length > 0 && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--mc-purple)' }}>{selectedSkills.length} 项</span>}
                  </button>
                  <button onClick={() => openToolPanel('attach')} className="mc-toolitem" style={toolItem}>
                    <span style={{ display: 'inline-flex', color: 'var(--mc-cyan)' }}><IconFile /></span><span>引用文件</span>
                    {attachments.length > 0 && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--mc-cyan)' }}>{attachments.length} 项</span>}
                  </button>
                  <button onClick={() => openToolPanel('ctx')} className="mc-toolitem" style={toolItem}>
                    <span style={{ display: 'inline-flex', color: 'var(--mc-accent)' }}><IconContext /></span><span>上下文用量</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--mc-muted2)' }}>{ctxPct}%</span>
                  </button>
                  {/* 一键出题：发送预置指令，让 AI 按 [QUIZ] 结构出混合题型练习题（选择题/填空题/解答题），前端渲染成可交互卡片 */}
                  <button
                    onClick={() => {
                      if (busy) return;
                      // 强制注入 quiz-generator 技能：让模型稳定按 [QUIZ] 协议出题，不依赖它自觉触发
                      sendText('请针对当前对话的主题，出 4 道练习题（含 2 道选择题、1 道填空题、1 道解答题，均含答案与解析），严格使用 [QUIZ] JSON 格式输出，不要输出多余文字。', undefined, false, ['quiz-generator']);
                      closeToolPanel();
                    }}
                    disabled={busy}
                    title="一键出题：让 AI 基于当前对话主题生成一套混合题型练习题（选择题/填空题/解答题）"
                    className="mc-toolitem"
                    style={{ ...toolItem, opacity: busy ? 0.5 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}>
                    <span style={{ display: 'inline-flex', color: 'var(--mc-pin)' }}><IconQuiz /></span><span>一键出题</span>
                  </button>
                </div>
              )}
              {/* 子面板标题栏（返回 + 标题） */}
              {(showModel || showSkills || showAttach || showCtx) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px 6px' }}>
                  <button onClick={closeToolPanel} style={{ ...toolBack, transition: 'color .15s, background .15s, transform .16s cubic-bezier(.2,.7,.3,1)', borderRadius: 6 }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--mc-hair)'; e.currentTarget.style.transform = 'translateX(-2px)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.transform = 'none'; }}>← 返回</button>
                  <span style={{ fontSize: 11, color: 'var(--mc-muted2)', fontWeight: 600 }}>
                    {showModel ? '切换模型' : showSkills ? '选择技能' : showAttach ? '引用文件' : '上下文用量'}
                  </span>
                </div>
              )}
              {/* 模型子面板 */}
              {showModel && (
                <div>
                  {modelOptions.length === 0 && (
                    <div style={{ padding: '10px 12px', fontSize: 12.5, color: 'var(--mc-muted)' }}>没有可用的服务商，请到「设置」启用。</div>
                  )}
                  {modelOptions.map(opt => (
                    <div key={opt.providerId}>
                      <div style={{ fontSize: 11, color: 'var(--mc-muted2)', padding: '6px 10px 3px', fontWeight: 600 }}>{opt.providerName}</div>
                      {opt.models.map(m => {
                        const isActive = selectedModel?.providerId === opt.providerId && selectedModel?.model === m;
                        return (
                          <button key={m} onClick={() => { onSelectModel({ providerId: opt.providerId, model: m }); closeToolPanel(); }}
                            className="mc-toolitem"
                            onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = 'var(--mc-hair)'; } }}
                            onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; } }}
                            style={{ ...toolItem, justifyContent: 'space-between' }}>
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m}</span>
                            {isActive && <span style={{ color: 'var(--mc-accent)', fontSize: 12, display: 'inline-flex' }}><IconCheck /></span>}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
              {/* 技能子面板 */}
              {showSkills && (
                <div>
                  <div style={{ fontSize: 11, color: 'var(--mc-muted2)', padding: '4px 10px 6px', fontWeight: 600 }}>勾选后本次对话强制启用</div>
                  {skillOptions.length === 0 && (
                    <div style={{ padding: '10px 12px', fontSize: 12.5, color: 'var(--mc-muted)' }}>还没有技能，请到「设置 → 技能」导入。</div>
                  )}
                  {skillOptions.map(opt => {
                    const checked = selectedSkills.includes(opt.name);
                    return (
                      <button key={opt.name} onClick={() => setSelectedSkills(prev => checked ? prev.filter(n => n !== opt.name) : [...prev, opt.name])}
                        className="mc-toolitem"
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--mc-hair)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                        style={{ ...toolItem, alignItems: 'flex-start' }}>
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
              {/* 引用子面板 */}
              {showAttach && (
                <div>
                  <div style={{ fontSize: 11, color: 'var(--mc-muted2)', padding: '4px 10px 6px', fontWeight: 600 }}>本地文件</div>
                  <button onClick={() => fileInputRef.current?.click()} className="mc-toolitem" style={toolItem}>
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
                        className="mc-toolitem"
                        style={{ ...toolItem, opacity: already ? 0.5 : 1, cursor: already ? 'default' : 'pointer' }}>
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
                        className="mc-toolitem"
                        style={{ ...toolItem, opacity: already ? 0.5 : 1, cursor: already ? 'default' : 'pointer' }}>
                        <IconFile /><span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.path}</span>
                        {already && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--mc-accent)' }}>已引用</span>}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* 上下文用量子面板（分色堆叠 + 图例） */}
              {showCtx && (
                <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--mc-muted)' }}>
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
                      <span style={{ flexShrink: 0, marginTop: 1, display: 'inline-flex' }}>{ctxPct > 90 ? <IconAlert /> : <IconZap />}</span>
                      <span>
                        {ctxPct > 90 ? '上下文已接近上限（' + ctxPct + '%），继续对话可能被截断或影响质量，建议新建对话。' : '上下文用量较高（' + ctxPct + '%），可考虑新建对话以保持回答质量。'}
                        {ctxData?.model ? <span style={{ opacity: .7 }}>（模型 {ctxData.model}，上限 {ctx.limit.toLocaleString()} tokens）</span> : null}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 大厂式输入框：大圆角容器 + textarea 融入 + 右侧圆形发送（Trae / WorkBuddy 同款，玻璃质感） */}
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 10,
          background: 'var(--mc-glass-grad)',
          backdropFilter: 'blur(28px) saturate(180%)', WebkitBackdropFilter: 'blur(28px) saturate(180%)',
          border: '1px solid var(--mc-glass-border)', borderRadius: 20, padding: '8px 8px 8px 18px',
          boxShadow: 'var(--mc-glow-hi), var(--mc-shadow-sm)', transition: 'border-color .15s, box-shadow .15s, background 0.25s',
        }}
          onFocusCapture={e => { e.currentTarget.classList.add('mc-input-glow'); }}
          onBlurCapture={e => { e.currentTarget.classList.remove('mc-input-glow'); e.currentTarget.style.borderColor = 'var(--mc-glass-border)'; e.currentTarget.style.boxShadow = 'var(--mc-glow-hi), var(--mc-shadow-sm)'; }}
          onMouseEnter={e => { if (!e.currentTarget.classList.contains('mc-input-glow')) { e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--mc-accent) 45%, var(--mc-glass-border))'; } }}
          onMouseLeave={e => { if (!e.currentTarget.classList.contains('mc-input-glow')) { e.currentTarget.style.borderColor = 'var(--mc-glass-border)'; } }}>
        <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="输入消息…（回车发送）" disabled={busy}
            style={{ flex: 1, resize: 'none', height: 52, maxHeight: 160, padding: '14px 0', border: 'none', background: 'transparent', outline: 'none', fontSize: 14.5, fontFamily: 'inherit', color: 'var(--mc-text)', boxShadow: 'none' }} />
          {busy ? (
            <button className="mc-send" onClick={handleStop} title="停止生成"
              style={{ width: 44, height: 44, padding: 0, borderRadius: '50%', background: 'var(--mc-danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <IconStop />
            </button>
          ) : (
            <button className="mc-send" onClick={handleSend} disabled={!input.trim()} title="发送"
              style={{ width: 44, height: 44, padding: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <IconSend />
            </button>
          )}
        </div>
        <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handlePickFiles} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 6, fontSize: 10.5, color: 'var(--mc-muted2)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--mc-accent)', display: 'inline-block' }} />
            studentbuddy · 本地优先
          </span>
          <span>·</span>
          <span>AI 生成内容仅供参考，请核对重要信息</span>
        </div>
        </div>{/* 输入区居中窄列 */}
      </div>
      )}
    </div>
  );
}
