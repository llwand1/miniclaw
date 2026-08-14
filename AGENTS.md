# AGENTS.md — studentbuddy 项目导航

> 本文件是 AI agent 改 studentbuddy 功能时的**第一入口**。
> 改任何功能前，先读这张表定位，再用 `read_symbol` / `list_symbols` 精确读取，避免 `read_file` 全文加载浪费 token。

## 项目一句话

本地优先的 AI 助手（**本地 Web 服务形态**，浏览器访问 `127.0.0.1:18791`）。Node20 + TypeScript + React + better-sqlite3 + Express。
分层：channel(主窗) → gateway(路由+会话+SSE) → agent → adapter(OpenAI兼容/Anthropic)。
产品形态对标电脑版豆包。

## 目录速查

| 路径 | 职责 |
|------|------|
| `scripts/dev-server.ts` | Web 服务形态启动入口（Gateway + Express :18791） |
| `src/core/gateway/index.ts` | Gateway 事件总线 + 对话编排 |
| `src/core/gateway/db.ts` | SQLite 迁移 + 表定义 |
| `src/core/adapter/` | OpenAI兼容 / Anthropic 适配器 |
| `src/core/agent/index.ts` | Agent 执行逻辑 |
| `src/core/search/index.ts` | 联网搜索/抓取入口（优先 Python 强化服务，失败降级 Node 直连） |
| `src/core/search/python-bridge.ts` | Python 联网服务桥接层（子进程 + stdio JSON-RPC，懒启动/崩溃重启/超时保护） |
| `services/py-search/` | Python 联网强化服务（Bing/百度/DDG 多源并发 + 代理 + 重试；抓取 trafilatura + playwright 可选 JS 渲染） |
| `src/office-server/routes/api.ts` | Express REST + SSE 路由（登录/会话/搜索/文件） |
| `src/office-server/routes/quiz.ts` | 题库/出题/题解/薄弱点 + AI 导入（三题型） |
| `src/office-server/routes/memorize.ts` | 背背背：词条 CRUD + 复习进度 + AI 联动 |
| `src/office-server/index.ts` | office-server 启动 + SSE 广播 |
| `src/office-web/src/pages/ChatPage.tsx` | 主窗对话 UI（中屏视图切换 chat/quiz/memorize/settings） |
| `src/office-web/src/pages/QuizBankPage.tsx` | 题库页（练习/导出/AI 导入） |
| `src/office-web/src/pages/MemorizePage.tsx` | 背背背翻卡背诵页 |
| `src/office-web/src/components/chat/WelcomeHero.tsx` | 空会话新任务开始页（吉祥物+大输入框+快捷任务） |
| `src/office-web/src/components/chat/Mascot.tsx` | 书精灵吉祥物（可互动） |
| `src/office-web/src/components/AdviceRequestCard.tsx` | AI 学习建议卡片（fork 子对话） |
| `src/office-web/src/pages/SettingsPage.tsx` | 设置页（服务商/搜索/GitHub/微信登录/教学引导） |
| `src/office-web/src/pages/PreviewPage.tsx` | 预览页 |
| `src/office-web/src/App.tsx` | 侧边栏导航分组（工作区/系统）+ 主路由 |
| `docs/ARCHITECTURE.md` | 架构拓扑详解 |
| `docs/SSE-CONTRACT.md` | SSE 事件契约 |

## 功能索引表

> 改功能时先查这张表，定位到文件 + 符号名，再用 `read_symbol` 精确读取。
> **每改完一个功能，回来更新对应行**（行号会变，符号名是稳定的锚点）。

### 后端（src/office-server/routes/api.ts）

| 功能 | 符号 / 路由 | 当前行号 |
|------|------------|---------|
| SHA-256 / base64url 工具 | `sha256` `base64url` | L23-29 |
| GitHub Client ID 读取 | `getGithubClientId` | L32 |
| GitHub 配置接口 | `GET/PUT /auth/github/config` | L36-49 |
| GitHub 授权发起(PKCE) | `GET /auth/github` | L52 |
| GitHub 回调换token | `GET /auth/github/callback` | L67 |
| GitHub 登录状态 | `GET /auth/github/status` | L114 |
| GitHub 登出 | `POST /auth/github/logout` | L127 |
| GitHub token 读取 | `GET /auth/github/token` | L138 |
| 微信配置读取 | `getWechatConfig` | L156 |
| 微信配置接口 | `GET/PUT /auth/wechat/config` | L158-172 |
| 微信授权发起 | `GET /auth/wechat` | L175 |
| 微信回调换token | `GET /auth/wechat/callback` | L185 |
| 微信登录状态 | `GET /auth/wechat/status` | L237 |
| 微信登出 | `POST /auth/wechat/logout` | L251 |
| 会话列表 | `GET /api/sessions` | — |
| 单会话+消息 | `GET /api/sessions/:id` | — |

### 后端记忆架构（src/core/gateway/index.ts）

> 多重记忆模式：模型在规划阶段用 `<<MEM:profile,recent,episodic>>` 选择要加载的记忆模式，
> 网关按所选模式从 `memories` 表按需召回并注入最终生成阶段。`profile`（A 类画像）始终保底注入。

| 功能 | 符号 / 常量 | 说明 |
|------|------------|------|
| 记忆模式注册表 | `MEMORY_MODES`（导出） | profile/recent/episodic 三模式定义（key/category/name/desc/when/limit） |
| 解析选择标记 | `extractMemoryTriggers(text)` | 从规划文本解析 `<<MEM:...>>` 返回模式 key 列表 |
| 任务清单解析 | `extractTodos(text)` | 从规划文本解析 `[TODO:...]` 步骤清单，经 `todos` 事件下发 |
| 需求澄清解析 | `extractClarify(text)` | 解析 `[ASK:{json}]`（grill-me 式），挂起生成并下发 clarify 事件 |
| 澄清恢复生成 | `answerClarify(sessionId, answer)` | 把用户选择写入历史后复用 handleMessage 全流程继续 |
| 生成重试 | `generateOnce` | LLM 瞬时网络错误（fetch failed/超时/连接重置）自动重试一次，防「消息落库但回复未生成」 |
| 默认模式策略 | `resolveMemoryModes(opts)` | 模型未选择时：复杂任务=全模式，简单任务=仅 profile |
| 按模式召回 | `loadModeMemories(modeKeys, query)` | 按 category 过滤 retrieveMemories 打分结果，组装提示块 |
| 打分排序 | `retrieveMemories(query)` | 相关性×重要性×时间衰减 |
| 上下文上限 | `getContextLimit(providerId?, model?)` | 模型 context window 映射（MODEL_CONTEXT_LIMITS，未知走默认） |
| 真实上下文估算 | `estimateSessionContext(sessionId)` | sys/hist/tools/files 分项估算，供前端进度条（替代写死 8000） |
| 记忆写入 | `saveMemo(content, category, source)` | 支持 A/B/C，C=任务经验（importance 0.8，上限 15） |
| 自动沉淀 | `summarizeMemories(provider, history)` | 回复后异步提取 `[MEMO:内容\|A/B/C]` |
| 记忆解析 | `extractMemos(text)` | 解析回复中的 `[MEMO:...]` 行 |

### 后端原生工具循环（src/core/gateway/index.ts）

> 原生 function call（2026-08-12 新增）：工具启用时优先走「模型原生 tools 参数 → tool_calls → 执行 → 回灌」，
> 与文本标记路径（[SEARCH:]/[FS]）并行；模型未走原生工具时返回 null 交还原路径，完全向后兼容。

| 功能 | 符号 | 说明 |
|------|------|------|
| 工具循环上限 | `MAX_TOOL_TURNS`（常量，=8） | 模型连续 tool_calls 最多执行轮数，防死循环 |
| 构建工具清单 | `buildNativeTools(searchEnabled, workspaceConfigured)` | 按启用状态生成 `search_web`/`fetch_page`（搜索）+ `fs_read`/`fs_grep`/`fs_edit`/`fs_write`（工作区） |
| 执行单个工具 | `executeNativeToolCall(sessionId, call, searchConfig, trace)` | 解析 JSON 参数 → 复用 performSearches/performFetches/fs-tools，emit step + file-change + Trace span |
| 原生工具循环 | `runNativeToolLoop(...)` | 带 tools 请求 → tool_calls 执行 → `assistant(toolCalls)+tool(结果)` 回灌 → 循环；无 tool_calls 且未执行过工具时返回 null 交还原路径 |

### 后端启动种子（src/core/gateway/index.ts）

> P0-1（2026-08-12 修复）：空库自动注入默认 provider + agent，开箱不再 500。

| 功能 | 符号 | 说明 |
|------|------|------|
| 空库种子 | `seedIfEmpty`（private，`start()` 调用） | providers/agents 表为空时注入 `openai-default` provider（api_key 留空，用户设置页填写）+ `agents.id='default'`；幂等，仅空表注入 |

### 后端文件上传 + 文本提取（src/core/upload.ts）

> 2026-08-13 新增：纯 Web 形态浏览器拿不到本地路径，大文件/二进制只能先上传到服务端暂存（DATA_DIR/uploads/），
> 再以 path 模式注入 AI。上传时按扩展名异步提取纯文本到伴生 `<uuid>.txt`，prompts.ts 注入时优先读伴生文件。
> 单文件上限 50MB；扩展名黑名单与安全策略一致（exe/dll 等拒绝）。

| 功能 | 符号 / 路由 | 说明 |
|------|------------|------|
| 上传保存 | `saveUpload(buffer, name)` | uuid 重命名落盘 + 异步提取文本写伴生 .txt；黑名单扩展名抛错 |
| 文本提取 | `extractText(filePath, ext)` | pdf→pdf-parse v2、docx→mammoth、pptx/ppt→jszip 解 slide XML、文本类直接读 utf-8 |
| 上传路由 | `POST /api/files/upload?name=`（routes/files.ts） | body 为文件原始字节（express.raw，limit 50MB，仅此路由放宽，其余仍 2mb） |
| 上限查询 | `GET /api/files/upload-config` | 返回 maxBytes（设置页可展示） |
| 附件注入 | `readAttachmentFile`（prompts.ts） | 优先读 `<path>.txt` 伴生提取文本，否则读原文件（≤20MB） |

### 后端数据库（src/core/gateway/db.ts）

| 功能 | 表/函数 |
|------|---------|
| 迁移入口 | `migrate(database)` L28 |
| providers 表 | L32 |
| sessions 表 | L57 |
| messages 表 | L75 |
| memories 表 | L157（A/B/C 分类，含 importance/source；旧库自动重建升级） |
| github_oauth_config 表 | L148 |
| users 表 | L157（含 wechat_unionid/wechat_openid 补列 L205-211） |
| github_tokens 表 | L168 |
| wechat_oauth_config 表 | L179 |
| wechat_tokens 表 | L190 |
| app_settings 表 | L219 |
| session_shares 表 | L243 |
| quiz_bank 表 | 题库（data=QuizData，source=ai/import/manual） |
| quiz_stats 表 | 逐题练习统计（attempts/correct/streak，PK=quiz_id+question_index） |
| memorize 表 | 背背背词条（term/definition/category/difficulty/review_count/mastered） |
| traces / spans 表 | ~~已删除~~（2026-08-13 Trace 功能移除，勿再引用） |

### 前端 ChatPage（src/office-web/src/pages/ChatPage.tsx）

| 功能 | 符号名 | 当前行号 |
|------|--------|---------|
| 对话历史导航面板 | `HistoryNavPanel` | L761 |
| 导航条目类型 | `NavItem` | L754 |
| 单个对话窗格 | `ChatPane` | L968 |
| 窗格Props | `ChatPaneProps` | L948 |
| 发送消息 | `sendText` | L1229 |
| 加载会话 | `loadSession` | L1212 |
| 重试 | `retryLast` | L1284 |
| 中屏视图切换 | `centerView`（chat/quiz/memorize/settings） | ChatPage 顶层 state |
| 背诵页 fork 词条学习 | `forkMemorizeTerm` | ChatPage（fork 子对话 → AI 讲解/造句/出题） |
| 工具步骤卡片 | `ToolSteps` | L353 |
| 思考过程块 | `ReasoningBlock` | L509 |
| 上下文用量计算 | `computeCtx` | L529 |
| 长文本折叠 | `FoldText` | 工具结果/文件内容卡片（超 600 字符收起 + 复制） |
| 代码块折叠 | `CodeFoldingBlock` / `CODE_FOLD_LINES` | 对话流大代码块（超 40 行收起） |
| 工作区浏览器 | `WorkspaceExplorer` | L571 |
| Markdown 流式渲染 | `MarkdownStream` | L614 |
| 选择题/填空/解答卡片 | `QuizCard` / `parseQuiz` / `AssistantBody` | quiz-generator 技能：[QUIZ] JSON → 卡片（三题型 + 收词入背诵本） |
| 书精灵吉祥物 | `Mascot`（components/chat/Mascot.tsx） | 欢迎页主视觉，可互动（消息头像降级纯装饰） |
| 空会话开始页 | `WelcomeHero`（components/chat/WelcomeHero.tsx） | 大输入框 + 快捷任务预设卡片 |
| AI 学习建议卡片 | `AdviceRequestCard`（components/AdviceRequestCard.tsx） | 出题/讲解后 fork 子对话要建议+资料链接 |
| 外壳(侧边栏+分栏) | `ChatPage` | ChatPage.tsx 顶层组件 |

### 前端预览页（src/office-web/src/pages/PreviewPage.tsx）

| 功能 | 符号名 | 当前行号 |
|------|--------|---------|
| Markdown → HTML 渲染 | `mdToHtml` / `inlineMd` / `escHtml` | 文件头部（标题/列表/表格/代码块/引用/粗体斜体/链接） |
| artifact 渲染入口 | `renderPreview` | 文件头部（html 原样 / markdown 走 mdToHtml / code 包阅读器） |

### 前端 SettingsPage（src/office-web/src/pages/SettingsPage.tsx）

| 功能 | 符号名 | 当前行号 |
|------|--------|---------|
| 教学引导面板 | `SetupGuide` | L39 |
| 一键复制组件 | `CopyChip` | L21 |
| 引导步骤类型 | `GuideStep` | L16 |
| GitHub 状态加载 | `loadGithubStatus` | L294 |
| GitHub 登录 | `githubLogin` | L377 |
| GitHub 登出 | `githubLogout` | L421 |
| 微信状态加载 | `loadWechatStatus` | L304 |
| 微信登录 | `wechatLogin` | L313 |
| 微信登出 | `wechatLogout` | L353 |
| 微信配置保存 | `saveWechatConfig` | L360 |
| 服务商加载 | `loadProviders` | L152 |

## 改功能的标准流程（省 token）

1. **查表**：在本文件的「功能索引表」里找目标功能，记下 `文件` + `符号名`。
2. **精确定位**：用 `read_symbol(文件, 符号名)` 读目标函数，**不要** `read_file` 全文。
   - 不确定符号名？先 `list_symbols(文件)`（~800 token），再 `read_symbol`。
3. **最小改动**：用 `edit_file` 只改需要改的部分。
4. **验证**：`npx tsc --noEmit`（项目根 + office-web 子项目都要过）。
5. **更新索引**：改完后回来更新本文件的行号 / 新增功能行。

### Token 消耗对比

| 操作 | Token |
|------|-------|
| `read_file(ChatPage.tsx)` 全文 | ~6000 |
| `list_symbols` + `read_symbol` 精确读 | ~1300 |
| **节省** | **78%** |

## 常见坑

### db.ts：`database.exec` 模板字符串不能提前闭合

`db.ts` 的 `migrate()` 用一个大的 `database.exec(\`...\`)` 模板字符串批量建表。
**坑**：在模板中间插入 `);` 会提前闭合，导致后面的 SQL 裸露成 TypeScript 代码，tsc 报一堆 `TS1434`。
**避坑**：新增表要加在模板字符串内部（在最后一个 `);` 之前），或在模板外部用独立的 `database.exec()`。

### SSE 串台

每个 Pane 的 SSE 按 `sessionId` 隔离广播。改 SSE 相关代码时注意：
- `streamKey = sid || clientIdRef.current`（L828 区附近）
- 服务端按 sessionId 过滤，不能用通配订阅给特定会话发事件

### React Fragment 闭合

ChatPage.tsx 的 `chatView` / `fileView` 用 `<>...</>` Fragment。
**坑**：改成 `<div>` 外层后，末尾的 `</>` 要同步改成 `</div>`，否则 JSX 编译报错。
**避坑**：改完外层标签，立刻 grep 闭合标签确认配对。

### users 表的 github_id 是 NOT NULL

微信用户没有 github_id。新增微信登录时，users 表的 `github_id` 字段对微信用户填 `0`。
**坑**：如果后续加更多登录方式，`github_id NOT NULL UNIQUE` 会冲突（多个 0）。
**避坑**：考虑把 `github_id` 改为可空，或用 `provider` + `provider_uid` 复合键。

### dev server 端口

- Vite dev server: **5173**
- office-server (Express + SSE): **18791**
- OAuth 回调地址写死 `http://localhost:18791/auth/{github,wechat}/callback`

## 开发命令

| 命令 | 用途 |
|------|------|
| `npm run web:dev` | 启动 api(18791) + ui(5173) dev server |
| `npm run build` | 构建（dist/） |
| `npm run lint` | `tsc --noEmit` 类型检查 |

## 协作约定

- 用户同时用多个 AI 开发，免费 AI 做常规活，AtomCode 专攻困难问题直接改代码。
- 项目周期较长，AtomCode 围绕该项目长期给建议或开发。
- 未明确要求前不主动改代码。
- 改完功能必须更新本文件的「功能索引表」行号。
