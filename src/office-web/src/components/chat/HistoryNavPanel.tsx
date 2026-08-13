import { useEffect, useRef, useState } from 'react';
import type { NavItem } from './chatTypes';

// =========================================================================
// HistoryNavPanel —— 对话历史导航面板
// 左侧固定宽度 240px，列出当前对话最近 20 条消息（角色图标 + 前 30 字摘要 + 时间戳）。
// 点击任意条目 → 主区域滚动到对应消息 DOM 并高亮激活项；支持折叠/展开。
// 激活项高亮：
//   - 自动导航（新回复到达时外部传 autoHighlightId）→ 立即高亮最新消息；
//   - 用户向上滚动离开底部 / 点击导航项 → 交还 IntersectionObserver 按阅读位置跟随。
// =========================================================================
export function HistoryNavPanel({
  items,
  collapsed,
  onToggleCollapse,
  scrollRootRef,
  autoHighlightId,
}: {
  items: NavItem[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  scrollRootRef: React.RefObject<HTMLDivElement | null>;
  /** 外部指定要高亮的条目 id（自动滚动到底后高亮最新回复）；存在时优先于 IntersectionObserver。 */
  autoHighlightId?: string | null;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // 外部接管标记：自动导航时置 true，用户滚动离开底部 / 点击导航项后置 false（恢复 observer 跟随）。
  const lockRef = useRef(false);

  // 外部高亮（自动导航/新回复到达时）：立即高亮最新消息，并短暂接管（防止 observer 立即覆盖）。
  useEffect(() => {
    if (autoHighlightId) {
      setActiveId(autoHighlightId);
      lockRef.current = true;
    }
  }, [autoHighlightId]);

  // 用户主动滚动离开底部 → 解除接管，让 IntersectionObserver 按阅读位置跟随。
  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;
    const onScroll = () => {
      if (!lockRef.current) return;
      // 距底部超过 80px 视为「用户往上翻看历史」，不再是自动导航状态
      const nearBottom = root.scrollHeight - root.scrollTop - root.clientHeight < 80;
      if (!nearBottom) lockRef.current = false;
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, [scrollRootRef]);

  // 最近 20 条（倒序展示，最新在顶部，符合导航直觉）
  const recent = items.slice(-20).reverse();

  // 监听主滚动区，用 IntersectionObserver 计算当前可视区内最靠上的消息作为激活项。
  useEffect(() => {
    if (collapsed) return;
    const root = scrollRootRef.current;
    if (!root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        // 自动导航接管期间：不覆盖外部高亮（最新回复）。
        if (lockRef.current) return;
        // 选与 root 相交、且 top 最接近 root 顶部的那条作为激活项
        let best: { id: string; top: number } | null = null;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const id = (e.target as HTMLElement).dataset.msgId;
          if (!id) continue;
          const top = e.boundingClientRect.top;
          if (!best || top < best.top) best = { id, top };
        }
        if (best) setActiveId(best.id);
      },
      { root, threshold: [0, 0.25, 0.5, 1], rootMargin: '0px 0px -70% 0px' },
    );
    // 观察所有带 data-msg-id 的消息 DOM
    const targets = root.querySelectorAll('[data-msg-id]');
    targets.forEach((t) => obs.observe(t));
    return () => obs.disconnect();
  }, [collapsed, items.length, scrollRootRef]);

  // 折叠态：只留一个竖条按钮，点击展开
  if (collapsed) {
    return (
      <div
        onClick={onToggleCollapse}
        title="展开对话历史导航"
        style={{
          width: 18,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          background: 'var(--mc-glass)',
          borderRight: '1px solid var(--mc-hair)',
          color: 'var(--mc-muted)',
          fontSize: 11,
        }}
      >
        ▶
      </div>
    );
  }

  return (
    <div
      style={{
        width: 240,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--mc-glass)',
        borderRight: '1px solid var(--mc-hair)',
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 10px',
          borderBottom: '1px solid var(--mc-hair)',
          gap: 6,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--mc-muted)' }}>对话历史</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={onToggleCollapse}
          title="收起"
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--mc-muted)',
            cursor: 'pointer',
            fontSize: 11,
            padding: '2px 4px',
            borderRadius: 4,
          }}
        >
          ▶
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {recent.length === 0 && (
          <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--mc-muted2)' }}>
            暂无消息
          </div>
        )}
        {recent.map((it) => {
          const isUser = it.role === 'user';
          const summary = it.content.replace(/\s+/g, ' ').trim().slice(0, 30) || (isUser ? '（空消息）' : '…');
          const time = new Date(it.ts);
          const hh = String(time.getHours()).padStart(2, '0');
          const mm = String(time.getMinutes()).padStart(2, '0');
          const active = activeId === it.id;
          return (
            <div
              key={it.id}
              onClick={() => {
                // 主滚动区位于面板右侧的同级容器；通过 data-msg-id 定位消息 DOM
                const root = scrollRootRef.current;
                const host = root?.closest('[data-mc-chatview]') as HTMLElement | null;
                const target = (host || document).querySelector(`[data-msg-id="${it.id}"]`) as HTMLElement | null;
                if (target) {
                  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  setActiveId(it.id);
                }
              }}
              style={{
                display: 'flex',
                gap: 6,
                padding: '6px 10px',
                cursor: 'pointer',
                fontSize: 12,
                lineHeight: 1.45,
                color: active ? 'var(--mc-accent)' : 'var(--mc-text)',
                background: active ? 'var(--mc-accent-soft)' : 'transparent',
                borderLeft: active ? '2px solid var(--mc-accent)' : '2px solid transparent',
                transition: 'background .12s, color .12s',
              }}
              onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--mc-hair)'; }}
              onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#fff',
                  background: isUser ? 'var(--mc-accent)' : '#8e8e93',
                }}
                title={isUser ? '用户' : 'AI'}
              >
                {isUser ? '我' : 'AI'}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {summary}
                </span>
                <span style={{ display: 'block', fontSize: 10, color: 'var(--mc-muted2)', fontVariantNumeric: 'tabular-nums' }}>
                  {hh}:{mm}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
