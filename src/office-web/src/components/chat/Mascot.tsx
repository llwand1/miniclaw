import { useEffect, useRef, useState } from 'react';

/** 吉祥物状态：交互态（hover/click 优先）+ 随机生活态 */
type MascotState = 'idle' | 'hover' | 'click' | 'sleep' | 'wonder' | 'wave' | 'think' | 'laugh';

/** 随机生活态池（idle 时随机切入，几秒后回 idle） */
const LIVELY: MascotState[] = ['sleep', 'wonder', 'wave', 'think', 'laugh'];
/** 随机气泡文案池（对应各状态，全部学习主题，随机弹出一条） */
const BUBBLES: Record<MascotState, string[]> = {
  idle: ['背单词吗？', '复习一下！', '打卡打卡～', '刷题走起！', '今天也要加油哦'],
  sleep: ['Zzz… 再背一组就睡', '看书看困了…', '呼噜～ 待会儿复习'],
  wonder: ['咦？这道题不会', '这个知识点没见过！', '咦？公式是什么来着'],
  wave: ['来学习呀！', '一起刷题吗？', '今天背单词了没？'],
  think: ['这道题怎么解…', '回忆一下知识点…', '想想上次错在哪…'],
  laugh: ['哈哈哈！这题我懂', '笑死，笔记写岔了', '哈哈哈 背下来了！'],
  click: ['耶！又记一个知识点', '戳我？一起学习吧！', '打卡成功！', '复习走起～'],
  hover: ['要一起学习吗？', '今天复习了吗？', '来看道题吗？'],
};

/**
 * Mascot —— WorkBuddy 式书精灵吉祥物（欢迎页主视觉，可互动）。
 * 书本身体 + 大眼睛 + 腮红 + 小手小脚 + 头顶嫩芽，质感带高光描边与地面阴影：
 *  - 待机 idle：呼吸浮动 + 眨眼 + 嫩芽摆动
 *  - hover：睁眼前倾；click：弹跳 + 开心表情 + 星星粒子
 *  - 随机生活态：打瞌睡(Zzz) / 好奇(问号歪头) / 招手 / 思考(省略号) / 大笑
 *  - 随机气泡：随机文案从头顶弹入弹出（mcBubbleIn 动画）
 * 交互态（hover/click）优先于随机生活态；所有状态均带 CSS 动画。
 * interactive=false：纯装饰模式（消息流头像用）——仅待机动画，不弹气泡、不响应交互。
 */
export function Mascot({ size = 92, interactive = true }: { size?: number; interactive?: boolean }) {
  const [state, setState] = useState<MascotState>('idle');
  const [burstKey, setBurstKey] = useState(0);
  const [bubble, setBubble] = useState<{ text: string; key: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const livelyRef = useRef(false); // 是否正处于随机生活态（避免重复调度）

  const enterLively = () => {
    if (livelyRef.current) return;
    livelyRef.current = true;
    const pick = LIVELY[Math.floor(Math.random() * LIVELY.length)];
    setState(pick);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setState(s => (s === pick ? 'idle' : s));
      livelyRef.current = false;
    }, 2800 + Math.random() * 1800);
  };

  // 随机生活态调度：idle 时每 5-9s 随机进入一个生活态（仅交互模式）
  useEffect(() => {
    if (!interactive) return;
    const t = setInterval(() => {
      setState(cur => {
        if (cur === 'idle' && !livelyRef.current) {
          enterLively();
          return cur; // 状态由 enterLively 设置
        }
        return cur;
      });
    }, 5000 + Math.random() * 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive]);

  // 随机气泡：每 6-11s 弹一条（文案与当前状态匹配，仅交互模式）
  useEffect(() => {
    if (!interactive) return;
    const t = setInterval(() => {
      setState(cur => {
        const pool = BUBBLES[cur] || BUBBLES.idle;
        const text = pool[Math.floor(Math.random() * pool.length)];
        setBubble({ text, key: Date.now() });
        return cur;
      });
    }, 6000 + Math.random() * 5000);
    return () => clearInterval(t);
  }, [interactive]);

  const handleClick = () => {
    if (!interactive || state === 'click') return;
    if (timerRef.current) clearTimeout(timerRef.current);
    livelyRef.current = false;
    setState('click');
    setBurstKey(k => k + 1);
    setBubble({ text: BUBBLES.click[Math.floor(Math.random() * BUBBLES.click.length)], key: Date.now() });
    timerRef.current = setTimeout(() => setState(s => (s === 'click' ? 'hover' : s)), 650);
  };

  const happy = state === 'click' || state === 'laugh';
  const sleeping = state === 'sleep';
  const thinking = state === 'think';
  const wondering = state === 'wonder';

  const clsMap: Record<MascotState, string> = {
    idle: 'mc-mascot-idle', hover: 'mc-mascot-hover', click: 'mc-mascot-click',
    sleep: 'mc-mascot-sleep', wonder: 'mc-mascot-wonder', wave: 'mc-mascot-wave',
    think: 'mc-mascot-think', laugh: 'mc-mascot-laugh',
  };

  // 星星粒子：点击时 8 向爆发
  const particles = Array.from({ length: 8 }).map((_, i) => {
    const angle = (i / 8) * Math.PI * 2;
    const dist = 58 + (i % 3) * 14;
    return {
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist - 18,
      delay: (i % 4) * 40,
      c: ['#00B96B', '#1677FF', '#FFE08A', '#7DF3C0'][i % 4],
      s: 7 + (i % 3) * 3,
    };
  });

  // 眼睛渲染：sleep=闭线、wonder=大圆、happy=^ ^、think=半闭、默认=圆眼
  const eyeL = sleeping ? (
    <path d="M40 53 Q 46 57 52 53" stroke="#1d1d1f" strokeWidth="3.4" strokeLinecap="round" fill="none" />
  ) : happy ? (
    <path d="M40 52 Q 46 44 52 52" stroke="#1d1d1f" strokeWidth="3.4" strokeLinecap="round" fill="none" />
  ) : (
    <>
      <ellipse cx="46" cy="52" rx={wondering ? 8 : 6.5} ry={wondering ? 9 : 8} fill="#fff" />
      <circle cx="47" cy="53" r={wondering ? 4 : 3.4} fill="#1d1d1f" />
      <circle cx="48.5" cy="50.8" r="1.2" fill="#fff" />
    </>
  );
  const eyeR = sleeping ? (
    <path d="M68 53 Q 74 57 80 53" stroke="#1d1d1f" strokeWidth="3.4" strokeLinecap="round" fill="none" />
  ) : happy ? (
    <path d="M68 52 Q 74 44 80 52" stroke="#1d1d1f" strokeWidth="3.4" strokeLinecap="round" fill="none" />
  ) : (
    <>
      <ellipse cx="74" cy="52" rx={wondering ? 8 : 6.5} ry={wondering ? 9 : 8} fill="#fff" />
      <circle cx="75" cy="53" r={wondering ? 4 : 3.4} fill="#1d1d1f" />
      <circle cx="76.5" cy="50.8" r="1.2" fill="#fff" />
    </>
  );

  // 嘴：happy 大笑张嘴、think 抿嘴、默认微笑
  const mouth = happy ? (
    <path d="M52 60 Q 60 74 68 60 Q 60 66 52 60" fill="#fff" stroke="#1d1d1f" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  ) : thinking ? (
    <path d="M57 63 Q 60 60 63 63" stroke="#1d1d1f" strokeWidth="2.6" strokeLinecap="round" />
  ) : (
    <path d="M56 62 Q 60 67 64 62" stroke="#1d1d1f" strokeWidth="3" strokeLinecap="round" />
  );

  return (
    <div
      style={{ position: 'relative', width: size, height: size, margin: interactive ? '0 auto' : 0 }}
      onClick={interactive ? handleClick : undefined}
      onMouseEnter={interactive ? () => { if (state !== 'click') { if (timerRef.current) clearTimeout(timerRef.current); livelyRef.current = false; setState('hover'); } } : undefined}
      onMouseLeave={interactive ? () => { if (state !== 'click') setState('idle'); } : undefined}
      title={interactive ? '点我互动' : undefined}
      role={interactive ? 'button' : undefined}
      aria-label="书精灵吉祥物"
    >
      {/* 地面阴影（仅交互模式，消息头像场景不需要） */}
      {interactive && <span className="mc-mascot-shadow" />}

      {/* 随机文字气泡（仅交互模式） */}
      {interactive && bubble && (
        <div key={bubble.key} className="mc-bubble">{bubble.text}</div>
      )}

      {/* 点击粒子爆发层（仅交互模式） */}
      {interactive && state === 'click' && (
        <div key={burstKey} className="mc-mascot-burst" aria-hidden="true">
          {particles.map((p, i) => (
            <span key={i} className="mc-burst-p" style={{ '--dx': `${p.dx}px`, '--dy': `${p.dy}px`, animationDelay: `${p.delay}ms`, background: p.c, width: p.s, height: p.s } as React.CSSProperties} />
          ))}
        </div>
      )}

      <div className={`mc-mascot ${clsMap[state]}`}>
        <svg viewBox="0 0 120 120" width={size} height={size} fill="none">
          {/* ── 头顶嫩芽（wonder 时加问号，sleep 时加 Zzz）── */}
          <g className="mc-mascot-sprout">
            <path d="M60 18 C 60 10, 52 8, 46 12" stroke="#00A85F" strokeWidth="3" strokeLinecap="round" />
            <path d="M60 18 C 60 9, 68 7, 74 11" stroke="#00A85F" strokeWidth="3" strokeLinecap="round" />
            <ellipse cx="45" cy="9" rx="5" ry="4" fill="#7DF3C0" />
            <ellipse cx="75" cy="8" rx="5" ry="4" fill="#7DF3C0" />
          </g>

          {/* 状态小元素：Zzz / 问号 / 省略号 */}
          {sleeping && (
            <g className="mc-think-dots" fill="#00A85F" style={{ opacity: .85 }}>
              <text x="84" y="18" fontSize="13" fontWeight="800" fill="#00A85F">Z</text>
              <text x="92" y="12" fontSize="10" fontWeight="800" fill="#1677FF">z</text>
              <text x="98" y="7" fontSize="8" fontWeight="800" fill="#1677FF">z</text>
            </g>
          )}
          {wondering && (
            <g>
              <circle cx="86" cy="22" r="10" fill="#fff" stroke="#1677FF" strokeWidth="2" />
              <path d="M86 19 V 26" stroke="#1677FF" strokeWidth="2.4" strokeLinecap="round" />
              <circle cx="86" cy="30" r="1.3" fill="#1677FF" />
            </g>
          )}
          {thinking && (
            <g className="mc-think-dots">
              <circle cx="84" cy="22" r="3" fill="#1677FF" />
              <circle cx="92" cy="18" r="3" fill="#1677FF" />
              <circle cx="100" cy="22" r="3" fill="#1677FF" />
            </g>
          )}

          {/* ── 身体：对开的书（高光描边由 CSS 提供）── */}
          <g className="mc-mascot-body">
            <defs>
              <linearGradient id="mcBookBody" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#00B96B" />
                <stop offset="100%" stopColor="#1677FF" />
              </linearGradient>
            </defs>
            <path d="M60 32 Q 44 30 30 34 L 30 92 Q 44 88 60 90 Z" fill="url(#mcBookBody)" opacity=".9" />
            <path d="M60 32 Q 76 30 90 34 L 90 92 Q 76 88 60 90 Z" fill="url(#mcBookBody)" />
            <path d="M60 32 V 90" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" opacity=".8" />
            <g stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity=".5">
              <path d="M38 44 Q 49 42 56 44" />
              <path d="M38 54 Q 49 52 56 54" />
              <path d="M38 64 Q 49 62 56 64" />
              <path d="M64 44 Q 71 42 82 44" />
              <path d="M64 54 Q 71 52 82 54" />
              <path d="M64 64 Q 71 62 82 64" />
            </g>
          </g>

          {/* ── 脸：眼睛 / 嘴 / 腮红（状态驱动表情）── */}
          <g className="mc-mascot-face">
            <g className="mc-mascot-eye">{eyeL}</g>
            <g className="mc-mascot-eye">{eyeR}</g>
            {mouth}
            <ellipse cx="38" cy="60" rx="4.5" ry="3" fill="#FF9EB5" opacity=".75" />
            <ellipse cx="82" cy="60" rx="4.5" ry="3" fill="#FF9EB5" opacity=".75" />
          </g>

          {/* ── 小手小脚（wave 时右手抬起摆动）── */}
          <g className="mc-mascot-limbs">
            <circle cx="24" cy="76" r="6" fill="#00A85F" />
            {state === 'wave' ? (
              <circle className="mc-arm-r" cx="96" cy="66" r="6" fill="#00A85F" />
            ) : (
              <circle cx="96" cy="76" r="6" fill="#00A85F" />
            )}
            <ellipse cx="46" cy="96" rx="7" ry="4" fill="#00A85F" />
            <ellipse cx="74" cy="96" rx="7" ry="4" fill="#00A85F" />
          </g>
        </svg>
      </div>
    </div>
  );
}
