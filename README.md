# MiniClaw

> 本地优先的 AI 助手 · 以本地 Web 服务形态交付 · v0.1.0

MiniClaw 是一个本地优先的 AI 助手：基于 **Express + React/Vite + TypeScript**，所有数据
（会话、记忆、服务商配置、调用链）存在本地 SQLite，不上云。它把"联网搜索 → 多轮对话 →
工具调用可视化 → 调用链 Trace"做成开箱即用的体验，以**本地 Web 服务**形态交付：启动
`scripts/dev-server.ts` 后，浏览器访问 `http://127.0.0.1:18791` 即获得全部能力。

---

## 一、技术栈与架构总览

```
                    ┌───────────────────────────────────────────────┐
  启动入口           │ scripts/dev-server.ts（Node 20，无需原生重编译） │
                    └──────────────────────┬────────────────────────┘
                                           ▼
                    ┌───────────────────────────────────────────────┐
                    │  src/core/                                    │
                    │  gateway  事件总线 + 对话编排（emit token/step/ │
                    │           trace-*，记忆/工具/澄清调用）         │
                    │  agent    LLM 编排                             │
                    │  adapter  OpenAI 兼容适配                      │
                    │  trace    调用链 Tracer/Trace/Span             │
                    │  db       better-sqlite3 建表与迁移             │
                    │  search   联网搜索 / 网页抓取                   │
                    └──────────────────────┬────────────────────────┘
                                           ▼
                    ┌───────────────────────────────────────────────┐
                    │  src/office-server/（Express + SSE 广播）       │
                    │  http.listen(18791, '127.0.0.1')（仅本机回环）   │
                    │  响应 /api/* 与 /auth/*，SSE 按会话广播事件      │
                    │  静态托管 dist/web（Vite 构建的 React 前端）     │
                    └──────────────────────┬────────────────────────┘
                                           ▼
                        浏览器访问 http://127.0.0.1:18791（同源访问）
```

> **设计要点**：MiniClaw 的"能力"全部在 `office-server`（Express + SSE）和
> `src/office-web`（React）里，通过 `Gateway` 事件总线连接。前端即浏览器页面，
> 与后端同源访问，无需任何跨域/原生壳支持。生产态由 Express 直接托管 `dist/web`。

### 目录结构

```
MiniClaw/
├─ scripts/
│  ├─ build.js              # 构建脚本（Vite 前端 → dist/web + tsc 后端 → dist/）
│  └─ dev-server.ts         # Web 服务形态启动入口（Node 20）
├─ src/
│  ├─ office-server/        # Express + SSE 广播（API 服务，端口 18791）
│  │  ├─ index.ts
│  │  └─ routes/api.ts
│  ├─ office-web/           # React 前端（Vite，构建到 dist/web）
│  │  └─ src/pages/ChatPage.tsx   # 对话页 + Trace 面板 + 工具调用卡片
│  ├─ core/                 # 业务逻辑核心
│  │  ├─ gateway/           # 事件总线 + 对话编排（emit token/step/trace-*）
│  │  ├─ agent/             # LLM 调用（埋 llm.completion span）
│  │  ├─ adapter/           # OpenAI 兼容适配（含 include_usage）
│  │  ├─ trace/             # 简易调用链 Tracer/Trace/Span
│  │  ├─ search/            # 联网搜索 / 网页抓取
│  │  ├─ preview.ts         # artifact 预览（iframe sandbox 分级）
│  │  └─ db.ts              # better-sqlite3 封装 + 建表
│  └─ shared/               # 前后端共享类型
├─ docs/
│  ├─ SSE-CONTRACT.md       # SSE / HTTP 接口契约
│  └─ ARCHITECTURE.md       # 架构深读
└─ package.json
```

---

## 二、快速开始

### 1. 安装依赖

```bash
# 根目录（API / 核心依赖，含 better-sqlite3）
npm install
# 前端依赖
cd src/office-web && npm install && cd ../..
```

### 2. 配置 AI 服务商

MiniClaw 通过 OpenAI 兼容协议对接任意大模型。首次启动后在设置页添加服务商：

- `type`: `openai`
- `baseUrl`: 如 `https://api.openai.com/v1` 或自建网关
- `apiKey` / `defaultModel`: 按服务商填写

数据库表 `providers` 持久化；也可直接看 `GET /api/providers`。

### 3. 运行

```bash
npm run web:dev
# 或分别起：
#   API:     tsx scripts/dev-server.ts          (端口 18791)
#   前端:    cd src/office-web && vite --host   (端口 5173)
```

- **开发态**：浏览器打开 `http://localhost:5173/`（Vite HMR，API 经 proxy 转发到 18791）。
- **生产态**：`npm run build` 后执行 `tsx scripts/dev-server.ts`，浏览器访问
  `http://127.0.0.1:18791`。

> Web 形态用本机 Node 20 运行 `dev-server.ts`，与已安装的 `better-sqlite3`（Node 20 / ABI 115）
> 匹配，**无需任何原生模块重编译**即可获得全部能力。

---

## 三、已落地的功能特性（即"效果"）

| 特性 | 说明 | 关键实现 |
|------|------|---------|
| **流式输出** | 模型边生成边渲染，非一次性返回 | `gateway` 逐片 emit `token`，前端 SSE 累积 |
| **连接可用性反馈** | 连接绿点 + 45s 看门狗；失败红框 + 重试按钮 | `chat-error` 事件 + 前端失败态 UI |
| **消息工具条** | 回答后支持复制 / 朗读 / 分享 | `MessageActions` 组件 |
| **Trace 调用瀑布** | 实时展现一次请求的 Span 树（根 chat → LLM / 工具 / 流式） | `trace-start` / `trace-span` / `trace` 增量事件；头部 Trace 图标；点击 Span 展开详情；落库 `traces`/`spans` |
| **工具调用提示** | 对话流内实时显示"正在联网搜索 / 抓取网页"卡片，配合流式输出 | `step` 事件（running → done），可展开看输入/结果；同时埋入 Trace 的 `tool.call` span |

> 工具调用由模型在回复中写入 `[SEARCH:关键词]` / `[FETCH:url]` 标记触发；若模型判断无需联网则不出卡片（模型行为，非 bug）。

---

## 四、已知限制

1. **Token 计数**：依赖服务商在流式响应中返回 `usage`。部分网关即便请求了
   `stream_options:{include_usage:true}` 也不返回，此时 Trace 中 token 显示为 `0+0`（provider 限制，非 bug）。
2. **SSE 无前端自动重连**：预览面板若断流需手动刷新（计划补前端重连兜底）。
3. **历史 Trace 列表**：当前仅支持"最新一次 + SSE 实时回看"，会话内多请求切换回看尚未做。
4. **仅本机访问**：后端绑定 `127.0.0.1`，未开放局域网/公网访问；如需远程需自行调整
   `office-server` 绑定与 `originCheck` 白名单。

---

## 五、相关文档

- [`docs/SSE-CONTRACT.md`](docs/SSE-CONTRACT.md) — SSE 事件与 HTTP 接口契约（前端对接核心）
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 架构深读、数据层、事件总线