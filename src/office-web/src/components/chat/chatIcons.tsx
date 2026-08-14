import { ReactNode } from 'react';

// ─── 自绘线条 SVG 图标（不用 emoji）──────────────────────────────────────
const svg = (size: number, children: ReactNode, sw = 2) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
export const IconChat = () => svg(15, <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></>);
export const IconFiles = () => svg(15, <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="14 3 14 9 20 9" /></>);
export const IconSearch = () => svg(14, <><circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" /><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" /></>);
export const IconThink = () => svg(13, <><circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>);
export const IconCaret = () => svg(11, <path d="M6 9l6 6 6-6" />, 2.5);
export const IconContext = () => svg(14, <><line x1="4" y1="20" x2="4" y2="13" /><line x1="10" y1="20" x2="10" y2="8" /><line x1="16" y1="20" x2="16" y2="11" /><line x1="22" y1="20" x2="22" y2="4" /></>);
export const IconTool = () => svg(14, <><path d="M14.7 6.3a4 4 0 0 0-5.4-5.4L3 10l-1 5 5-1 7.7-7.7z" /></>);
export const IconGlobe = () => svg(14, <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" /></>);
export const IconCheck = () => svg(13, <><polyline points="20 6 9 17 4 12" /></>);
export const IconCross = () => svg(13, <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>);
export const IconModel = () => svg(14, <><rect x="3" y="4" width="18" height="10" rx="2" /><line x1="8" y1="20" x2="16" y2="20" /><line x1="12" y1="14" x2="12" y2="20" /></>);
export const IconSkills = () => svg(14, <><path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></>);
/** 一键出题：答题卡/试卷线条图标（对齐其它工具项的线性风格） */
export const IconQuiz = () => svg(14, <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 3V2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" /><line x1="9" y1="9" x2="15" y2="9" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></>);
export const IconPlus = () => svg(14, <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>);
export const IconFile = () => svg(14, <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><polyline points="14 3 14 8 19 8" /></>);
export const IconSend = () => svg(14, <><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></>);
export const IconStop = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>;
export const IconPin = () => svg(14, <><path d="M12 17v4" /><path d="M9 3h6l-1 6 3 3H7l3-3-1-6z" /></>);
export const IconTrash = () => svg(14, <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></>);
export const IconEdit = () => svg(15, <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>);
export const IconShare = () => svg(15, <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" /></>);
export const IconDots = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>;
export const IconNew = () => svg(15, <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>, 2.2);
export const IconFileHtml = () => svg(18, <><polyline points="8 7 3 12 8 17" /><polyline points="16 7 21 12 16 17" /><line x1="13" y1="5" x2="11" y2="19" /></>);
export const IconFileDoc = () => svg(18, <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="14 3 14 9 20 9" /></>);
export const IconFileImage = () => svg(18, <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></>);
export const IconFolder = () => svg(15, <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>);
export const IconFileCode = () => svg(15, <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="14 3 14 9 20 9" /><polyline points="10 12 8 14 10 16" /><polyline points="14 12 16 14 14 16" /></>);
/** 三杠（汉堡）菜单图标：侧边栏收起态用于重新展开 */
export const IconMenu = () => svg(15, <><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" /></>);

// ─── 统一简洁线条风补充图标（对齐上述线性风格，用于替换界面中的 emoji）────────────────
/** 星标（收藏） */
export const IconStar = () => svg(13, <><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></>);
/** 火花（AI 原创/智能） */
export const IconSparkles = () => svg(13, <><path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z" /><path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9z" /></>);
/** 柱状图（答题统计） */
export const IconBarChart = () => svg(13, <><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" /></>);
/** 火焰（连对 streak） */
export const IconFlame = () => svg(13, <><path d="M12 22c4.4 0 7-2.8 7-6.6 0-2.8-1.8-4.6-3-6.2-1-1.3-1.8-2.8-2-4.6-.3-2.4-3.6-3.4-4.6-1.2C8.4 5.5 8 8 8.6 10.5c.2.9-.2 1.8-1 2.2C6 13.6 5 15 5 16.7 5 19.6 7.6 22 12 22z" /></>);
/** 时钟（加载/解析中） */
export const IconClock = () => svg(13, <><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></>);
/** 书本（题解/参考答案） */
export const IconBook = () => svg(13, <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>);
/** 警告三角（提示/警告） */
export const IconAlert = () => svg(13, <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>);
/** 闪电（高用量/快捷） */
export const IconZap = () => svg(13, <><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></>);
/** 回形针（选择文件） */
export const IconPaperclip = () => svg(13, <><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></>);
/** 机器人（AI 解析/导入） */
export const IconRobot = () => svg(13, <><rect x="4" y="8" width="16" height="12" rx="2" /><path d="M12 4v4" /><circle cx="12" cy="2.5" r="1.5" /><circle cx="9" cy="13" r="1.2" /><circle cx="15" cy="13" r="1.2" /><path d="M9 17h6" /></>);
/** 靶心（一键出题） */
export const IconTarget = () => svg(13, <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>);
/** 磁贴/图表（弱项分析） */
export const IconPie = () => svg(13, <><path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" /></>);
/** 庆祝彩带（练习完成） */
export const IconParty = () => svg(13, <><path d="M20 21v-2" /><path d="M17 21v-2" /><path d="M14 21v-2" /><path d="M21 13.5 18 8l-3 5.5z" /><path d="M18 8V3l-2.5 2L18 8z" /><path d="M8.5 16.5 3 21l4.5-5.5z" /><path d="M12 5 9.5 2 7 5l2.5 3z" /><path d="M16 12l-3-3-3 3 3 3z" /></>);
/** 奖杯（全对） */
export const IconTrophy = () => svg(13, <><path d="M8 21h8" /><path d="M12 17v4" /><path d="M7 4h10v6a5 5 0 0 1-10 0z" /><path d="M17 5h3a1 1 0 0 1 1 1c0 2.5-1.5 4-3.5 4" /><path d="M7 5H4a1 1 0 0 0-1 1c0 2.5 1.5 4 3.5 4" /></>);
/** 灯泡（提示/小诊断） */
export const IconLightbulb = () => svg(13, <><path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0 0 12 2z" /></>);

/** 按产物类型返回文件图标（html/image 专属，其余用文档图标） */
export function fileIcon(kind: string) {
  if (kind === 'html') return <IconFileHtml />;
  if (kind === 'image') return <IconFileImage />;
  return <IconFileDoc />;
}

/** 产物类型的中文标签 */
export function typeLabel(k: string) {
  return { html: 'HTML', markdown: 'Markdown', code: 'Code', image: '图片', url: '链接' }[k] || k;
}
