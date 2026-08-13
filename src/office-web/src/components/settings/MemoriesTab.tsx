import { useEffect, useState } from 'react';
import { IconActivity, IconBrain, IconInfo, IconTrash } from '../Icons';
import { btnDanger, cardStyle } from './styles';

/** 长期记忆 Tab。从 SettingsPage 拆出。 */
export function MemoriesTab({ onMsg }: { onMsg: (msg: string) => void }) {
  const [memories, setMemories] = useState<any[]>([]);

  async function loadMemories() {
    try { setMemories(await (await fetch('/api/memories')).json()); } catch { /* ignore */ }
  }
  useEffect(() => { loadMemories(); }, []);

  async function delMemory(id: number) {
    if (!confirm('删除这条记忆？')) return;
    try {
      await fetch(`/api/memories/${id}`, { method: 'DELETE' });
      loadMemories();
    } catch { /* ignore */ }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <IconBrain size={18} style={{ color: 'var(--accent)' }} />
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>长期记忆</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-4)' }}>对话结束后 AI 自动总结值得记住的信息</p>
        </div>
      </div>

      <div style={{ ...cardStyle, background: 'var(--bg-inset)', borderStyle: 'dashed' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-3)' }}>
          <IconInfo size={14} />
          <span>A = 长期重要（上限 15 条）· B = 短期关注（上限 10 条）</span>
        </div>
      </div>

      {memories.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-4)' }}>
          <IconBrain size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
          <div style={{ fontSize: 14, marginBottom: 4 }}>暂无记忆</div>
          <div style={{ fontSize: 12 }}>开始对话后 AI 会自动生成</div>
        </div>
      )}

      {(['A', 'B'] as const).map(cat => {
        const items = memories.filter((m: any) => m.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat} style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, marginBottom: 10, color: cat === 'A' ? '#7c3aed' : '#2563eb', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
              {cat === 'A' ? <IconBrain size={16} /> : <IconActivity size={16} />}
              {cat === 'A' ? '长期记忆' : '短期记忆'}
              <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-4)' }}>（{items.length} 条）</span>
            </h3>
            {items.map((m: any) => (
              <div key={m.id} style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
                <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{m.content}</span>
                <button onClick={() => delMemory(m.id)} style={{ ...btnDanger, fontSize: 11, padding: '3px 10px' }}><IconTrash size={12} /> 删除</button>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
