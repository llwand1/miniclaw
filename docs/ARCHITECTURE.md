# 架构深读

本文面向需要理解 MiniClaw 内部构造、或需要在此基础上扩展功能的开发者。

**MiniClaw 是双形态交付**：
- **主形态 · 本地 Web 服务**：`scripts/dev-server.ts`（Node 20）启动 `Gateway` + `Express`（绑定 `127.0.0.1:18791`），浏览器访问 `http://127.0.0.1:18791` 获得全部能力。
- **保留形态 · Electron 壳**：`src/cli/index.ts` 用 `BrowserWindow` / `Tray` / `globalShortcut` 拉起主窗 + 悬浮窗 + 托盘，壳内 `loadURL` 同一套 Web UI；预览在壳内走 `WebContentsView` 原生视图，Web 形态走 `PreviewPage` iframe。
两种形态共享同一套 `office-server` + `office-web`。

---

## 1. 进程与模块拓扑

```
scripts/dev-server.ts（Node 20）
  └─ new Gateway()                        # 事件总线 + 对话编排（核心业务逻辑）
       └─ gateway.start()                 # 初始化 db（better-sqlite3）、加载 providers
       └─ createServer(gateway, webPath)  # src/office-server：Express + SSE 广播
             └─ http.listen(18791, '127.0.0.1')
             └─ express.static(webPath)   # 生产态静态托管 dist/web

Gateway 事件总线（extends EventEmitter）emit：
  token / artifact / chat-error / trace-start / trace-span / trace / step / file-change
        │
        ▼
office-server 订阅并广播到对应会话的 SSE 连接（含缓冲回放 + 通配订阅 + 心跳）
        │
        ▼
src/office-web（React）消费 SSE + 调用 /api/*
```

> `src/office-server` 与 `src/office-web` 构成全部能力面：任何新前端（同源网页、移动壳等）
> 只要按 [`docs/SSE-CONTRACT.md`](SSE-CONTRACT.md) 消费同一套 SSE/HTTP 契约即可复用。

---

## 2. 数据层（better-sqlite3）

单文件本地库，位置由 `core/gateway/db.ts` 管理。主要表：

| 表 | 用途 | 状态 |
|----|------|------|
| `providers` | AI 服务商配置（type/base_url/api_key[密文]/default_model/enabled） | 在用（种子注入 + CRUD + test） |
| `agents` | agent 配置表（种子 `id='default'`；UI 未做多 agent 切换） | 在用（被 providers 删除校验引用） |
| `sessions` | 会话（软删除 `deleted_at`、置顶 `pinned`、标题） | 在用 |
| `messages` | 消息（role/content/tokens/reasoning/model） | 在用 |
| `skills` | 技能注册表（与 WorkBuddy 互通 import/export） | 在用（CRUD + import/export） |
| `scheduled_tasks` | 定时任务（once/interval，gateway 调度器驱动） | 在用（取代 legacy `cron_jobs`） |
| `token_usage` | 用量统计（agent/provider/model/prompt/completion tokens） | 在用（`/api/usage/stats`） |
| `memories` | 长期记忆（A/B/C 分类，含 importance/source） | 在用 |
| `search_config` | 联网搜索开关与 provider | 在用 |
| `traces` / `spans` | 调用链落地（Trace 实时走 SSE，历史表落库） | 在用（`GET /api/traces` 标注待删除，前端走 SSE） |
| `app_settings` / `window_state` | 应用级 KV 设置、窗口位置持久化 | 在用 |
| `session_shares` | 分享令牌（导出 Markdown） | 在用（`POST /sessions/:id/share`） |
| `github_oauth_config` / `github_tokens` / `users` / `wechat_oauth_config` / `wechat_tokens` | GitHub / 微信 OAuth 登录 | 在用（`/auth/github/*` `/auth/wechat/*`） |
| `cron_jobs` | 定时任务（被 `scheduled_tasks` 取代） | **遗留表，零写入，待删除** |
| `files` | 文件表 | **遗留表，零引用，待删除** |

建表语句在 `core/gateway/db.ts` 的迁移里，新增表务必在此登记并向下兼容。

---

## 3. 调用链（Trace）实现要点

- `core/trace/tracer.ts`：`Tracer` / `Trace` / `Span` 三原语；`AsyncLocalStorage` 传递上下文，
  下游用 `tracer.active()?.startChild(name, kind, attrs)` 挂子 Span，无需层层传参。
- `Trace` 继承 `EventEmitter`：每个 Span 的 start/end 立即 emit `span` 事件；
  `gateway` 转发为 `trace-start` / `trace-span`；`Trace.end()` 末尾 `removeAllListeners()` 防泄漏。
- 落库容错：`persistTrace` 失败仅 `warn`，绝不拖累主流程。
- 嵌套自动维护：新 Span 默认挂到"当前未结束 Span"之下；`end()` 兜底结束所有未关闭子 Span（防无穷长条）。

---

## 4. 工具调用（step）实现要点

- `gateway` 检测到模型回复中的 `[SEARCH:...]` / `[FETCH:...]` 标记后，先发 `step`（`running`，带 `args`），
  执行 `performSearches` / `performFetches`，完成发 `step`（`done`，带 `result`）。
- 同时 `trace.startChild('tool.call','tool',{...})` 把工具调用埋入调用链，Trace 瀑布也能看到。
- 工具失败不单独发 `step error`，统一由外层 `catch` 发 `chat-error`。

---

## 5. 构建与运行

| 命令 | 作用 |
|------|------|
| `npm run build` | `scripts/build.js`：Vite 构建 `src/office-web` → `dist/web`；tsc 编译后端 → `dist/` |
| `npm run web:dev` | concurrently 跑 `dev-server.ts`（:18791）+ Vite（:5173） |
| `npm run lint` | `tsc --noEmit`（仅后端；前端用 `cd src/office-web && tsc -p tsconfig.json --noEmit`） |

生产运行：`npm run build && tsx scripts/dev-server.ts`，浏览器访问 `http://127.0.0.1:18791`。

---

## 6. 后续可对接项（已规划未实现）

- **前端 SSE 自动重连**：预览面板断流当前需手动刷新，可加断线 2s 重试。
- **历史 Trace 列表**：会话内多请求切换回看（数据已落库 `traces`，缺前端列表 UI）。
- **更丰富的 step 类型**：除 search/fetch 外可扩展本地工具（计算器、文件读取等），前端 `ToolSteps` 已按 `tool` 字段做图标分发，扩展成本低。
