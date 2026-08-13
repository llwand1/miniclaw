import { useEffect, useState } from 'react';
import { getTaskNotifyEnabled, setTaskNotifyEnabled, getChatNotifyEnabled, setChatNotifyEnabled, getNotificationPermission, requestNotificationPermission, type NotifyPermission } from '../../lib/notify';
import { Toggle } from './Toggle';
import { cardStyle } from './styles';

/** 通知 Tab：任务完成提醒 + 对话回复完成提醒。从 SettingsPage 拆出。 */
export function NotificationsTab({ onMsg }: { onMsg: (msg: string) => void }) {
  const [notifyEnabled, setNotifyEnabled] = useState(getTaskNotifyEnabled());
  const [chatNotifyEnabled, setChatNotifyEnabledState] = useState(getChatNotifyEnabled());
  const [notifyPerm, setNotifyPerm] = useState<NotifyPermission>(getNotificationPermission());

  // 每次进入 Tab 时刷新权限状态（用户在浏览器里改了权限后回来能看到最新值）
  useEffect(() => {
    setNotifyPerm(getNotificationPermission());
  }, []);

  async function toggleNotify(next: boolean) {
    if (next) {
      // 开启开关必须在用户点击手势中请求权限
      const perm = await requestNotificationPermission();
      setNotifyPerm(perm);
      if (perm !== 'granted') {
        setNotifyEnabled(false);
        onMsg(
          perm === 'denied'
            ? '通知权限被拒绝：请在浏览器地址栏左侧的「站点设置」中允许通知后重试'
            : perm === 'unsupported'
              ? '当前环境不支持通知（需 https 或 localhost）'
              : '未能获取通知权限，请重试',
        );
        return;
      }
      setTaskNotifyEnabled(true);
      setNotifyEnabled(true);
      onMsg('已开启：任务结束（完成/失败）时会弹浏览器通知');
    } else {
      setTaskNotifyEnabled(false);
      setNotifyEnabled(false);
      onMsg('已关闭任务完成提醒');
    }
  }

  async function toggleChatNotify(next: boolean) {
    if (next) {
      const perm = await requestNotificationPermission();
      setNotifyPerm(perm);
      if (perm !== 'granted') {
        setChatNotifyEnabledState(false);
        onMsg(
          perm === 'denied'
            ? '通知权限被拒绝：请在浏览器地址栏左侧的「站点设置」中允许通知后重试'
            : perm === 'unsupported'
              ? '当前环境不支持通知（需 https 或 localhost）'
              : '未能获取通知权限，请重试',
        );
        return;
      }
      setChatNotifyEnabled(true);
      setChatNotifyEnabledState(true);
      onMsg('已开启：AI 回复完成时会弹浏览器通知');
    } else {
      setChatNotifyEnabled(false);
      setChatNotifyEnabledState(false);
      onMsg('已关闭对话回复完成提醒');
    }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>通知</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-4)' }}>任务结束（完成或失败）时弹浏览器系统通知，切到别的窗口也不会错过</p>
        </div>
      </div>

      <div style={{ ...cardStyle, padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>任务完成提醒</div>
            <div style={{ fontSize: 12, color: 'var(--text-4)' }}>
              浏览器通知权限：
              {notifyPerm === 'granted' && <span style={{ color: 'var(--success)', fontWeight: 600 }}>已允许</span>}
              {notifyPerm === 'denied' && <span style={{ color: 'var(--danger)', fontWeight: 600 }}>已拒绝（去浏览器站点设置开启）</span>}
              {notifyPerm === 'default' && <span style={{ color: 'var(--text-3)' }}>未授权</span>}
              {notifyPerm === 'unsupported' && <span style={{ color: 'var(--danger)', fontWeight: 600 }}>不支持（需 https 或 localhost）</span>}
            </div>
          </div>
          <Toggle checked={notifyEnabled} onChange={toggleNotify} disabled={notifyPerm === 'unsupported'} />
        </div>
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-4)', lineHeight: 1.7 }}>
          开启后，任意会话（含后台定时任务）结束时都会提醒。为避免前台打扰，仅在你切到其它窗口（studentbuddy 不在前台）时才弹通知；前台时任务状态已在界面显示。默认关闭，点击开关并在浏览器弹窗中点「允许」即可启用。
        </div>
      </div>

      {/* 对话回复完成提醒：与任务完成提醒独立开关，互不影响 */}
      <div style={{ ...cardStyle, padding: '18px 20px', marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>对话回复完成提醒</div>
            <div style={{ fontSize: 12, color: 'var(--text-4)' }}>
              AI 回复完成后弹系统通知（类似微信/浏览器 Gemini 的完成提示）
            </div>
          </div>
          <Toggle checked={chatNotifyEnabled} onChange={toggleChatNotify} disabled={notifyPerm === 'unsupported'} />
        </div>
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-4)', lineHeight: 1.7 }}>
          开启后，任意会话的 AI 回复成功结束时都会弹浏览器通知（如切到其它窗口等回复时最实用）。与上方「任务完成提醒」相互独立，可分别开关。仅后台时弹，前台不打扰。默认关闭。
        </div>
      </div>
    </>
  );
}
