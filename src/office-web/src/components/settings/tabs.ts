import { IconBrain, IconCode, IconCloud, IconLock, IconMessageSquare, IconSearch, IconVolume2 } from '../Icons';

export type Tab = 'providers' | 'memories' | 'search' | 'prompt' | 'skills' | 'security' | 'notifications';

// ─── 侧栏 Tab 定义 ──────────────────────────────────────────
export const sidebarTabs: { id: Tab; label: string; icon: typeof IconCloud; desc: string }[] = [
  { id: 'providers', label: '服务商', icon: IconCloud, desc: '管理 AI 模型接入' },
  { id: 'search', label: '联网搜索', icon: IconSearch, desc: '配置网络搜索能力' },
  { id: 'prompt', label: '系统提示词', icon: IconMessageSquare, desc: '定义 AI 行为准则' },
  { id: 'memories', label: '长期记忆', icon: IconBrain, desc: '管理 AI 记忆' },
  { id: 'skills', label: '技能', icon: IconCode, desc: '管理 AI 技能' },
  { id: 'security', label: '安全', icon: IconLock, desc: '权限矩阵 / 审批 / 沙箱' },
  { id: 'notifications', label: '通知', icon: IconVolume2, desc: '任务完成浏览器提醒' },
];
