import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { NavItem, SessionNode } from './chatTypes';

/** 在会话树中定位从根到目标会话的路径（含目标自身）；找不到返回 null。 */
function findPathTo(nodes: SessionNode[], sid: string): SessionNode[] | null {
  for (const n of nodes) {
    if (n.id === sid) return [n];
    const sub = findPathTo(n.children, sid);
    if (sub) return [n, ...sub];
  }
  return null;
}

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
  sessionTree,
  currentSessionId,
  onOpenSession,
}: {
  items: NavItem[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  scrollRootRef: React.RefObject<HTMLDivElement | null>;
  /** 外部指定要高亮的条目 id（自动滚动到底后高亮最新回复）；存在时优先于 IntersectionObserver。 */
  autoHighlightId?: string | null;
  /** 会话树（/api/sessions/tree）：用于渲染「主对话 + 子对话」分支导航 */
  sessionTree?: SessionNode[];
  /** 当前会话 id：分支树中高亮它 */
  currentSessionId?: string | null;
  /** 点击分支节点 → 切换到对应会话（fork 子对话跳转用） */
  onOpenSession?: (sid: string) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // 子对话收起状态：true 时「对话分支」只显示主对话主干，隐藏 fork 出的子对话分支（默认展开）
  const [subCollapsed, setSubCollapsed] = useState(false);
  // 外部接管标记：自动导航时置 true，用户滚动离开底部 / 点击导航项后置 false（恢复 observer 跟随）。
  const lockRef = useRef(false);

  // 从会话树中定位当前会话所在的根分支（根 = 主对话，其后代 = 子对话分支）
  const branchPath = useMemo(() => {
    if (!sessionTree || !currentSessionId) return null;
    return findPathTo(sessionTree, currentSessionId);
  }, [sessionTree, currentSessionId]);
  const branchRoot = branchPath ? branchPath[0] : null;

  // ── 主/子对话分支树：Git 分支图式渲染（参照 gitk / GitKraken）。
  // 主对话 = 最左侧一条竖直主干线；子对话从主干分叉向右展开，每个会话是一个圆点。
  const ROW_H = 28;    // 行高
  const LANE_W = 18;   // 分支线横向间距
  const DOT = 10;      // 圆点直径
  const laneX = (lane: number) => 14 + lane * LANE_W;       // 该 lane 圆点中心 x
  const rowY = (row: number) => 4 + row * ROW_H + ROW_H / 2; // 该行圆点中心 y
  const TRUNK_C = 'rgba(0,185,107,.6)';   // 主干线（accent 系）
  const BRANCH_C = 'rgba(120,128,148,.55)'; // 分支线

  // 布局：DFS 前序分配行号；每个子对话分配独立 lane（永远在父的右侧，形成向右分叉）
  type LayoutNode = { node: SessionNode; lane: number; row: number; parent: LayoutNode | null };
  const layout: LayoutNode[] = [];
  let nextLane = 1;
  const buildLayout = (n: SessionNode, lane: number, parent: LayoutNode | null): void => {
    const self: LayoutNode = { node: n, lane, row: layout.length, parent };
    layout.push(self);
    for (const c of n.children || []) buildLayout(c, nextLane++, self);
  };
  if (branchRoot) buildLayout(branchRoot, 0, null);
  // 收起子对话：仅保留 lane 0（主对话主干），隐藏 fork 出的子对话分支圆点/连线
  const visibleLayout = subCollapsed ? layout.filter((N) => N.lane === 0) : layout;
  const treeH = visibleLayout.length * ROW_H + 8;

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
        className="mc-float"
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
          className="mc-float"
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--mc-muted)',
            cursor: 'pointer',
            fontSize: 11,
            padding: '2px 4px',
            borderRadius: 4,
            transition: 'background .15s, color .15s, transform .16s cubic-bezier(.2,.7,.3,1)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--mc-hair)'; e.currentTarget.style.color = 'var(--mc-accent)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--mc-muted)'; }}
        >
          ▶
        </button>
      </div>
      {/* 主/子对话分支树：Git 分支图式（主对话=最左侧竖直主干线，子对话=向右分叉的圆点分支） */}
      {branchRoot && layout.length > 0 && (
        <div style={{ borderBottom: '1px solid var(--mc-hair)', padding: '6px 0 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '4px 10px 6px', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--mc-muted)' }}>对话分支</span>
            <span style={{ flex: 1 }} />
            {layout.some((N) => N.lane > 0) && (
              <button
                onClick={() => setSubCollapsed((c) => !c)}
                title={subCollapsed ? '展开子对话分支' : '收起子对话分支'}
                style={{
                  border: 'none', background: 'transparent', color: 'var(--mc-muted)',
                  cursor: 'pointer', fontSize: 10, padding: '1px 4px', borderRadius: 4,
                }}
              >
                {subCollapsed ? '展开' : '收起'}
              </button>
            )}
          </div>
          <div style={{ position: 'relative', height: treeH, maxHeight: 170, overflowY: 'auto' }}>
            {/* 主干线：主对话（根）所在 lane0 的竖直主干，从主对话圆点向下贯穿 */}
            <div style={{ position: 'absolute', left: laneX(0) - 1, top: rowY(0), height: treeH - rowY(0), width: 2, background: TRUNK_C }} />
            {/* 分支线：水平分叉（父圆点行高度）+ 竖直分支（父行 → 子圆点） */}
            {visibleLayout.slice(1).map((N) => {
              const p = N.parent!;
              const forkY = rowY(p.row);
              const lx = laneX(N.lane);
              return (
                <Fragment key={N.node.id + '-lines'}>
                  <div style={{ position: 'absolute', left: laneX(p.lane) + DOT / 2, top: forkY - 1, width: lx - laneX(p.lane) - DOT / 2, height: 2, background: BRANCH_C }} />
                  <div style={{ position: 'absolute', left: lx - 1, top: forkY, height: rowY(N.row) - forkY - DOT / 2, width: 2, background: BRANCH_C }} />
                </Fragment>
              );
            })}
            {/* 节点圆点：主对话=accent 大圆点，子对话=灰色小圆点，当前会话加外圈高亮 */}
            {visibleLayout.map((N) => {
              const isRoot = N.lane === 0;
              const isCurrent = N.node.id === currentSessionId;
              const size = isRoot ? DOT + 4 : DOT;
              const lx = laneX(N.lane);
              return (
                <div
                  key={N.node.id}
                  onClick={() => { if (!isCurrent && onOpenSession) onOpenSession(N.node.id); }}
                  title={`${isRoot ? '主对话' : '子对话'}${isCurrent ? '（当前）' : ''}：${N.node.title || '新对话'}`}
                  style={{ position: 'absolute', left: lx - size / 2, top: rowY(N.row) - size / 2, width: size, height: size, borderRadius: '50%', background: isRoot || isCurrent ? 'var(--mc-accent)' : '#8e8e93', boxShadow: isCurrent ? '0 0 0 3px var(--mc-accent-soft), 0 0 0 3.5px var(--mc-accent)' : 'none', cursor: isCurrent ? 'default' : 'pointer', zIndex: 2 }}
                />
              );
            })}
            {/* 节点标题 */}
            {visibleLayout.map((N) => {
              const isRoot = N.lane === 0;
              const isCurrent = N.node.id === currentSessionId;
              const lx = laneX(N.lane);
              return (
                <div
                  key={N.node.id + '-label'}
                  onClick={() => { if (!isCurrent && onOpenSession) onOpenSession(N.node.id); }}
                  title={`${isRoot ? '主对话' : '子对话'}${isCurrent ? '（当前）' : ''}：${N.node.title || '新对话'}`}
                  style={{ position: 'absolute', left: lx + 9, top: rowY(N.row) - 7, maxWidth: 232 - lx, display: 'block', fontSize: 11.5, lineHeight: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: isCurrent ? 'var(--mc-accent)' : 'var(--mc-text)', fontWeight: isCurrent ? 600 : 400, cursor: isCurrent ? 'default' : 'pointer', zIndex: 2 }}
                >
                  {N.node.title || '新对话'}
                  {isCurrent && <span style={{ color: 'var(--mc-muted2)', fontSize: 9.5, marginLeft: 4 }}>当前</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
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
