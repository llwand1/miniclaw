// QuizBankPage —— 题库页：管理 AI 生成 / 导入的练习题组（选择题/填空题/解答题）。
//
// 能力：
// 1) 列表：从 /api/quiz-bank 拉取，显示标题/题数/来源/时间，点击展开练习（复用 QuizCard）；
// 2) 练习：展开后就是 QuizCard 的可交互做题体验（点选/填空/作答 → 查看答案 → 对错判定）；
// 3) 导入：选择文件或粘贴文本 → AI 解析成结构化题目（/api/quiz-bank/ai-import）批量入库；
// 4) 删除：每组题目可删除。
import { useEffect, useState } from 'react';
import { QuizCard } from '../components/QuizCard';
import type { QuizData } from '../components/QuizCard';
import { IconDatabase, IconDownload, IconTrash } from '../components/Icons';
import { IconBook, IconCheck, IconClock, IconCross, IconPaperclip, IconRobot, IconTarget } from '../components/chat/chatIcons';

interface BankItem {
  id: string;
  title: string;
  source: string;
  created_at: string;
  question_count: number;
  data: QuizData;
}

const sourceLabel: Record<string, string> = { ai: 'AI 生成', import: '导入', manual: '手动' };

export default function QuizBankPage() {
  const [items, setItems] = useState<BankItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await fetch('/api/quiz-bank');
      const d = await r.json();
      if (Array.isArray(d)) setItems(d);
    } catch { /* ignore */ }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // 普通文本导入（直接粘贴 [QUIZ] JSON 的快捷通道，不消耗 LLM）
  async function doImport() {
    if (!importText.trim() || busy) return;
    setBusy(true);
    setMsg('');
    try {
      const r = await fetch('/api/quiz-bank/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: importText }),
      });
      const d = await r.json();
      if (d.error) {
        setMsg('导入失败：' + d.error);
      } else if (d.imported > 0) {
        setMsg('成功导入 ' + d.imported + ' 组题目');
        setImportText('');
        setImportFile(null);
        setShowImport(false);
        load();
      } else {
        setMsg('未解析到有效题目：请确认文本包含 [QUIZ]...[/QUIZ] JSON 块');
      }
    } catch (err: any) {
      setMsg('导入出错：' + err.message);
    }
    setBusy(false);
  }

  // AI 导入：优先文件（上传 → AI 解析），其次粘贴文本（AI 解析）
  async function doAiImport() {
    if (busy) return;
    const hasText = !!importText.trim();
    if (!importFile && !hasText) {
      setMsg('请选择文件，或粘贴一段文本内容');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      let payload: any;
      if (importFile) {
        // 1) 上传文件到服务端暂存（raw 字节 + name 查询参数）
        const up = await fetch('/api/files/upload?name=' + encodeURIComponent(importFile.name), {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: importFile,
        });
        const upData = await up.json().catch(() => null);
        if (!up.ok || !upData || !upData.path) {
          setMsg('文件上传失败：' + ((upData && upData.error) || `HTTP ${up.status}`));
          setBusy(false);
          return;
        }
        payload = { path: upData.path, title: importFile.name.replace(/\.[^.]+$/, '') };
      } else {
        payload = { text: importText, title: '' };
      }
      // 2) AI 解析为题目组
      const r = await fetch('/api/quiz-bank/ai-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d || d.error) {
        setMsg('AI 解析失败：' + ((d && d.error) || `HTTP ${r.status}`));
      } else if (d.imported > 0) {
        setMsg(`AI 解析成功，导入 ${d.imported} 组题目（${d.items?.[0]?.question_count ?? '?'} 题）`);
        setImportText('');
        setImportFile(null);
        setShowImport(false);
        load();
      } else {
        setMsg('AI 未解析出有效题目，请换一份资料或重试');
      }
    } catch (err: any) {
      setMsg('AI 导入出错：' + err.message);
    }
    setBusy(false);
  }

  async function doDelete(id: string) {
    try {
      await fetch('/api/quiz-bank/' + id, { method: 'DELETE' });
      setItems(prev => prev.filter(x => x.id !== id));
    } catch { /* ignore */ }
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--bg)', transition: 'background 0.25s' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 28px 60px' }}>
        {/* 顶部：标题 + 操作 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconDatabase size={18} />
          </span>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>题库</h1>
            <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-4)' }}>AI 出的题和导入的题都在这里，随时反复练习</p>
          </div>
          <button onClick={() => setShowImport(v => !v)}
            className="mc-float"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', border: 'none', borderRadius: 10, background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,185,107,.3)', transition: 'transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s, background .15s' }}>
            <IconDownload size={15} /> 导入题目
          </button>
        </div>

        {msg && (
          <div style={{ marginBottom: 14, padding: '9px 14px', borderRadius: 10, fontSize: 12.5, background: msg.includes('失败') || msg.includes('错误') || msg.includes('未解析') ? 'var(--danger-bg)' : 'var(--success-bg)', color: msg.includes('失败') || msg.includes('错误') || msg.includes('未解析') ? 'var(--danger)' : 'var(--success)', border: '1px solid ' + (msg.includes('失败') || msg.includes('错误') || msg.includes('未解析') ? 'var(--danger-bdr)' : 'var(--success-bdr)') }}>
            {msg}
          </div>
        )}

        {/* 导入面板 */}
        {showImport && (
          <div style={{ marginBottom: 20, padding: '16px 18px', borderRadius: 14, background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>导入题目</div>
            <div style={{ fontSize: 12, color: 'var(--text-4)', marginBottom: 10, lineHeight: 1.6 }}>
              选择 <b>文件</b>（PDF / Word / PPT / 文本等）或粘贴<b>文本</b>，AI 会自动解析成选择题 / 填空题 / 解答题并存入题库（网络来源题目会标注来源）。
              在对话页点「收藏到题库」也会自动存入这里。
            </div>

            {/* 文件选择 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <label
                className="mc-float"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 9, border: '1px dashed var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', transition: 'transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><IconPaperclip /> 选择文件</span>
                <input
                  type="file"
                  accept=".txt,.md,.pdf,.docx,.ppt,.pptx,.csv,.json,text/plain,application/pdf"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files && e.target.files[0];
                    setImportFile(f || null);
                    e.target.value = '';
                  }}
                />
              </label>
              <span style={{ fontSize: 12, color: importFile ? 'var(--text)' : 'var(--text-4)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {importFile ? `已选择：${importFile.name}（${(importFile.size / 1024).toFixed(0)} KB）` : '未选择文件（可粘贴文本替代）'}
              </span>
              {importFile && (
                <button onClick={() => setImportFile(null)} title="移除文件"
                  style={{ border: 'none', background: 'transparent', color: 'var(--text-4)', cursor: 'pointer', fontSize: 11.5, padding: '4px 8px', borderRadius: 6 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><IconCross /> 移除</span>
                </button>
              )}
            </div>

            {/* 粘贴文本（可选） */}
            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder={'也可以直接粘贴资料/题目文本，AI 会自动解析成题目。\n（若粘贴的是 [QUIZ] JSON，会走快速导入通道，不消耗 AI）'}
              style={{ width: '100%', minHeight: 96, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-muted)', color: 'var(--text)', fontSize: 12.5, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {/* 主按钮：AI 解析导入（文件或文本都行） */}
              <button onClick={doAiImport} disabled={busy || (!importFile && !importText.trim())}
                className="mc-float"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 18px', border: 'none', borderRadius: 9, background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: busy || (!importFile && !importText.trim()) ? 'not-allowed' : 'pointer', opacity: busy || (!importFile && !importText.trim()) ? 0.5 : 1, transition: 'transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s, opacity .15s' }}>
                {busy ? <><IconClock /> AI 解析中…</> : <><IconRobot /> AI 解析导入</>}
              </button>
              {/* 副按钮：粘贴的是 [QUIZ] JSON 时走快速通道 */}
              {importText.trim().includes('[QUIZ]') && (
                <button onClick={doImport} disabled={busy || !importText.trim()}
                  className="mc-float"
                  style={{ padding: '8px 14px', border: '1px solid var(--border)', borderRadius: 9, background: 'transparent', color: 'var(--text-3)', fontSize: 12.5, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1, transition: 'transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s, background .15s, color .15s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-muted)'; e.currentTarget.style.color = 'var(--text)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; }}>
                  快速导入 [QUIZ]
                </button>
              )}
              <button onClick={() => setShowImport(false)}
                className="mc-float"
                style={{ padding: '8px 14px', border: '1px solid var(--border)', borderRadius: 9, background: 'transparent', color: 'var(--text-3)', fontSize: 12.5, cursor: 'pointer', transition: 'transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s, background .15s, color .15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-muted)'; e.currentTarget.style.color = 'var(--text)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; }}>
                取消
              </button>
            </div>
          </div>
        )}

        {/* 空态 / 列表 */}
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-4)', fontSize: 13.5 }}>加载中…</div>
        ) : items.length === 0 ? (
          <div style={{ padding: '80px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12, display: 'flex', justifyContent: 'center', color: 'var(--text-4)' }}><IconBook /></div>
            <div style={{ fontSize: 14.5, color: 'var(--text-2)', fontWeight: 600, marginBottom: 6 }}>题库还是空的</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-4)', lineHeight: 1.8 }}>
              两种方式开始：<br />
              ① 在「对话」页点 <b><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, verticalAlign: '-2px' }}><IconTarget /></span> 一键出题</b>，AI 生成后点卡片上的「收藏到题库」；<br />
              ② 点右上角「导入题目」，上传 <b>文件</b>（PDF/Word/PPT/文本）或粘贴文本，AI 自动解析成题目。
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {items.map(item => (
              <div key={item.id} style={{ borderRadius: 14, background: 'var(--bg-surface)', border: '1px solid var(--border)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)', transition: 'border-color .15s' }}>
                {/* 组头：标题 / 元信息 / 删除 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', cursor: 'pointer', background: expanded === item.id ? 'var(--bg-muted)' : 'transparent', transition: 'background .15s, transform .16s cubic-bezier(.2,.7,.3,1)' }}
                  onClick={() => setExpanded(prev => prev === item.id ? null : item.id)}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-muted)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = expanded === item.id ? 'var(--bg-muted)' : 'transparent'; }}>
                  <span style={{ fontSize: 15, color: 'var(--accent)', flexShrink: 0, transition: 'transform .2s', transform: expanded === item.id ? 'rotate(90deg)' : 'none' }}>▶</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.title || '未命名题目组'}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-4)', marginTop: 2 }}>
                      {item.question_count} 题 · {sourceLabel[item.source] || item.source} · {item.created_at}
                    </div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); doDelete(item.id); }} title="删除这组题目"
                    style={{ border: 'none', background: 'transparent', color: 'var(--text-4)', cursor: 'pointer', padding: 6, borderRadius: 8, display: 'flex', transition: 'background .15s, color .15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--danger-bg)'; e.currentTarget.style.color = 'var(--danger)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-4)'; }}>
                    <IconTrash size={15} />
                  </button>
                </div>
                {/* 练习区：展开时渲染 QuizCard（可交互做题 + 做题统计：次数/准确率/连对） */}
                {expanded === item.id && (
                  <div style={{ padding: '6px 16px 16px', borderTop: '1px solid var(--border-light)' }}>
                    <QuizCard data={item.data} quizId={item.id} />
                    <div style={{ fontSize: 11.5, color: 'var(--text-4)', marginTop: 6 }}>选择答案后点「查看答案」即可对错判定 + 看解析；每次作答都会计入本题统计。</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
