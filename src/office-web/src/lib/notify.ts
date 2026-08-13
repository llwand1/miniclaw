// 任务完成浏览器通知（Notification API）
//
// 纯前端偏好，存 localStorage，不需要后端改动。
// 挂载点：App.tsx 全局监听 previewClient 的 run-state 事件；设置页用 Toggle 控制开关。
//
// 与正式版对接：通知逻辑完全收敛在 notifyTaskDone，未来若要改成「仅后台任务通知」
// 或「系统内 Toast 而非系统通知」，只需改这里与 App 的订阅条件，页面零改动。

const TASK_KEY = 'studentbuddy.taskNotify';
const CHAT_KEY = 'studentbuddy.chatNotify';

function getEnabled(key: string): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(key) === '1';
}

function setEnabled(key: string, v: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, v ? '1' : '0');
}

export function getTaskNotifyEnabled(): boolean {
  return getEnabled(TASK_KEY);
}

export function setTaskNotifyEnabled(v: boolean): void {
  setEnabled(TASK_KEY, v);
}

/** 对话回复完成提醒开关（独立于任务完成提醒，可分别控制） */
export function getChatNotifyEnabled(): boolean {
  return getEnabled(CHAT_KEY);
}

export function setChatNotifyEnabled(v: boolean): void {
  setEnabled(CHAT_KEY, v);
}

export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export function getNotificationPermission(): NotifyPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as NotifyPermission;
}

/**
 * 请求浏览器通知权限。**必须在用户手势（点击）中调用**，否则浏览器会静默拒绝。
 * 返回最终权限状态。
 */
export async function requestNotificationPermission(): Promise<NotifyPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  try {
    const p = await Notification.requestPermission();
    return p as NotifyPermission;
  } catch {
    // 个别浏览器 requestPermission 不是 Promise（旧 API），兜底读当前值
    return Notification.permission as NotifyPermission;
  }
}

/**
 * 弹浏览器系统通知（完成/失败统一入口）。受「开关」与「权限」双重控制：
 * 开关未开、或权限不是 granted、或环境不支持 Notification，都会安全跳过。
 */
function showNotification(tag: string, opts: { title: string; body?: string }): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      tag,
      silent: false,
    });
    n.onclick = () => {
      try { window.focus(); } catch { /* ignore */ }
      n.close();
    };
    // 自动关闭，避免通知堆积
    setTimeout(() => n.close(), 10000);
  } catch {
    /* 某些环境 new Notification 可能抛错（如非 https 且非 localhost），忽略 */
  }
}

/**
 * 任务结束（完成 / 失败）时弹浏览器系统通知。受「开关」与「权限」双重控制：
 * 开关未开、或权限不是 granted、或环境不支持 Notification，都会安全跳过。
 */
export function notifyTaskDone(opts: { title: string; body?: string }): void {
  if (!getTaskNotifyEnabled()) return;
  showNotification('studentbuddy-task', opts);
}

/**
 * 对话 AI 回复完成时弹浏览器系统通知（新功能，独立开关）。
 * 触发条件：收到 SSE 事件的 done 终态（非 chat-error）。
 */
export function notifyChatDone(opts: { title: string; body?: string }): void {
  if (!getChatNotifyEnabled()) return;
  showNotification('studentbuddy-chat', opts);
}
