import { useEffect, useRef, useState } from 'react';
import { previewClient } from '../../preview/PreviewClient';
import type { Artifact } from '../../../../shared/preview-types';
import { LEVELS } from './chatStyles';
import { computeCtx, lcsLineDiff, mergeStep, mergeTraceSpan } from './chatUtils';
import type { ChatPaneProps, ServerCtx } from './chatTypes';

/** useChatPane 返回的完整状态与操作，供 ChatView / FileView / ChatPane 外壳消费。 */
export interface ChatPaneStore {
  // 会话 / 消息
  sid: string | null;
  msgs: { role: string; content: string; tokens?: number; error?: boolean; reasoning?: string; ts?: number | string; model?: string }[];
  ctxData: ServerCtx | null;
  input: string;
  busy: boolean;
  thinkLevel: number;
  searchOn: boolean;
  // 弹层开关
  showThink: boolean;
  showCtx: boolean;
  showModel: boolean;
  showSkills: boolean;
  selectedSkills: string[];
  skillOptions: { name: string; description: string; enabled: number; source: string }[];
  showAttach: boolean;
  attachments: { id: string; name: string; path?: string; content?: string; mode: 'inline' | 'path' }[];
  fileInputRef: React.RefObject<HTMLInputElement>;
  elapsed: number;
  artifacts: Artifact[];
  activeArtifact: string | null;
  wsTab: 'output' | 'workspace' | 'trace';
  activeChangeId: string | null;
  fileChanges: any[];
  // 连接 / 任务
  conn: 'connecting' | 'open' | 'reconnecting';
  stalled: boolean;
  creatingSession: boolean;
  showTrace: boolean;
  trace: any;
  steps: any[];
  todos: { id: string; content: string; status: 'pending' | 'running' | 'done' }[];
  reasoning: string;
  navCollapsed: boolean;
  traceUserClosedRef: React.MutableRefObject<boolean>;
  isFirstOfSessionRef: React.MutableRefObject<boolean>;
  bottomRef: React.RefObject<HTMLDivElement>;
  historyScrollRef: React.RefObject<HTMLDivElement>;
  msgMetaRef: React.MutableRefObject<{ id: string; ts: number }[]>;
  // 派生值
  paneArtifacts: Artifact[];
  paneChanges: any[];
  sessionTitle: string;
  ctx: ReturnType<typeof computeCtx>;
  ctxPct: number;
  ctxColor: string;
  stage: 'thinking' | 'tooling' | 'writing';
  justDone: boolean;
  active: Artifact | null;
  activeChange: any;
  activeDiff: { t: 'ctx' | 'del' | 'add'; s: string }[] | null;
  diffAdds: number;
  diffDels: number;
  fmtClock: (t?: number) => string;
  isHtmlLike: (p: string) => boolean;
  // 操作
  revertFile: (changeId: string) => void;
  sendText: (text: string, forceSid?: string, resend?: boolean) => Promise<void>;
  retryLast: () => void;
  handleActionResult: (r: any) => void;
  handleSend: () => Promise<void>;
  handleStop: () => Promise<void>;
  setLevel: (v: number) => void;
  extractHtml: (text: string) => string | null;
  setView: (v: 'chat' | 'files') => void;
  toggleSearch: () => void;
  toggleThink: () => void;
  toggleCtx: () => void;
  toggleModel: () => void;
  toggleSkills: () => void;
  toggleAttach: () => void;
  handlePickFiles: (e: React.ChangeEvent<HTMLInputElement>) => void;
  // JSX 直接调用的 setter
  setNavCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setActiveArtifact: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveChangeId: React.Dispatch<React.SetStateAction<string | null>>;
  setWsTab: React.Dispatch<React.SetStateAction<'output' | 'workspace' | 'trace'>>;
  setShowTrace: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedSkills: (v: string[] | ((prev: string[]) => string[])) => void;
  setAttachments: (v: any[] | ((prev: any[]) => any[])) => void;
  setInput: (v: string) => void;
  setShowModel: (v: boolean) => void;
  setShowSkills: (v: boolean) => void;
  setShowAttach: (v: boolean) => void;
  // 透传 props（只读）
  focused: boolean;
  view: 'chat' | 'files';
  modelOptions: ChatPaneProps['modelOptions'];
  selectedModel: ChatPaneProps['selectedModel'];
  onSelectModel: ChatPaneProps['onSelectModel'];
  onOpenPreview?: ChatPaneProps['onOpenPreview'];
  onToast?: ChatPaneProps['onToast'];
}

/** ChatPane 全部状态、effects 与操作逻辑（从 ChatPane.tsx 拆出，组件只负责渲染）。 */
export function useChatPane(props: ChatPaneProps): ChatPaneStore {
  const { paneId, focused, view, openReq, initialSearchOn, modelOptions, selectedModel, onSelectModel, onFocus, onViewChange, onPaneSessionKnown, onSessionsMutated, onOpenPreview, onToast, runningSessionIds } = props;

  const [sid, setSid] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<{ role: string; content: string; tokens?: number; error?: boolean; reasoning?: string; ts?: number | string; model?: string }[]>([]);
  // 服务端真实上下文用量（limit=模型 context window，used/sys/hist/tools/files 分项）
  const [ctxData, setCtxData] = useState<ServerCtx | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // 本轮刚结束的短暂窗口（done 后约 1.4s）：让阶段条/完成态优雅收尾，避免 busy 突变为 false 时阶段条 abrupt 消失
  const [justDone, setJustDone] = useState(false);
  const justDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [thinkLevel, setThinkLevel] = useState(() => {
    const saved = localStorage.getItem('thinkLevel');
    return saved !== null ? Math.max(0, Math.min(4, parseInt(saved, 10))) : 2;
  });
  const [thinkTemp, setThinkTemp] = useState(() => LEVELS[thinkLevel].temp);
  const [searchOn, setSearchOn] = useState(initialSearchOn);
  const [showThink, setShowThink] = useState(false);
  const [showCtx, setShowCtx] = useState(false);
  const [showModel, setShowModel] = useState(false);
  // 对话栏「技能选择」：用户手动勾选、本次对话强制注入的技能（不受设置里 enabled 开关限制）
  const [showSkills, setShowSkills] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [skillOptions, setSkillOptions] = useState<{ name: string; description: string; enabled: number; source: string }[]>([]);
  // 对话栏「+」引用的文件（本地文件 / 对话中提到的文件）：inline=前端已读内容；path=后端安全读取
  const [showAttach, setShowAttach] = useState(false);
  const [attachments, setAttachments] = useState<{ id: string; name: string; path?: string; content?: string; mode: 'inline' | 'path' }[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [activeArtifact, setActiveArtifact] = useState<string | null>(null);
  // 文件视图内的子视图切换：产出文件（变更 + 产物统一列表，点击即预览）/ 工作区（文件系统浏览器）。
  const [wsTab, setWsTab] = useState<'output' | 'workspace' | 'trace'>('output');
  // 产出文件视图中选中的工作区文件变更（与 activeArtifact 互斥，点击列表即切换右侧面板）
  const [activeChangeId, setActiveChangeId] = useState<string | null>(null);
  // 文件变更：AI 在工作区读/写/编辑后由网关广播，跨会话订阅（sessionId=*），
  // 驱动「工作区」视图里的变更卡片（diff + 一键撤销）。仅 revertible 的 edit/write 进列表。
  const [fileChanges, setFileChanges] = useState<any[]>([]);
  // 撤销某次文件变更（调用后端 fsRevert 并移除卡片）
  const revertFile = (changeId: string) => {
    fetch('/api/fs/revert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changeId }) })
      .then(r => r.json()).then(d => {
        if (d.ok) { setFileChanges(prev => prev.filter(c => c.changeId !== changeId)); onToast?.('已撤销：' + changeId); }
        else onToast?.('撤销失败：' + (d.error || ''));
      }).catch(e => onToast?.('撤销失败：' + e.message));
  };

  // 拉取全部技能（含未启用的），供对话栏「技能选择」使用——用户可手动勾选任意技能强制注入
  const loadSkillOptions = () => {
    fetch('/api/skills').then(r => r.json()).then(d => {
      if (Array.isArray(d)) {
        setSkillOptions(d.map((s: any) => ({ name: s.name, description: s.description || '', enabled: s.enabled ? 1 : 0, source: s.source || '' })));
      }
    }).catch(() => {});
  };
  useEffect(() => { loadSkillOptions(); }, []);

  // 连接状态与看门狗：SSE 连接断开/长时间无令牌时给出反馈
  const [conn, setConn] = useState<'connecting' | 'open' | 'reconnecting'>('connecting');
  const [stalled, setStalled] = useState(false);
  // 新建会话的「会话创建中」过渡态（点击新对话后短暂展示，对标 WorkBuddy）
  const [creatingSession, setCreatingSession] = useState(false);
  const creatingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTokenRef = useRef<number>(Date.now());
  // 本轮是否收到过 chat-error：防止成功分支的 loadSession 回填把错误提示覆盖掉
  const hadErrorRef = useRef(false);
  // 是否为「新会话首条消息」的生成中（用于把思考态文案显示为「会话创建中…」）
  const isFirstOfSessionRef = useRef(false);

  // 简易 Trace：最近一次请求的调用瀑布（SSE 实时增量推送 / 可历史回看 / 可展开详情）
  const [showTrace, setShowTrace] = useState(false);
  const [trace, setTrace] = useState<any>(null);
  // 工具调用步骤（SSE 实时推送，前端以卡片形式展示「正在调用工具」，配合流式输出）
  const [steps, setSteps] = useState<any[]>([]);
  // 任务规划清单（WorkBuddy 式）：规划阶段 [TODO:...] 步骤清单，随 step 完成逐个打勾
  const [todos, setTodos] = useState<{ id: string; content: string; status: 'pending' | 'running' | 'done' }[]>([]);
  // 思考/推理内容（SSE reasoning 事件实时累积，前端以可折叠「思考过程」块展示）
  const [reasoning, setReasoning] = useState('');
  // 对话历史导航面板的展开/折叠状态（默认折叠，WorkBuddy 风格优先正文宽度；持久化）
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => {
    const saved = localStorage.getItem('mc-nav-collapsed');
    return saved ? saved === '1' : true;
  });
  // 用户若手动关闭过 Trace 面板，则后续请求不再自动弹出（仍可在头部点开）
  const traceUserClosedRef = useRef(false);

  const clientIdRef = useRef<string>('');
  if (!clientIdRef.current) {
    clientIdRef.current = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  }
  const streamKey = sid || clientIdRef.current;
  // 供 previewClient.subscribe 回调读取「当前最新 sid」（回调只注册一次，闭包内 sid 会过期）
  const sidRef = useRef<string | null>(null);
  sidRef.current = sid;

  const bottomRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 对话历史导航面板：指向主消息滚动区，IntersectionObserver 用它作 root
  const historyScrollRef = useRef<HTMLDivElement>(null);

  // 对话历史导航：为每条消息记录稳定 id + 时间戳，驱动左侧导航面板的摘要/时间/跳转。
  // 与 msgs 数组按下标对齐；msgs 变化时只补齐新增项，已有项的 id/timestamp 保持不变。
  const msgMetaRef = useRef<{ id: string; ts: number }[]>([]);
  if (msgMetaRef.current.length !== msgs.length) {
    const next: { id: string; ts: number }[] = [];
    for (let i = 0; i < msgs.length; i++) {
      const prev = msgMetaRef.current[i];
      // 复用既有 meta（保留原 id 与 ts），没有就当场生成
      if (prev) next.push(prev);
      else next.push({
        id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2),
        ts: Date.now(),
      });
    }
    msgMetaRef.current = next;
  }

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  // 同步来自 ChatPage 的搜索开关初值（/api/search-config 异步加载后下发一次）
  useEffect(() => { setSearchOn(initialSearchOn); }, [initialSearchOn]);

  // 计时器：busy 时每秒 +1
  useEffect(() => {
    if (busy) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(p => p + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [busy]);

  // 每条 SSE（按 sessionId 隔离）→ 该 Pane 独立流式接收，杜绝串台
  useEffect(() => {
    const es = new EventSource(`/api/stream?sessionId=${encodeURIComponent(streamKey)}`);
    setConn('connecting');
    es.onopen = () => setConn('open');
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === 'ping') return;
        if (d.type === 'artifact') return; // 预览由 previewClient 处理
        // 文件变更：会话级接收（只收本会话的变更，杜绝跨会话串台）；
        // 仅把可撤销的 edit/write 写入 fileChanges（read 不进列表，仅活动提示）。
        if (d.type === 'file-change' && d.change && d.change.revertible) {
          setFileChanges(prev => {
            if (prev.some(c => c.changeId === d.change.changeId)) return prev;
            // 补 ts 时间戳（SSE 事件本身不带时间）+ sessionId（用于会话隔离展示）
            return [...prev, { ...d.change, sessionId: d.sessionId, ts: Date.now() }];
          });
          return;
        }
        // 简易 Trace：实时流式（start/span 增量边收边画，trace 最终校准）
        if (d.type === 'trace-start') { setTrace(d.trace); if (!traceUserClosedRef.current) setShowTrace(true); return; }
        if (d.type === 'trace-span') { setTrace((prev: any) => mergeTraceSpan(prev, d.phase, d.span)); return; }
        if (d.type === 'trace') { setTrace(d); return; }
        // 工具调用步骤：实时累积（running→done/error），驱动对话流内的「工具调用提示」卡片
        if (d.type === 'step') { setSteps((prev: any[]) => mergeStep(prev, d.step)); return; }
        // 任务规划清单：规划阶段 [TODO:...] 步骤清单，前端实时展示任务清单
        if (d.type === 'todos') {
          setTodos((Array.isArray(d.todos) ? d.todos : []).map((t: any) => ({ id: t.id, content: t.content, status: 'pending' as const })));
          return;
        }
        // 思考/推理内容：实时累积，驱动对话流内的「思考过程」可折叠块。
        // 同时写入当前最后一条 assistant 消息（按消息存储，历史/切换会话后不丢）。
        if (d.type === 'reasoning') {
          const rc = d.content || '';
          setReasoning((prev: string) => prev + rc);
          if (rc) {
            setMsgs((prev) => {
              const c = prev.slice();
              const last = c[c.length - 1];
              if (last && last.role === 'assistant') {
                c[c.length - 1] = { ...last, reasoning: (last.reasoning || '') + rc };
              }
              return c;
            });
          }
          return;
        }
        // 失败事件：在服务端已抛错，这里给出明确反馈而非一直转圈
        if (d.type === 'chat-error') {
          hadErrorRef.current = true;
          setMsgs(prev => {
            const c = prev.slice();
            if (c.length && c[c.length - 1].role === 'assistant') {
              c[c.length - 1] = { ...c[c.length - 1], content: `请求失败：${d.error}`, error: true };
            }
            return c;
          });
          // 兜底：把仍在「进行中」的步骤标记为失败
          setSteps(prev => prev.map((s: any) => s.status === 'running' ? { ...s, status: 'error', error: d.error } : s));
          setBusy(false);
          setConn('open');
          setStalled(false);
          return;
        }
        // token：即使 done 也先拼接内容，避免丢最后一包
        if (d.content) {
          isFirstOfSessionRef.current = false; // 收到首个正文片段，首条创建态结束
          lastTokenRef.current = Date.now();
          setMsgs(prev => {
            const c = prev.slice();
            const last = c[c.length - 1];
            if (last && last.role === 'assistant') c[c.length - 1] = { ...last, content: last.content + d.content };
            return c;
          });
        }
        if (d.done) {
          // 兜底：把仍在「进行中」的步骤标记为完成（防御后端未发终态）
          setSteps(prev => prev.map((s: any) => s.status === 'running' ? { ...s, status: 'done', endedAt: Date.now() } : s));
          // 后端在 done 事件里带回实际生成该回复的模型与 token 数，回填到最后一条 assistant 消息
          if (d.model || d.tokens != null) {
            setMsgs(prev => {
              const c = prev.slice();
              const last = c[c.length - 1];
              if (last && last.role === 'assistant') c[c.length - 1] = { ...last, model: d.model ?? last.model, tokens: d.tokens ?? last.tokens };
              return c;
            });
          }
          setBusy(false); setConn('open'); setStalled(false);
          // 进入「刚结束」短暂窗口：阶段条显示完成态后优雅淡出（避免 abrupt 消失）
          setJustDone(true);
          if (justDoneTimerRef.current) clearTimeout(justDoneTimerRef.current);
          justDoneTimerRef.current = setTimeout(() => setJustDone(false), 1400);
          // 本轮结束：刷新服务端真实上下文用量（新消息已落库，进度条随之更新）
          if (sid) {
            fetch(`/api/sessions/${sid}/context`).then(r => r.json()).then((c: any) => {
              if (c && typeof c.limit === 'number' && c.limit > 0) setCtxData(c);
            }).catch(() => {});
          }
        }
      } catch { /* ignore */ }
    };
    es.onerror = () => { setConn('reconnecting'); }; // EventSource 会自动重连
    return () => { es.close(); if (justDoneTimerRef.current) clearTimeout(justDoneTimerRef.current); };
  }, [streamKey]);

  // 看门狗：生成中若超过 45s 无新令牌，判定连接可能已断开
  useEffect(() => {
    if (!busy) { setStalled(false); return; }
    lastTokenRef.current = Date.now();
    const t = setInterval(() => {
      if (busy && Date.now() - lastTokenRef.current > 45000) setStalled(true);
    }, 5000);
    return () => clearInterval(t);
  }, [busy]);

  // 文件视图：复用 previewClient（SSE 全局订阅 artifact），与 PreviewPage 同源
  useEffect(() => {
    previewClient.start();
    const unsub = previewClient.subscribe((list) => {
      setArtifacts(list);
      // 只自动选中「当前会话」的第一个产物：previewClient 是全应用全局列表，
      // 直接用 list[0] 会把其它会话的产物选进来（双 Pane 串台）。
      setActiveArtifact((prev) => {
        const cur = sidRef.current;
        const pane = cur ? list.filter(a => a.sessionId === cur) : [];
        if (prev && pane.some(a => a.id === prev)) return prev; // 用户已选中且属于本会话则保留
        return pane[0]?.id ?? null;
      });
    });
    return unsub;
  }, []);

  // 切换会话：重置本会话专属的选中项、变更列表与实时流式状态。
  // file-change 由会话级 SSE 按新 sid 重新接收；旧会话的产物/变更不再展示。
  // steps/todos/reasoning/trace 也一并重置——若新会话仍在后台生成，SSE 重连时会
  // 回放服务端缓冲的实时事件（step/todos/reasoning/trace-start）重新驱动 UI 提示。
  useEffect(() => {
    setActiveChangeId(null);
    setFileChanges([]);
    setSteps([]);
    setTodos([]);
    setReasoning('');
    setTrace(null);
    setShowTrace(false);
    // 选中产物收敛到「当前会话」的第一个（与 previewClient.subscribe 的收敛逻辑一致）
    setActiveArtifact((prev) => {
      const cur = sid;
      const pane = cur ? artifacts.filter(a => a.sessionId === cur) : [];
      if (prev && pane.some(a => a.id === prev)) return prev;
      return pane[0]?.id ?? null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid]);

  // 「发给对话」桥：工作区浏览器把文件/片段作为提示推给「当前聚焦」的对话窗格
  useEffect(() => {
    function onSend(ev: Event) {
      const text = (ev as CustomEvent).detail;
      if (!text || !focused) return; // 仅聚焦窗格响应，避免双窗同时发送
      setInput(prev => (prev ? prev + '\n' + text : text));
    }
    window.addEventListener('mc-send', onSend as EventListener);
    return () => window.removeEventListener('mc-send', onSend as EventListener);
  }, [focused]);

  // 响应 ChatPage 下发的「打开/新建」请求（nonce 变化才触发）
  useEffect(() => {
    if (!openReq || openReq.pane !== paneId) return;
    if (openReq.sessionId === null) {
      // 新建：清空本 Pane，并进入「会话创建中」过渡态（短暂展示，对标 WorkBuddy 新会话提示）
      setSid(null); setMsgs([]); setBusy(false); setShowThink(false); setShowCtx(false);
      setCreatingSession(true);
      if (creatingTimerRef.current) clearTimeout(creatingTimerRef.current);
      creatingTimerRef.current = setTimeout(() => setCreatingSession(false), 700);
      onPaneSessionKnown(null);
    } else {
      loadSession(openReq.sessionId);
      onPaneSessionKnown(openReq.sessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openReq]);

  async function loadSession(id: string) {
    // 切回一个「仍在后台生成中」的会话时保持 busy（动画恢复），不要误清为空闲
    const stillRunning = runningSessionIds?.includes(id);
    setSid(id); setBusy(!!stillRunning); setShowThink(false); setShowCtx(false);
    try {
      const d = await (await fetch(`/api/sessions/${id}`)).json();
      // 注意：兜底回填仅「以服务端为准」修正流式可能的丢包；若接口异常/格式不符，
      // 保留前端已流式出的内容，绝不把正在显示的回复清空（否则会出现「回复消失了」）。
      if (d && Array.isArray(d.messages)) {
        // 若该会话仍在后台生成：服务端尚未落库 assistant，回填用户消息即可，
        // 已流出的回复内容由本 Pane 的 SSE（streamKey=sid）后续 token 续上。
        setMsgs(d.messages.map((m: any) => ({ role: m.role, content: m.content, tokens: m.tokens, reasoning: m.reasoning || '', ts: m.ts, model: m.model })));
      }
    } catch { /* 保留已流式内容，网络抖动时不要把回复清空 */ }
    // 拉取服务端真实上下文用量（模型 context window + 分项估算），驱动进度条
    try {
      const c = await (await fetch(`/api/sessions/${id}/context`)).json();
      if (c && typeof c.limit === 'number' && c.limit > 0) setCtxData(c);
    } catch { /* 接口失败保留旧值/本地兜底 */ }
    // 会话实时状态快照恢复（架构独立性）：步骤/任务清单/思考/Trace 由服务端独立持有，
    // 切回会话时拉取重建——不再依赖脆弱的 SSE 事件流回放（缓冲 TTL 清空也不受影响）。
    try {
      const st = await (await fetch(`/api/sessions/${id}/live`)).json();
      if (st && Array.isArray(st.steps)) {
        setSteps(st.steps);
        setTodos(Array.isArray(st.todos) ? st.todos : []);
        setReasoning(typeof st.reasoning === 'string' ? st.reasoning : '');
        // Trace：基线 payload（trace） + 增量子 span（traceSpans）合并重建
        let t: any = st.trace || null;
        if (Array.isArray(st.traceSpans)) {
          for (const span of st.traceSpans) t = mergeTraceSpan(t, '', span);
        }
        if (t) {
          setTrace(t);
          if (!traceUserClosedRef.current) setShowTrace(true);
        }
      }
    } catch { /* 快照接口失败时保留当前状态，不阻塞加载 */ }
  }

  // 发送一条消息。resend=true 时复用既有用户消息（重试失败回复），不再新增气泡。
  async function sendText(text: string, forceSid?: string, resend = false) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setStalled(false);
    hadErrorRef.current = false;
    if (!resend) {
      setInput('');
      setMsgs(prev => [...prev, { role: 'user', content: trimmed }, { role: 'assistant', content: '', reasoning: '', ts: Date.now(), model: '' }]);
    } else {
      setMsgs(prev => [...prev, { role: 'assistant', content: '', reasoning: '', ts: Date.now(), model: '' }]);
    }
    setBusy(true);
    setJustDone(false);
    setSteps([]);
    setReasoning('');
    // 新会话：客户端先生成 sessionId 并写入本地 sid，使本 Pane 的 SSE（按 sessionId
    // 隔离广播）与服务端实际使用的 sessionId 一致——后端还会缓冲本轮令牌，连上即回放，
    // 双保险避免首条流式回复串台/丢包、`done` 收不到导致 busy 永不复位。
    const targetSid = forceSid || sid || (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2));
    if (!sid) { setSid(targetSid); isFirstOfSessionRef.current = true; } // 首条消息即会话创建中
    try {
      const data = await (await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: trimmed, sessionId: targetSid, temperature: thinkTemp, resend,
          ...(selectedModel ? { providerId: selectedModel.providerId, model: selectedModel.model } : {}),
          ...(selectedSkills.length ? { skillNames: [...selectedSkills] } : {}),
          ...(attachments.length ? { attachments: attachments.map(a => ({ name: a.name, path: a.path, content: a.content, mode: a.mode })) } : {}),
        }),
      })).json();
      // 首条消息由服务端创建会话 → 回写 sessionId 并刷新侧边栏
      if (data.sessionId && data.sessionId !== sid) {
        setSid(data.sessionId);
        onPaneSessionKnown(data.sessionId);
        onSessionsMutated();
      }
      if (data.error && !hadErrorRef.current) {
        // SSE 已通过 chat-error 事件处理过则跳过，避免重复错误气泡 + 重复 toast
        setMsgs(prev => { const c = prev.slice(); if (c.length) c[c.length - 1] = { ...c[c.length - 1], content: `请求失败：${data.error}`, error: true }; return c; });
        setBusy(false);
        onToast?.('回复失败：' + data.error);
      } else if (data.error && hadErrorRef.current) {
        // SSE 已展示错误，这里仅兜底清 busy（chat-error 处理器已清，双保险）
        setBusy(false);
      } else {
        // 兜底回填：以服务端存储的最终内容为准，确保流式丢包时不丢字
        await loadSession(targetSid);
      }
    } catch (err: any) {
      setMsgs(prev => { const c = prev.slice(); if (c.length) c[c.length - 1] = { ...c[c.length - 1], content: `请求失败：${err.message}`, error: true }; return c; });
      setBusy(false);
      onToast?.('连接异常：' + err.message);
    }
  }

  // 重试最后一条失败回复（复用既有用户消息，标记 resend 避免重复入库）
  function retryLast() {
    const lastUser = [...msgs].reverse().find(m => m.role === 'user');
    if (!lastUser) return;
    setMsgs(prev => {
      const c = prev.slice();
      while (c.length && c[c.length - 1].role === 'assistant' && c[c.length - 1].error) c.pop();
      return c;
    });
    sendText(lastUser.content, sid || undefined, true);
  }

  // 复制/分享结果 → toast
  function handleActionResult(r: any) {
    if (r === 'copied') onToast?.('已复制到剪贴板');
    else if (r === 'shared') onToast?.('已分享');
    else if (r === 'failed') onToast?.('复制失败，请手动选择文本');
  }

  async function handleSend() {
    await sendText(input);
  }

  async function handleStop() {
    if (!sid) return;
    setStalled(false);
    try {
      await fetch('/api/chat/abort', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sid }) });
    } catch { /* ignore */ }
    // 若末条 assistant 仍为空（尚未产出内容），明确标记「已停止」，避免空白气泡无提示
    setMsgs(prev => {
      const c = prev.slice();
      const last = c[c.length - 1];
      if (last && last.role === 'assistant' && !last.content && !last.error) {
        c[c.length - 1] = { ...last, content: '（已停止生成）' };
      }
      return c;
    });
    setBusy(false);
  }

  function setLevel(v: number) {
    const l = Math.max(0, Math.min(4, Math.round(v)));
    setThinkLevel(l);
    setThinkTemp(LEVELS[l].temp);
    localStorage.setItem('thinkLevel', String(l));
  }

  function extractHtml(text: string): string | null {
    const m = text.match(/```html\s*\n?([\s\S]*?)```/);
    return m ? m[1] : null;
  }

  // 会话隔离：previewClient 的产物是全应用全局列表，这里只取「当前会话」的产物与变更
  // （每个对话独立，文件提及只属于本对话，避免双 Pane 串台）。附件面板与文件视图共用。
  const paneArtifacts = sid ? artifacts.filter(a => a.sessionId === sid) : [];
  const paneChanges = sid ? fileChanges.filter(c => c.sessionId === sid) : [];

  const sessionTitle = (() => {
    if (view === 'files') return '文件预览';
    const s = props.sessions.find(x => x.id === sid);
    return s ? s.title : '未选择对话';
  })();

  const ctx = computeCtx(msgs, ctxData);
  const ctxPct = Math.min(100, Math.round(ctx.used / ctx.limit * 100));
  const ctxColor = ctxPct > 90 ? 'var(--mc-danger)' : ctxPct > 70 ? 'var(--mc-pin)' : 'var(--mc-accent)';

  // ── 视图切换（对话 / 文件）──
  function setView(v: 'chat' | 'files') { onViewChange(v); setShowThink(false); setShowCtx(false); }

  // ── 工具栏：联网搜索 / 思考强度 / 上下文用量 ──
  function toggleSearch() {
    const next = !searchOn;
    setSearchOn(next);
    fetch('/api/search-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: next, provider: 'duckduckgo' }) }).catch(() => {});
  }
  function toggleThink() {
    const open = !showThink;
    setShowThink(open); setShowCtx(false); setShowAttach(false);
  }
  function toggleCtx() {
    const open = !showCtx;
    setShowCtx(open); setShowThink(false); setShowAttach(false);
  }
  function toggleModel() {
    const open = !showModel;
    setShowModel(open); setShowThink(false); setShowCtx(false); setShowAttach(false);
  }
  function toggleSkills() {
    const open = !showSkills;
    setShowSkills(open); setShowModel(false); setShowThink(false); setShowCtx(false); setShowAttach(false);
  }
  function toggleAttach() {
    const open = !showAttach;
    setShowAttach(open); setShowModel(false); setShowSkills(false); setShowThink(false); setShowCtx(false);
  }

  // 用户从「+」本地文件选择框选中的文件：小文本内联（前端读内容）；其余（大文件/PDF/Word/图片等）
  // 上传到服务端暂存目录（POST /api/files/upload），返回的路径作为 path 附件，后端安全读取/提取文本。
  const INLINE_LIMIT = 60 * 1024; // 60KB 以下小文本内联（无需网络往返）
  const TEXT_EXT = ['txt', 'md', 'markdown', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'hpp', 'cs', 'css', 'scss', 'less', 'html', 'htm', 'xml', 'yml', 'yaml', 'toml', 'ini', 'conf', 'sh', 'bash', 'bat', 'ps1', 'log', 'csv', 'sql', 'tex', 'vue', 'svelte', 'php', 'rb', 'swift', 'kt', 'dart', 'r', 'pl'];
  const isTextLike = (name: string) => TEXT_EXT.includes((name.split('.').pop() || '').toLowerCase());
  // 上传单个文件到服务端暂存目录,返回服务端路径;失败返回 null
  const uploadToServer = async (f: File): Promise<string | null> => {
    try {
      const res = await fetch('/api/files/upload?name=' + encodeURIComponent(f.name), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: f,
      });
      const data = await res.json();
      if (res.ok && data.path) return data.path;
      onToast?.('上传「' + f.name + '」失败：' + (data.error || 'HTTP ' + res.status));
      return null;
    } catch {
      onToast?.('上传「' + f.name + '」失败（网络错误）');
      return null;
    }
  };
  const handlePickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (fileInputRef.current) fileInputRef.current.value = '';
    for (const f of files) {
      const small = f.size <= INLINE_LIMIT;
      if (small && isTextLike(f.name)) {
        const reader = new FileReader();
        reader.onload = () => {
          setAttachments(prev => [...prev, { id: 'att-' + Math.random().toString(36).slice(2), name: f.name, content: String(reader.result || ''), mode: 'inline' }]);
        };
        reader.readAsText(f);
        continue;
      }
      // 大文件 / 二进制 / 非文本：上传到服务端暂存,以 path 附件引用（服务端注入时安全读取 + 提取文本）
      const p = await uploadToServer(f);
      if (p) setAttachments(prev => [...prev, { id: 'att-' + Math.random().toString(36).slice(2), name: f.name, path: p, mode: 'path' }]);
    }
  };

  // ── Chat 视图派生值 ──
  const lastMsg = msgs[msgs.length - 1];
  const lastIsAssistant = lastMsg?.role === 'assistant';
  const hasContent = !!lastIsAssistant && (lastMsg.content?.length || 0) > 0;
  const stage: 'thinking' | 'tooling' | 'writing' = !hasContent ? (steps.length > 0 ? 'tooling' : 'thinking') : 'writing';

  // ── 文件视图派生值 ──
  const active = paneArtifacts.find(a => a.id === activeArtifact) || null;
  const activeChange = paneChanges.find(c => c.changeId === activeChangeId) || null;
  const activeDiff = activeChange ? lcsLineDiff(activeChange.old || '', activeChange.new || '') : null;
  const diffAdds = activeDiff?.filter(d => d.t === 'add').length ?? 0;
  const diffDels = activeDiff?.filter(d => d.t === 'del').length ?? 0;
  // 变更 / 产物列表项的时间展示（毫秒时间戳 → HH:MM）
  const fmtClock = (t?: number) => { if (!t) return ''; const d = new Date(t); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}`; };
  // 路径是否为可预览的网页文件（HTML / Markdown），用于变更的「实时预览」入口
  const isHtmlLike = (p: string) => /\.(html?|htm|md|markdown)$/i.test(p || '');

  return {
    // 会话 / 消息
    sid, msgs, ctxData, input, busy, thinkLevel, searchOn,
    // 弹层开关
    showThink, showCtx, showModel, showSkills, selectedSkills, skillOptions,
    showAttach, attachments, fileInputRef, elapsed, artifacts, activeArtifact,
    wsTab, activeChangeId, fileChanges,
    // 连接 / 任务
    conn, stalled, creatingSession, showTrace, trace, steps, todos, reasoning, justDone,
    navCollapsed, traceUserClosedRef, isFirstOfSessionRef, bottomRef, historyScrollRef, msgMetaRef,
    // 派生值
    paneArtifacts, paneChanges, sessionTitle, ctx, ctxPct, ctxColor, stage,
    active, activeChange, activeDiff, diffAdds, diffDels, fmtClock, isHtmlLike,
    // 操作
    revertFile, sendText, retryLast, handleActionResult, handleSend, handleStop,
    setLevel, extractHtml, setView, toggleSearch, toggleThink, toggleCtx,
    toggleModel, toggleSkills, toggleAttach, handlePickFiles,
    // JSX 直接调用的 setter
    setNavCollapsed, setActiveArtifact, setActiveChangeId, setWsTab, setShowTrace,
    setSelectedSkills, setAttachments, setInput, setShowModel, setShowSkills, setShowAttach,
    // 透传 props（只读）
    focused, view, modelOptions, selectedModel, onSelectModel, onOpenPreview, onToast,
  };
}
