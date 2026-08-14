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
