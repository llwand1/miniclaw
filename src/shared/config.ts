// 全局功能开关 —— 正式版对接点。
// 后续可从 config/*.json 或远端加载后 merge 到此处；当前给出合理默认值。
import type { PreviewMode } from './preview-types';

export interface PreviewConfig {
  /** 总开关。 */
  enabled: boolean;
  /** 开放的模式；dev 已预留接口，默认仅开放 static。 */
  modes: PreviewMode[];
  /** 内存中保留的最大 artifact 数量（超出丢弃最旧）。 */
  maxArtifacts: number;
}

export interface AppConfig {
  features: {
    preview: PreviewConfig;
  };
}

export const defaultConfig: AppConfig = {
  features: {
    preview: {
      enabled: true,
      modes: ['static'],
      maxArtifacts: 20,
    },
  },
};
