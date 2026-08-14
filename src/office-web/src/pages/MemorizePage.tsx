// MemorizePage —— 背背背：记忆单词 / 专有名词的最小可用背诵页。
//
// 能力：
// 1) 词条管理：列表展示 term/definition/category/掌握状态，支持新增、编辑、删除、批量清理；
// 2) 背背背模式：点「开始背诵」进入翻卡流——先看词条（正面），点「显示释义」翻面，
//    然后标记「记住了 / 没记住 / 跳过」，记忆度自动推进（review_count、mastered）；
// 3) 与对话页配合：每个词条可「AI 讲解 / 造句 / 出题」（fork 子会话，内容在对话里展开），
//    也可一键把词条加入背诵本。
import { useEffect, useMemo, useState } from 'react';
import { IconBrain, IconPlus, IconCheck, IconEdit, IconTrash, IconDatabase, IconRefresh } from '../components/Icons';
import { IconCross, IconTarget, IconParty, IconTrophy, IconRobot, IconSparkles } from '../components/chat/chatIcons';

interface MemItem {
  id: string;
  term: string;
  definition: string;
  category: string;
  difficulty: number;
  review_count: number;
  mastered: number;
  last_review_at: string | null;
  created_at: string;
}

const CATEGORIES = ['单词', '术语', '人名', '地名', '缩写', '公式', '其他'];

export default function MemorizePage({ sessionId, onForkTerm }: {
  /** 当前对话会话 id（对话页传入）：用于 fork 子会话让 AI 讲解/造句/出题 */
  sessionId?: string | null;
  /** fork 词条学习子会话的回调（由 ChatPage 实现：fork + 发消息 + 打开子对话） */
  onForkTerm?: (term: string, definition: string, mode: 'explain' | 'example' | 'quiz') => void;
}) {
  const [items, setItems] = useState<MemItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<{ total: number; mastered: number; toReview: number; categories: { category: string; n: number }[] }>({ total: 0, mastered: 0, toReview: 0, categories: [] });
  const [msg, setMsg] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ term: '', definition: '', category: '单词', difficulty: 1 });
  const [editId, setEditId] = useState<string | null>(null);
  // 背背背模式状态
  const [reciting, setReciting] = useState(false);
  const [finished, setFinished] = useState(false); // 全部翻完后进入结束总结
  const [queue, setQueue] = useState<MemItem[]>([]);
  const [qi, setQi] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [sessionResults, setSessionResults] = useState({ remembered: 0, forgotten: 0, skipped: 0 });

  async function load() {
    try {
      const [r, s] = await Promise.all([
        fetch('/api/memorize'),
        fetch('/api/memorize/stats'),
      ]);
      const d = await r.json();
      const st = await s.json();
      if (Array.isArray(d)) setItems(d);
      if (st && typeof st.total === 'number') setStats(st);
    } catch { /* ignore */ }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const byCategory = useMemo(() => {
    const map: Record<string, MemItem[]> = {};
    for (const it of items) {
      (map[it.category] ||= []).push(it);
    }
    return map;
  }, [items]);

  async function saveItem() {
    if (!form.term.trim() || !form.definition.trim()) {
      setMsg('词条与释义都不能为空');
      return;
    }
    setMsg('');
    try {
      const payload = { ...form, term: form.term.trim(), definition: form.definition.trim() };
      const r = await fetch(editId ? '/api/memorize/' + editId : '/api/memorize', {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok || d.error) {
        setMsg((d && d.error) || '保存失败');
      } else {
        setShowAdd(false);
        setEditId(null);
        setForm({ term: '', definition: '', category: '单词', difficulty: 1 });
        load();
      }
    } catch (err: any) {
      setMsg('保存出错：' + err.message);
    }
  }

  async function deleteItem(id: string) {
    try {
      await fetch('/api/memorize/' + id, { method: 'DELETE' });
      load();
    } catch { /* ignore */ }
  }

  async function markReview(id: string, mastered: boolean) {
    try {
      await fetch('/api/memorize/' + id + '/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mastered }),
      });
    } catch { /* ignore */ }
  }

  // ─── 背背背：开始背诵（取未掌握的优先，全掌握则全部）───
  function startRecite() {
    const pool = items.filter(it => !it.mastered);
    const list = (pool.length > 0 ? pool : items).slice();
    // 简单的间隔重复：复习次数少的排前面（刚背过的沉底）
    list.sort((a, b) => a.review_count - b.review_count);
    setQueue(list);
    setQi(0);
    setFlipped(false);
    setFinished(false);
    setSessionResults({ remembered: 0, forgotten: 0, skipped: 0 });
    setReciting(true);
  }

  // 标记当前卡片 → 自动翻到下一张（最后一张时进入结束总结并刷新列表）
  function advance(mastered: boolean | null) {
    if (mastered === true) {
      setSessionResults(s => ({ ...s, remembered: s.remembered + 1 }));
    } else if (mastered === false) {
      setSessionResults(s => ({ ...s, forgotten: s.forgotten + 1 }));
    } else {
      setSessionResults(s => ({ ...s, skipped: s.skipped + 1 }));
    }
    const cur = queue[qi];
    if (cur && mastered !== null) markReview(cur.id, mastered === true);
    // 记录本题判定结果（供「再来一轮没记住的」使用）
    setSelByIndex(prev => ({ ...prev, [qi]: mastered }));
    if (qi + 1 >= queue.length) {
      setFinished(true);
      load();
      return;
    }
    setQi(qi + 1);
    setFlipped(false);
  }

  // 结束总结后「再来一轮」：只复习本轮没记住的词条
  function restartForgotten() {
    const forgotten = queue.filter((it, i) => {
      const mySel = selByIndex[i];
      return mySel === false;
    });
    if (forgotten.length === 0) { quitRecite(); return; }
    setQueue(forgotten);
    setQi(0);
    setFlipped(false);
    setFinished(false);
    setSessionResults({ remembered: 0, forgotten: 0, skipped: 0 });
  }

  // 记录每张卡片的判定结果（供「再来一轮没记住的」使用）
  const [selByIndex, setSelByIndex] = useState<Record<number, boolean | null>>({});

  function quitRecite() {
    setReciting(false);
    setFinished(false);
    load();
  }

  // 对话联动：fork 子会话打开对话页？——背诵页内无法直接打开会话，这里改为提示由对话页配合；
  // 实际 fork 在 ChatPage 侧处理（见 ChatPage 传入的 onForkTerm），本页仅触发回调。
  const current = queue[qi];

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--bg)', transition: 'background 0.25s' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 28px 60px' }}>
        {/* 顶部：标题 + 操作（与题库页同款头部） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.25s, color 0.25s' }}>
            <IconBrain size={18} />
          </span>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)', transition: 'color 0.25s' }}>背背背</h1>
            <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-4)', transition: 'color 0.25s' }}>记忆单词与专有名词，背熟了自然就记住了</p>
          </div>
          <button onClick={() => { setShowAdd(v => !v); setEditId(null); setForm({ term: '', definition: '', category: '单词', difficulty: 1 }); }}
            className="mc-float"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', border: 'none', borderRadius: 10, background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,185,107,.3)', transition: 'transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s, background .15s' }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,185,107,.35)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,185,107,.3)'; }}>
            <IconPlus size={15} /> 添加词条
          </button>
        </div>

        {/* 统计条 */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          {[
            { label: '总词条', value: stats.total, color: 'var(--accent)', icon: <IconDatabase size={20} /> },
            { label: '已掌握', value: stats.mastered, color: 'var(--success)', icon: <IconCheck size={20} /> },
            { label: '待复习', value: stats.toReview, color: 'var(--danger)', icon: <IconRefresh size={20} /> },
          ].map(s => (
            <div key={s.label} style={{ flex: '1 1 120px', padding: '12px 14px', borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', display: 'flex', alignItems: 'center', gap: 10, transition: 'transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s, background .15s' }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.borderColor = 'var(--border)'; }}>
              <span style={{ display: 'inline-flex', width: 38, height: 38, borderRadius: 10, background: 'var(--accent-soft)', color: s.color, alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 0.25s, color 0.25s' }}>{s.icon}</span>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1.1 }}>{s.value}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-4)' }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {msg && (
          <div style={{ marginBottom: 12, padding: '8px 14px', borderRadius: 10, fontSize: 12.5, background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid var(--danger-bdr)' }}>{msg}</div>
        )}

        {/* 添加 / 编辑表单 */}
        {showAdd && (
          <div style={{ marginBottom: 16, padding: '14px 16px', borderRadius: 14, background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', transition: 'background 0.25s, border-color 0.25s' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--text)', transition: 'color 0.25s' }}>{editId ? '编辑词条' : '添加词条'}</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input value={form.term} onChange={e => setForm(f => ({ ...f, term: e.target.value }))} placeholder="词条（如 photosynthesis）"
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-soft)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; }}
                style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-muted)', color: 'var(--text)', fontSize: 13, outline: 'none', transition: 'border-color .15s, box-shadow .15s' }} />
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-muted)', color: 'var(--text)', fontSize: 12.5, outline: 'none', cursor: 'pointer' }}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <textarea value={form.definition} onChange={e => setForm(f => ({ ...f, definition: e.target.value }))} placeholder="释义 / 解释（一句话即可）"
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-soft)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; }}
              style={{ width: '100%', minHeight: 56, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-muted)', color: 'var(--text)', fontSize: 12.5, outline: 'none', resize: 'vertical', boxSizing: 'border-box', transition: 'border-color .15s, box-shadow .15s' }} />
            <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-4)' }}>难度</span>
              {[0, 1, 2].map(d => (
                <button key={d} onClick={() => setForm(f => ({ ...f, difficulty: d }))}
                  className="mc-float"
                  style={{ padding: '4px 12px', borderRadius: 8, border: '1px solid ' + (form.difficulty === d ? 'var(--accent)' : 'var(--border)'), background: form.difficulty === d ? 'var(--accent-soft)' : 'transparent', color: form.difficulty === d ? 'var(--accent)' : 'var(--text-3)', fontSize: 12, cursor: 'pointer', transition: 'transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s, background .15s, color .15s' }}
                  onMouseEnter={e => { if (form.difficulty !== d) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.background = 'var(--bg-muted)'; } }}
                  onMouseLeave={e => { if (form.difficulty !== d) { e.currentTarget.style.transform = 'none'; e.currentTarget.style.background = 'transparent'; } }}>
                  {d === 0 ? '易' : d === 1 ? '中' : '难'}
                </button>
              ))}
              <span style={{ flex: 1 }} />
              <button onClick={saveItem} className="mc-float"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 16px', border: 'none', borderRadius: 8, background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,185,107,.25)', transition: 'transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 10px rgba(0,185,107,.3)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,185,107,.25)'; }}>
                <IconCheck size={14} /> 保存
              </button>
              <button onClick={() => { setShowAdd(false); setEditId(null); }} style={{ padding: '7px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'transparent', color: 'var(--text-3)', fontSize: 12.5, cursor: 'pointer', transition: 'background .15s, color .15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-muted)'; e.currentTarget.style.color = 'var(--text)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; }}>
                取消
              </button>
            </div>
          </div>
        )}

        {/* 开始背诵按钮 */}
        {!reciting && items.length > 0 && (
          <button onClick={startRecite}
            className="mc-float"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '13px 0', marginBottom: 16, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, var(--accent), #0d9a63)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,185,107,.3)', transition: 'transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s' }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(0,185,107,.4)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,185,107,.3)'; }}>
            <IconTarget /> 开始背诵（{stats.toReview > 0 ? `${stats.toReview} 个待复习` : `${stats.total} 个全掌握，复习全部`}）
          </button>
        )}

        {/* ─── 背背背模式：翻卡流 ─── */}
        {reciting && !finished && current && (
          <div style={{ marginBottom: 16, padding: '18px', borderRadius: 16, background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', textAlign: 'center', transition: 'background 0.25s, border-color 0.25s' }}>
            {/* 进度条 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--text-4)', whiteSpace: 'nowrap' }}>第 {qi + 1} / {queue.length} 张</span>
              <div style={{ flex: 1, height: 6, borderRadius: 4, background: 'var(--bg-muted)', overflow: 'hidden', transition: 'background 0.25s' }}>
                <div style={{ height: '100%', borderRadius: 4, background: 'linear-gradient(90deg, var(--accent), #0d9a63)', width: `${Math.round(((qi + 1) / queue.length) * 100)}%`, transition: 'width .3s ease' }} />
              </div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-4)', whiteSpace: 'nowrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--success)' }}><IconCheck size={12} /> {sessionResults.remembered}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--danger)' }}><IconCross /> {sessionResults.forgotten}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>跳过 {sessionResults.skipped}</span>
              </span>
            </div>
            {/* 卡片：正面词条 / 反面释义（翻面 3D 动画） */}
            <div key={flipped ? 'back' : 'front'} className="mem-flip" onClick={() => setFlipped(v => !v)}
              style={{ minHeight: 150, padding: '20px 18px', borderRadius: 14, border: '2px solid var(--accent)', background: flipped ? 'rgba(52,199,89,.06)' : 'rgba(99,102,241,.06)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'background .2s, border-color 0.25s' }}>
              {!flipped ? (
                <>
                  <div style={{ fontSize: 15, color: 'var(--text-4)' }}>点卡片翻面看释义</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)', wordBreak: 'break-word' }}>{current.term}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-4)' }}>{current.category} · 难度{'易中难'[current.difficulty]} · 已复习 {current.review_count} 次</div>
                </>
              ) : (
                <div style={{ fontSize: 15, color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxWidth: 560 }}>{current.definition}</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
              {!flipped ? (
                <button onClick={() => setFlipped(true)}
                  className="mc-float"
                  style={{ padding: '9px 22px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,185,107,.3)', transition: 'transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s' }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 5px 14px rgba(0,185,107,.4)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,185,107,.3)'; }}>
                  显示释义
                </button>
              ) : (
                <>
                  <button onClick={() => advance(false)}
                    className="mc-float"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 10, border: 'none', background: 'var(--danger)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(239,68,68,.3)', transition: 'transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s' }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 5px 14px rgba(239,68,68,.4)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(239,68,68,.3)'; }}>
                    <IconCross /> 没记住
                  </button>
                  <button onClick={() => advance(null)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-3)', fontSize: 13, cursor: 'pointer', transition: 'background .15s, color .15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-muted)'; e.currentTarget.style.color = 'var(--text)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; }}>
                    <IconRefresh size={13} /> 跳过
                  </button>
                  <button onClick={() => advance(true)}
                    className="mc-float"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 10, border: 'none', background: 'var(--success)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(16,185,129,.3)', transition: 'transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s' }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 5px 14px rgba(16,185,129,.4)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(16,185,129,.3)'; }}>
                    <IconCheck size={13} /> 记住了
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ─── 背诵完成总结 ─── */}
        {reciting && finished && (
          <div className="mem-done" style={{ marginBottom: 16, padding: '22px 18px', borderRadius: 16, textAlign: 'center', background: 'linear-gradient(135deg, rgba(0,185,107,.08), rgba(52,199,89,.05))', border: '1px solid ' + (sessionResults.forgotten === 0 ? 'rgba(52,199,89,.4)' : 'rgba(239,68,68,.3)'), boxShadow: 'var(--shadow-sm)', transition: 'background 0.25s, border-color 0.25s' }}>
            <div style={{ display: 'inline-flex', width: 56, height: 56, borderRadius: '50%', background: sessionResults.forgotten === 0 ? 'var(--success-bg)' : 'var(--warning-bg)', color: sessionResults.forgotten === 0 ? 'var(--success)' : 'var(--warning)', alignItems: 'center', justifyContent: 'center', marginBottom: 10, transition: 'background 0.25s, color 0.25s' }}>
              <span style={{ display: 'inline-flex', transform: 'scale(1.8)' }}>
                {sessionResults.forgotten === 0 ? <IconParty /> : <IconTrophy />}
              </span>
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', marginBottom: 6, transition: 'color 0.25s' }}>
              本轮背诵完成！
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.8, marginBottom: 14, flexWrap: 'wrap', transition: 'color 0.25s' }}>
              <span>共 {queue.length} 张卡片</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--success)' }}><IconCheck size={13} /> 记住 {sessionResults.remembered}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--danger)' }}><IconCross /> 没记住 {sessionResults.forgotten}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>跳过 {sessionResults.skipped}</span>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              {sessionResults.forgotten > 0 && (
                <button onClick={restartForgotten}
                  className="mc-float"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,185,107,.3)', transition: 'transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s' }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 5px 14px rgba(0,185,107,.4)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,185,107,.3)'; }}>
                  <IconRefresh size={14} /> 再背 {sessionResults.forgotten} 个没记住的
                </button>
              )}
              <button onClick={quitRecite}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-3)', fontSize: 13, cursor: 'pointer', transition: 'background .15s, color .15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-muted)'; e.currentTarget.style.color = 'var(--text)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; }}>
                <IconCheck size={13} /> 完成
              </button>
            </div>
          </div>
        )}

        {/* ─── 词条列表 ─── */}
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-4)', fontSize: 13.5 }}>加载中…</div>
        ) : items.length === 0 ? (
          <div style={{ padding: '70px 20px', textAlign: 'center', background: 'var(--bg-surface)', border: '1px dashed var(--border)', borderRadius: 16, transition: 'background 0.25s, border-color 0.25s' }}>
            <span style={{ display: 'inline-flex', width: 56, height: 56, borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent)', alignItems: 'center', justifyContent: 'center', marginBottom: 12, transition: 'background 0.25s, color 0.25s' }}>
              <IconBrain size={26} />
            </span>
            <div style={{ fontSize: 14.5, color: 'var(--text-2)', fontWeight: 600, marginBottom: 6, transition: 'color 0.25s' }}>背诵本还是空的</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-4)', lineHeight: 1.8 }}>
              点右上角「添加词条」录入要记的单词或专有名词；<br />
              也可以在「对话」页让 AI 出题后，点题目卡片的「收词入背诵本」一键收藏术语。
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Object.entries(byCategory).map(([cat, list]) => (
              <div key={cat}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--text-4)', margin: '6px 2px', transition: 'color 0.25s' }}>
                  {cat}
                  <span style={{ fontSize: 10.5, padding: '0 7px', borderRadius: 8, background: 'var(--bg-muted)', color: 'var(--text-3)', transition: 'background 0.25s, color 0.25s' }}>{list.length}</span>
                </div>
                {list.map(it => (
                  <div key={it.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', marginBottom: 6, borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', transition: 'transform .16s cubic-bezier(.2,.7,.3,1), box-shadow .16s, border-color .15s, background 0.25s' }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.borderColor = 'var(--border)'; }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', transition: 'color 0.25s' }}>{it.term}</span>
                        {it.mastered === 1 && <span style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 6, background: 'var(--success-bg)', color: 'var(--success)', border: '1px solid var(--success-bdr)', transition: 'background 0.25s, color 0.25s, border-color 0.25s' }}><IconCheck size={9} /> 已掌握</span>}
                        <span style={{ fontSize: 10.5, color: 'var(--text-4)' }}>复习 {it.review_count} 次</span>
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.6, transition: 'color 0.25s' }}>{it.definition}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button title="fork 子对话，让 AI 讲解 / 造句 / 出题这个词条"
                        onClick={() => onForkTerm && onForkTerm(it.term, it.definition, 'explain')}
                        disabled={!onForkTerm}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-3)', fontSize: 11.5, cursor: onForkTerm ? 'pointer' : 'not-allowed', opacity: onForkTerm ? 1 : .6, transition: 'background .15s, color .15s, border-color .15s, transform .16s cubic-bezier(.2,.7,.3,1)' }}
                        onMouseEnter={e => { if (onForkTerm) { e.currentTarget.style.background = 'var(--accent-soft)'; e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
                        onMouseLeave={e => { if (onForkTerm) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'none'; } }}>
                        <IconRobot /> AI 学
                      </button>
                      <button onClick={() => { setEditId(it.id); setShowAdd(true); setForm({ term: it.term, definition: it.definition, category: it.category, difficulty: it.difficulty }); }}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-3)', fontSize: 11.5, cursor: 'pointer', transition: 'background .15s, color .15s, transform .16s cubic-bezier(.2,.7,.3,1)' }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-muted)'; e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.transform = 'none'; }}>
                        <IconEdit size={12} /> 编辑
                      </button>
                      <button onClick={() => deleteItem(it.id)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--danger)', fontSize: 11.5, cursor: 'pointer', transition: 'background .15s, color .15s, transform .16s cubic-bezier(.2,.7,.3,1)' }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--danger-bg)'; e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.transform = 'none'; }}>
                        <IconTrash size={12} /> 删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
