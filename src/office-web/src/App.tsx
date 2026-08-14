import { useEffect } from 'react';
import ChatPage from './pages/ChatPage';
import { previewClient } from './preview/PreviewClient';
import { notifyTaskDone, notifyChatDone } from './lib/notify';

/**
 * studentbuddy 应用外壳：三分屏全部由 ChatPage 内部承载
 * （左屏=对话管理+底部题库/设置入口，中屏=对话/题库/设置，右屏=文件预览与管理）。
 * 此处仅保留全局通知逻辑，并全屏渲染 ChatPage。
 */
export default function App() {
  // 全局任务完成通知：任意会话（含后台定时任务）结束时，若页面不在前台则弹浏览器系统通知。
  useEffect(() => {
    previewClient.start();
    const off = previewClient.subscribeRunning((d) => {
      if ((d.done || d.error) && !d.removed && d.task) {
        // 仅当用户切到其它窗口（studentbuddy 不在前台）时弹，避免前台冗余打扰，也天然规避「主动停止」误通知。
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
        const failed = !!d.error;
        const title = failed ? 'studentbuddy · 任务失败' : 'studentbuddy · 任务完成';
        const body = d.task.title || (failed ? (d.error as string) : '任务已完成');
        notifyTaskDone({ title, body });
      }
    });
    // 对话回复完成通知：任意会话的 AI 回复成功结束时，若页面不在前台则弹浏览器系统通知。
    // 与任务通知同策略（前台不打扰），由设置页「对话回复完成提醒」开关独立控制。
    const offChat = previewClient.subscribeChatDone((d) => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
      notifyChatDone({ title: 'studentbuddy · 回复完成', body: 'AI 已回复完成，点击回到对话' });
    });
    return () => { off(); offChat(); };
  }, []);

  return <ChatPage />;
}
