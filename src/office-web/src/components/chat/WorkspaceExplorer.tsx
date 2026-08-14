import { CSSProperties, Fragment, ReactNode, useEffect, useState } from 'react';
import { IconAlert, IconCaret, IconFileCode, IconFolder } from './chatIcons';
import { lcsLineDiff } from './chatUtils';
import { FoldText } from './TaskComponents';

// ─── 工作区浏览器：目录树 + 文件预览 + 文件变更 diff/撤销 ───────────────
export function WorkspaceExplorer({ changes, onRevert, onToast }: { changes: any[]; onRevert: (id: string) => void; onToast?: (msg: string) => void }) {
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
          工作区已关闭（纯对话模式）。<br />点「设置」可开启——系统已在<br />「用户主目录 / studentbuddyWorkspace」<br />自动建好默认工作区，也可改为你的项目目录。
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
                      <span style={{ display: 'inline-flex', flexShrink: 0, marginTop: 1 }}><IconAlert /></span> 文件较大（{fileMeta.size?.toLocaleString?.() ?? ''} 字节），已截断显示，如需完整内容可在对话中让 AI 分段读取。
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
