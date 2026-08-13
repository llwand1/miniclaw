// QuizBankPage —— 题库页：管理 AI 生成 / 导入的选择题组。
//
// 能力：
// 1) 列表：从 /api/quiz-bank 拉取，显示标题/题数/来源/时间，点击展开练习（复用 QuizCard）；
// 2) 练习：展开后就是 QuizCard 的可交互做题体验（点选 → 查看答案 → 对错判定）；
// 3) 导入：粘贴文本（支持 [QUIZ] 块或 JSON）→ POST /api/quiz-bank/import 批量入库；
// 4) 删除：每组题目可删除。
import { useEffect, useState } from 'react';
import { QuizCard, parseQuiz } from '../components/QuizCard';
import type { QuizData } from '../components/QuizCard';
import { IconDatabase, IconDownload, IconPlus, IconTrash } from '../components/Icons';

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
        setMsg(`✓ 成功导入 ${d.imported} 组题目`);
        setImportText('');
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
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', border: 'none', borderRadius: 10, background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 8px rgba(99,102,241,.3)', transition: 'background .15s' }}>
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
              粘贴 AI 回复里的 <code style={{ background: 'var(--bg-muted)', padding: '1px 5px', borderRadius: 4 }}>[QUIZ]...[/QUIZ]</code> 内容，或其它工具导出的选择题 JSON（可含多组）。
              在对话页点「收藏到题库」也会自动存入这里。
            </div>
            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder={'[QUIZ]\n{\n  "title": "示例",\n  "questions": [{ "type": "single", "question": "…", "options": {"A":"…","B":"…","C":"…","D":"…"}, "answer": ["A"], "explanation": "…" }]\n}\n[/QUIZ]'}
              style={{ width: '100%', minHeight: 120, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-muted)', color: 'var(--text)', fontSize: 12.5, fontFamily: 'monospace', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={doImport} disabled={busy || !importText.trim()}
                style={{ padding: '8px 18px', border: 'none', borderRadius: 9, background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: busy || !importText.trim() ? 'not-allowed' : 'pointer', opacity: busy || !importText.trim() ? 0.5 : 1 }}>
                {busy ? '导入中…' : '导入'}
              </button>
              <button onClick={() => setShowImport(false)}
                style={{ padding: '8px 14px', border: '1px solid var(--border)', borderRadius: 9, background: 'transparent', color: 'var(--text-3)', fontSize: 12.5, cursor: 'pointer' }}>
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
            <div style={{ fontSize: 40, marginBottom: 12 }}>📚</div>
            <div style={{ fontSize: 14.5, color: 'var(--text-2)', fontWeight: 600, marginBottom: 6 }}>题库还是空的</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-4)', lineHeight: 1.8 }}>
              两种方式开始：<br />
              ① 在「对话」页点 <b>🎯 一键出题</b>，AI 生成后点卡片上的「收藏到题库」；<br />
              ② 点右上角「导入题目」，粘贴已有的 [QUIZ] 内容。
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {items.map(item => (
              <div key={item.id} style={{ borderRadius: 14, background: 'var(--bg-surface)', border: '1px solid var(--border)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)', transition: 'border-color .15s' }}>
                {/* 组头：标题 / 元信息 / 删除 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', cursor: 'pointer', background: expanded === item.id ? 'var(--bg-muted)' : 'transparent', transition: 'background .15s' }}
                  onClick={() => setExpanded(prev => prev === item.id ? null : item.id)}>
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
                    style={{ border: 'none', background: 'transparent', color: 'var(--text-4)', cursor: 'pointer', padding: 6, borderRadius: 8, display: 'flex' }}>
                    <IconTrash size={15} />
                  </button>
                </div>
                {/* 练习区：展开时渲染 QuizCard（可交互做题） */}
                {expanded === item.id && (
                  <div style={{ padding: '6px 16px 16px', borderTop: '1px solid var(--border-light)' }}>
                    <QuizCard data={item.data} />
                    <div style={{ fontSize: 11.5, color: 'var(--text-4)', marginTop: 6 }}>选择答案后点「查看答案」即可对错判定 + 看解析。</div>
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
