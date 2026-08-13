# studentbuddy 文档彻查报告 & 废弃文档清单

> 核查日期：2026-08-12
> 核查口径：**以 `C:\Users\llwan\Desktop\studentbuddy` 当前真实代码为准**（已逐文件核对 `src/`、`scripts/`、`config/`、`docs/` 与 `dist/` 编译产物）
> 结论摘要：仓库内主文档已随代码更新到位；**桌面散落的一批旧开发/测试/规划文档已全部被 `studentbuddy开发文档3.0.md` 取代或过时**，应移入废弃区。另有 1 个文档自相矛盾需修正、2 处代码层垃圾需清理。

---

## 一、真实代码基线（本次核查锚点）

| 维度 | 真实状态 |
|------|----------|
| 形态 | **本地 Web 服务（主）+ Electron 壳（保留）**。`dev-server.ts` 起 Express:18791；`cli/index.ts` 用 `BrowserWindow`/`Tray`/`globalShortcut` 加载同一套 Web UI |
| SQLite 表 | **21 张**（`gateway/db.ts` 实测 21 个 `CREATE TABLE IF NOT EXISTS`）：providers/agents/sessions/messages/skills/cron_jobs/scheduled_tasks/token_usage/files/window_state/memories/search_config/github_oauth_config/users/github_tokens/wechat_oauth_config/wechat_tokens/app_settings/session_shares/traces/spans |
| 已落地能力 | 安全子系统（`core/security/`：policy/approval/crypto/originCheck，DPAPI 加密 API Key）、工作区文件工具（`fs-tools` + `/api/fs/*` + `WorkspaceExplorer`）、Trace 调用链（`traces`/`spans` 落库）、用量统计（`usage` + CcSwitch 集成 + `UsageDashboard`）、技能管理（`skills` 表 CRUD + 与 WorkBuddy 互通 import/export）、GitHub/微信 OAuth 登录、`scheduled_tasks` 定时任务调度器 |
| 残留死物 | `dist/channel/` 编译产物仍在；`scripts/web-debug.bat` 仍在（引用不存在的 `src/server.ts`） |

---

## 二、文档分类结论

### ✅ A 类：准确，保留（与代码一致）
| 文档 | 说明 |
|------|------|
| `studentbuddy/README.md` | Web 形态快速开始，与现状一致 |
| `studentbuddy/AGENTS.md` | 功能索引表已含 GitHub/微信 OAuth、memories、QuizCard、UsageDashboard，准确 |
| `studentbuddy/docs/SSE-CONTRACT.md` | 含 fs-tools、`artifact` 流式、preview 分级 sandbox，准确（仅开头"单一形态"表述与 Electron 壳并存略有歧义，非实质错误） |
| `Desktop/studentbuddy全开发文档/studentbuddy开发文档3.0.md` | **2026-08-12 17:37 刚生成的新现状蓝图**，21 表 / 安全子系统 / fs-tools / skills / OAuth 全部对得上，是后续开发的唯一准绳 |

### ⚠️ B 类：自相矛盾，需修正（不建议直接废弃）
| 文档 | 问题 | 处置 |
|------|------|------|
| `studentbuddy/docs/ARCHITECTURE.md` | 开头写"**没有桌面壳，没有二次形态**"，但 `cli/index.ts` 实际有 `BrowserWindow`/`Tray`/`globalShortcut`；数据库表清单把 `agents`/`files`/`cron_jobs` 标"待删除"，但 `agents` 被 providers 删除校验引用、`scheduled_tasks` 已取代 `cron_jobs` 在跑、`files` 才真零引用 | **修正开头形态描述 + 表清单**（对齐 3.0 §4），不要废弃 |

### 🗑 C 类：脱离实际，移入废弃文档区（删除或归档）
> 共同原因：描述"11 表""M3 四面板未做""README 缺失""channel 已删但 di st 仍残留"等旧状态，已被 3.0 取代；或纯规划/测试快照已过期。

| 文档 | 脱离实际的核心点 | 建议 |
|------|------------------|------|
| `Desktop/studentbuddy全开发文档/studentbuddy开发文档.md` | 开工前规划版（全标"待开始"），被 2.0/3.0 取代 | 废弃 |
| `Desktop/studentbuddy全开发文档/studentbuddy开发文档2.0.md` | 写"11 表""M3 未做""README 缺失"，但实际 21 表、M3 大部分已做、README 已存在 | 废弃（被 3.0 取代） |
| `Desktop/studentbuddy全开发文档/studentbuddy-工作区能力规划.md` | 标题"纯规划未动代码"，但 `fs-tools` 已完整实现 | 废弃（能力已落地，见 3.0 §5.3） |
| `Desktop/studentbuddy全开发文档/studentbuddy-预览对接正式文档.md` | 仅评估悬浮窗预览版对接，主功能早已回灌；FloatingApp 已远超该清单 | 废弃 |
| `Desktop/studentbuddy必看/studentbuddy待完成功能.md` | P0 全空、"M3 四面板未做"等，与现状严重不符 | 废弃 |
| `Desktop/studentbuddy必看/studentbuddy-核心业务逻辑代码对照表.md` | 基准 2026-07-29/08-05，"11 表"图、channel 标"已删除"但 dist 仍残留；已被 3.0 取代 | 废弃 |
| `Desktop/studentbuddy必看/安全开发文档.md` | 风险分级方法论仍有价值，但模块清单（gateway 等级 4、adapter 等级 3）未含安全子系统/fs-tools/skills；被 3.0 §5.2 取代具体实现 | 废弃（或抽"风险分级方法论"并入 3.0 附录） |
| `Desktop/studentbuddy必看/studentbuddy待嵌入功能/studentbuddy-分栏预览.html` | 早期预览原型 HTML | 废弃（功能已回灌 ChatPage） |
| `Desktop/studentbuddy必看/studentbuddy待嵌入功能/studentbuddy-悬浮窗预览.html` | 早期悬浮窗预览原型 HTML | 废弃 |
| `Desktop/studentbuddy测试部分/studentbuddy-核心功能测试文档.md` | 2026-08-05 测试方案（仅测"能对话"主链路），未覆盖安全/fs/skills/OAuth | 归档（历史测试基线） |
| `Desktop/studentbuddy测试部分/studentbuddy-测试结果文档.md` | 同上历史结果 | 归档 |
| `Desktop/studentbuddy测试部分/studentbuddy配置信息.md` | 含明文 API Key（chatanywhere token），且为测试期配置 | **立即删除**（含密钥，不应留存） |
| `Desktop/studentbuddyWorkspace/test.md` | 占位空文件 | 删除 |

### 🧹 D 类：代码层垃圾（非文档，但本次彻查一并指出）
| 位置 | 处置 |
|------|------|
| `studentbuddy/dist/channel/`（index.js/.d.ts/.map） | 删：channel 源码已删，编译产物残留，重建即消失 |
| `studentbuddy/scripts/web-debug.bat` | 修/删：引用不存在的 `src/server.ts`，属坏脚本 |

---

## 三、建议执行动作

1. 在 `Desktop/studentbuddy全开发文档/` 与 `Desktop/studentbuddy必看/` 下新建 `废弃文档/` 目录，把 **C 类** 文档移入（保留可查，不误删）。
2. `studentbuddy配置信息.md`（含明文 Key）与 `studentbuddyWorkspace/test.md` **直接删除**，不进废弃区。
3. 修正 `studentbuddy/docs/ARCHITECTURE.md` 开头形态描述与数据库表清单（对齐 3.0）。
4. 清理 D 类代码垃圾（`dist/channel` + `web-debug.bat`）。
5. 后续以 `studentbuddy开发文档3.0.md` 为唯一准绳；任何功能改动后回写 3.0，避免再次出现文档分裂。

---

## 四、本次核查事实依据（节选）
- 实测 `src/core/gateway/db.ts`：`CREATE TABLE IF NOT EXISTS` × **21**
- 实测 `src/office-server/routes/api.ts`：`/skills` 路由 ×10、`/api/fs/` ×9、`/tasks`(scheduled_tasks) GET/POST/PUT/DELETE 齐全、`UsageDashboard.tsx` 组件存在（15321 字节）
- 实测 `src/cli/index.ts`：确有 `BrowserWindow`/`Tray`/`globalShortcut`/`createFloatingWindow` → 推翻"无桌面壳"说法
- 实测 `dist/channel/` 仍存在、`scripts/web-debug.bat` 仍存在（引用 `src/server.ts` 不存在）
