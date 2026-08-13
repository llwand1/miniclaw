import { previewClient } from '../../preview/PreviewClient';
import { previewSandbox } from '../../../../shared/preview-types';
import { IconFileCode, IconTrace, fileIcon, typeLabel } from './chatIcons';
import { CodeFoldingBlock, MarkdownStream, hlCode } from './Markdown';
import { WorkspaceExplorer } from './WorkspaceExplorer';
import { TraceFlow } from './TraceFlow';
import { lcsLineDiff } from './chatUtils';
import type { ChatPaneStore } from './useChatPane';

/** 文件视图（产出文件列表 + 工作区浏览器 + 调用链 Trace + 右侧预览/审查），从 ChatPane.tsx 拆出，纯渲染。 */
export function FileView({ store }: { store: ChatPaneStore }) {
  const {
    wsTab, setWsTab, paneChanges, paneArtifacts, revertFile, onToast,
    activeChangeId, setActiveChangeId, activeArtifact, setActiveArtifact,
    active, activeChange, activeDiff, diffAdds, diffDels, fmtClock, isHtmlLike,
    onOpenPreview, trace,
  } = store;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* 子视图切换：产出文件 / 工作区 / Trace */}
      <div style={{ display: 'flex', gap: 2, alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid var(--mc-hair)', background: 'var(--mc-glass)' }}>
        <button className={`mc-pill ${wsTab === 'output' ? 'on' : ''}`} onClick={() => setWsTab('output')}>产出文件</button>
        <button className={`mc-pill ${wsTab === 'workspace' ? 'on' : ''}`} onClick={() => setWsTab('workspace')}>工作区</button>
        <button className={`mc-pill ${wsTab === 'trace' ? 'on' : ''}`} onClick={() => setWsTab('trace')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <IconTrace /> 调用链 Trace
        </button>
        {wsTab === 'output' && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--mc-muted2)', whiteSpace: 'nowrap' }}>
            {paneChanges.length} 变更 · {paneArtifacts.length} 产物
          </span>
        )}
      </div>
      {wsTab === 'workspace' ? (
        <WorkspaceExplorer changes={paneChanges} onRevert={revertFile} onToast={onToast} />
      ) : wsTab === 'trace' ? (
        <TraceFlow trace={trace} />
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
}
