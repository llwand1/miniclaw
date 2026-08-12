import { useCallback, useRef, useState } from 'react';
import { getTTSSettings } from './ttsSettings';

// 全局朗读注册表：保证同一时刻只有一条消息在朗读，且各消息的图标状态正确复位。
const speakers = new Set<() => void>();
function stopAllSpeech() {
  for (const fn of speakers) {
    try { fn(); } catch { /* ignore */ }
  }
  speakers.clear();
}

export type ShareResult = 'copied' | 'shared' | 'failed' | 'cancelled';

/**
 * 单条消息的「复制 / 朗读 / 分享」操作。
 * - 复制：navigator.clipboard，失败回退到临时 textarea + execCommand。
 * - 朗读：Web Speech API（speechSynthesis），同屏互斥，支持停止。
 * - 分享：优先 navigator.share（移动/部分桌面），不可用时回退复制文本。
 */
export function useMessageActions() {
  const [speaking, setSpeaking] = useState(false);
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'shared' | 'failed'>('idle');
  const cleanupRef = useRef<(() => void) | null>(null);

  const copyText = useCallback(async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* fall through to legacy path */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }, []);

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return;
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      stopAllSpeech();
      setSpeaking(false);
      return;
    }
    stopAllSpeech();
    const u = new SpeechSynthesisUtterance(text);
    // 使用 TTS 设置
    const ttsSettings = getTTSSettings();
    u.lang = ttsSettings.lang;
    u.rate = ttsSettings.rate;
    u.pitch = ttsSettings.pitch;
    u.volume = ttsSettings.volume;
    if (ttsSettings.voiceURI) {
      const voice = synth.getVoices().find(v => v.voiceURI === ttsSettings.voiceURI);
      if (voice) u.voice = voice;
    }
    const cleanup = () => setSpeaking(false);
    cleanupRef.current = cleanup;
    speakers.add(cleanup);
    u.onend = cleanup;
    u.onerror = cleanup;
    synth.speak(u);
    setSpeaking(true);
  }, [speaking]);

  const share = useCallback(async (text: string, title?: string): Promise<ShareResult> => {
    try {
      if (navigator.share) {
        await navigator.share({ title: title || 'MiniClaw 回复', text });
        setShareState('shared');
        return 'shared';
      }
    } catch (e: any) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
    const ok = await copyText(text);
    setShareState(ok ? 'copied' : 'failed');
    return ok ? 'copied' : 'failed';
  }, [copyText]);

  return { speaking, shareState, copyText, speak, share };
}
