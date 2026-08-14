import { Router } from 'express';
import { Gateway } from '../../core/gateway';
import type { SessionStateStore } from '../../core/gateway/session-state';
import { registerAuth } from './auth';
import { registerChat } from './chat';
import { registerFiles } from './files';
import { registerMemories } from './memories';
import { registerPreview } from './preview';
import { registerProviders } from './providers';
import { registerSecurity } from './security';
import { registerSessions } from './sessions';
import { registerSkills } from './skills';
import { registerQuiz } from './quiz';
import { registerTasks } from './tasks';
import { registerUsage } from './usage';
import { registerWorkspace } from './workspace';

/**
 * API 路由组装器。
 * 各路由域拆分到 routes/ 下的独立模块（auth / sessions / providers / memories /
 * skills / chat / tasks / workspace / preview / usage / security），
 * 本文件只负责把子模块注册到统一 Router 上，保持对外 createApiRouter(gw) 契约不变。
 * sessionStates 为可选注入：会话实时状态快照（/api/sessions/:id/live 用）。
 */
export function createApiRouter(gw: Gateway, sessionStates?: SessionStateStore): Router {
  const r = Router();

  registerAuth(r);            // GitHub / 微信 OAuth
  registerSessions(r, gw, sessionStates); // 状态检查 + 会话 CRUD + 分享 + 实时状态快照
  registerProviders(r, gw);   // 服务商 CRUD + 模型切换
  registerMemories(r);        // 长期记忆
  registerSkills(r);          // 技能（与 WorkBuddy 互通）
  registerQuiz(r, gw);        // 题库（AI 生成 / 导入的选择题组 + 详细题解）
  registerChat(r, gw);        // 对话 / 中止 / 澄清 / 后台任务
  registerFiles(r);           // 文件上传(POST /api/files/upload)
  registerTasks(r, gw);       // 定时任务
  registerWorkspace(r, gw);   // 搜索配置 / 工作区与文件系统 / 系统提示词
  registerPreview(r);         // 预览子系统
  registerUsage(r);           // Token 用量统计
  registerSecurity(r);        // 安全：策略 / 审批 / 沙箱

  return r;
}
