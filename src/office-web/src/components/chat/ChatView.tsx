import { Fragment } from 'react';
import MessageActions from '../MessageActions';
import { LEVELS } from './chatStyles';
import { IconChat, IconCheck, IconContext, IconCross, IconFile, IconFileCode, IconModel, IconPlus, IconSearch, IconSend, IconSkills, IconStop, IconThink } from './chatIcons';
import { HistoryNavPanel } from './HistoryNavPanel';
import { TodoList, ToolSteps } from './TaskComponents';
import { AssistantBody } from './Markdown';
import { ReasoningBlock, StageIndicator, StatusTextRotation, WaitingIndicator } from './StatusIndicators';
import { fmtMsgTime } from './chatUtils';
import type { ChatPaneStore } from './useChatPane';

/** Chat 视图（消息流 + 底部输入区），从 ChatPane.tsx 拆出，纯渲染。 */
export function ChatView({ store }: { store: ChatPaneStore }) {
  const {
    msgs, msgMetaRef, navCollapsed, setNavCollapsed, historyScrollRef,
    creatingSession, stalled, retryLast, busy, todos, steps, reasoning, stage, justDone,
    isFirstOfSessionRef, thinkLevel, elapsed, handleActionResult, onOpenPreview,
    extractHtml, bottomRef, selectedSkills, setSelectedSkills, attachments, setAttachments,
    showModel, toggleModel, modelOptions, selectedModel, onSelectModel, setShowModel,
    showSkills, toggleSkills, skillOptions, showAttach, toggleAttach, fileInputRef,
    handlePickFiles, paneArtifacts, paneChanges, searchOn, toggleSearch, showThink,
    toggleThink, setLevel, showCtx, toggleCtx, ctxPct, ctxColor, ctx, ctxData,
    input, setInput, handleSend, handleStop, sendText,
  } = store;

  return (
    <div data-mc-chatview style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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
          autoHighlightId={msgs.length > 0 ? (msgMetaRef.current[msgs.length - 1]?.id || null) : null}
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
                  {isLast && (busy || justDone) && <StageIndicator stage={stage} hasTool={steps.length > 0} toolCount={steps.length} done={justDone} />}
                  {isLast && busy && isFirstOfSessionRef.current && !m.content && !m.error && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--mc-muted)', margin: '2px 0 8px' }}>
                      <span className="mc-spin" style={{ width: 13, height: 13, borderRadius: '50%', border: '2px solid var(--mc-accent)', borderTopColor: 'transparent' }} />
                      <span>会话创建中…</span>
                    </div>
                  )}
                </>
              )}
              <div className="mc-msg" data-msg-id={msgMetaRef.current[i]?.id} style={{ position: 'relative', display: 'flex', marginBottom: 26, gap: 12, justifyContent: isAssistant ? 'flex-start' : 'flex-end', alignItems: 'flex-start' }}>
              {/* AI 头像（大厂式：左侧渐变圆形标识，AI 通栏内容流） */}
              {isAssistant && (
                <div style={{
                  width: 30, height: 30, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 55%, #a855f7 100%)',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: 'var(--mc-shadow-sm)',
                }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a7 7 0 0 0-7 7c0 2.5 1.3 4.7 3.2 6 .5.3.8.9.8 1.5V18a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-1.5c0-.6.3-1.2.8-1.5A7 7 0 0 0 19 9a7 7 0 0 0-7-7z" />
                  </svg>
                </div>
              )}
              <div style={{ maxWidth: isAssistant ? 'calc(100% - 46px)' : '78%', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <div style={{
                // AI 通栏内容流（无气泡）：正文整行铺开，对标 Trae/WorkBuddy；
                // 用户消息保留右侧圆角气泡（大厂统一做法）。
                padding: isAssistant ? '2px 0' : '10px 16px',
                borderRadius: isAssistant ? 0 : '18px 18px 6px 18px',
                lineHeight: isAssistant ? 1.75 : 1.65, fontSize: 14,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                background: m.error ? (isAssistant ? 'transparent' : 'rgba(255,69,58,.10)') : isAssistant ? 'transparent' : 'var(--mc-accent)',
                color: m.error ? 'var(--mc-danger)' : isAssistant ? 'var(--mc-msg-ai)' : '#fff',
                border: m.error ? (isAssistant ? '1px solid transparent' : '1px solid var(--mc-danger)') : isAssistant ? 'none' : 'none',
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
                  <MessageActions text={m.content} title="studentbuddy 回复" iconColor="var(--mc-muted)" hoverBg="var(--mc-seg)" onResult={handleActionResult} />
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

        {/* 大厂式输入框：大圆角容器 + textarea 融入 + 右侧圆形发送（Trae / WorkBuddy 同款） */}
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 10,
          background: 'var(--mc-glass-strong)', border: '1px solid var(--mc-hair)',
          borderRadius: 20, padding: '8px 8px 8px 18px',
          boxShadow: 'var(--mc-shadow-sm)', transition: 'border-color .15s, box-shadow .15s, background 0.25s',
        }}
          onFocusCapture={e => { e.currentTarget.style.borderColor = 'var(--mc-accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--mc-accent-soft)'; }}
          onBlurCapture={e => { e.currentTarget.style.borderColor = 'var(--mc-hair)'; e.currentTarget.style.boxShadow = 'var(--mc-shadow-sm)'; }}>
          {/* 一键出题：发送预置指令，让 AI 按 [QUIZ] 结构出选择题，前端渲染成可交互卡片 */}
          <button
            onClick={() => {
              if (busy) return;
              sendText('请针对当前对话的主题，出 4 道选择题（含正确答案与解析），严格使用 [QUIZ] JSON 格式输出，不要输出多余文字。');
            }}
            disabled={busy}
            title="一键出题：让 AI 基于当前对话主题生成一套选择题"
            style={{
              display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
              padding: '8px 14px', marginBottom: '2px', border: 'none', borderRadius: 12,
              background: 'var(--mc-accent-soft)', color: 'var(--mc-accent)',
              cursor: busy ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600,
              opacity: busy ? 0.5 : 1, transition: 'background .15s, transform .08s',
            }}
            onMouseEnter={e => { if (!busy) { e.currentTarget.style.background = 'rgba(10,132,255,.2)'; e.currentTarget.style.transform = 'scale(1.03)'; } }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--mc-accent-soft)'; e.currentTarget.style.transform = 'scale(1)'; }}
          >
            🎯 <span>一键出题</span>
          </button>
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
        </div>{/* 输入区居中窄列 */}
      </div>
    </div>
  );
}
