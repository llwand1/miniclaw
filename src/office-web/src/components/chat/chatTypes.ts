import { CSSProperties } from 'react';

/** 会话行（侧边栏列表） */
export interface Session {
  id: string;
  title: string;
  pinned: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** 打开/新建窗格的请求（pane A/B + sessionId + nonce） */
export interface OpenReq {
  pane: 'A' | 'B';
  sessionId: string | null;
  nonce: number;
}

/** 服务商模型选项（模型切换下拉） */
export interface ModelOption {
  providerId: string;
  providerName: string;
  type: string;
  defaultModel: string;
  models: string[];
}

/** 当前选中的 provider + model */
export interface SelectedModel {
  providerId: string;
  model: string;
}

/** 服务端权威上下文用量（limit=模型 context window，used/sys/hist/tools/files 分项） */
export interface ServerCtx {
  limit: number;
  used: number;
  sys: number;
  hist: number;
  tools: number;
  files: number;
  model?: string;
}

/** 对话历史导航面板条目 */
export interface NavItem {
  id: string;
  role: string;
  content: string;
  ts: number;
}

/** 单条消息（前端流式累积 + 服务端回填） */
export interface ChatMessage {
  role: string;
  content: string;
  tokens?: number;
  error?: boolean;
  reasoning?: string;
  ts?: number | string;
  model?: string;
}

/** 附件（引用文件）：inline=前端已读内容；path=后端安全读取 */
export interface Attachment {
  id: string;
  name: string;
  path?: string;
  content?: string;
  mode: 'inline' | 'path';
}

/** ChatPane 组件属性 */
export interface ChatPaneProps {
  paneId: 'A' | 'B';
  focused: boolean;
  view: 'chat' | 'files';
  openReq: OpenReq | null;
  initialSearchOn: boolean;
  sessions: Session[];
  modelOptions: ModelOption[];
  selectedModel: SelectedModel | null;
  onSelectModel: (m: SelectedModel) => void;
  onFocus: () => void;
  onViewChange: (v: 'chat' | 'files') => void;
  onPaneSessionKnown: (id: string | null) => void;
  onSessionsMutated: () => void;
  onOpenPreview?: (html: string) => void;
  onToast?: (msg: string) => void;
  runningSessionIds?: string[];
  style?: CSSProperties;
}
