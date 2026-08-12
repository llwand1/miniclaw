import { useState, useEffect, useCallback, useRef } from 'react';

export interface TTSSettings {
  voiceURI: string;      // 选中的语音 URI
  lang: string;          // 语言代码 (如 'zh-CN', 'en-US')
  rate: number;          // 语速 0.5 - 2.0
  pitch: number;         // 音调 0.5 - 2.0
  volume: number;        // 音量 0.0 - 1.0
}

const DEFAULT_SETTINGS: TTSSettings = {
  voiceURI: '',
  lang: 'zh-CN',
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
};

const STORAGE_KEY = 'mc-tts-settings';

export function useTTSSettings() {
  const [settings, setSettings] = useState<TTSSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch { /* ignore */ }
    return DEFAULT_SETTINGS;
  });

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const loadVoicesRef = useRef<() => void>();

  // 加载可用语音列表
  const loadVoices = useCallback(() => {
    const available = window.speechSynthesis.getVoices();
    if (available.length > 0) {
      setVoices(available);
      // 如果没有选中语音，自动选择匹配当前语言的第一个语音
      if (!settings.voiceURI) {
        const match = available.find(v => v.lang.startsWith(settings.lang.split('-')[0]));
        if (match) {
          setSettings(prev => ({ ...prev, voiceURI: match.voiceURI }));
        }
      }
    }
  }, [settings.lang, settings.voiceURI]);

  // 尝试加载语音，如果为空则定时重试
  useEffect(() => {
    let retries = 0;
    const tryLoad = () => {
      loadVoices();
      if (voices.length === 0 && retries < 20) {
        retries++;
        setTimeout(tryLoad, 100);
      }
    };
    tryLoad();
    loadVoicesRef.current = loadVoices;
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, [loadVoices, voices.length]);

  // 手动刷新语音列表
  const refreshVoices = useCallback(() => {
    loadVoices();
  }, [loadVoices]);

  // 保存设置
  const updateSettings = useCallback((partial: Partial<TTSSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...partial };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // 重置为默认
  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, []);

  // 获取选中的语音对象
  const selectedVoice = voices.find(v => v.voiceURI === settings.voiceURI) || null;

  return {
    settings,
    updateSettings,
    resetSettings,
    voices,
    selectedVoice,
    refreshVoices,
  };
}

// 用于在组件外部获取当前设置（如在 hook 中使用）
export function getTTSSettings(): TTSSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
  } catch { /* ignore */ }
  return DEFAULT_SETTINGS;
}