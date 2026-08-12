# SSE / HTTP 接口契约

本文档定义 MiniClaw（本地 Web 服务形态）前后端之间的 **稳定接口契约**。MiniClaw 是单一形态的
本地 Web 应用——前端（React）与后端（Express + SSE）同源运行，任何新增前后端交互都应先在此
登记，再实现，保持契约收敛。

---

## 1. SSE 实时通道

**端点：** `GET /api/stream?sessionId=<sid>`

- `Content-Type: text/event-stream`，每条消息格式：`data: <JSON>\n\n`。
- `sessionId` 为空或 `*` 时进入**通配订阅**（预览面板用，接收所有会话事件）。
- **连接建立时回放缓冲**：若该会话本轮已有事件（解决"先发请求、后连 SSE"的竞态丢包），
  先回放缓冲，再接入实时推送；本轮已终止（`done` / `chat-error`）则回放后清空缓冲。
- 心跳：每 15s 发送 `{ "type": "ping" }` 保活；缓冲有 60s TTL 兜底回收。

---

## 2. 事件类型（Gateway emit → office-server 广播 → 前端消费）

| type | 方向 | 含义 | 关键字段 |
|------|------|------|---------|
| `token` | 后端→前端 | 流式文本片段（**正文**，按 Markdown 渲染）| `sessionId`, `content`, `done:boolean`（done=true 表示本轮结束） |
| `reasoning` | 后端→前端 | 流式思考/推理片段（可折叠「思考过程」块）| `sessionId`, `content`（无 done，靠 token.done 收尾）|
| `artifact` | 后端→前端 | AI 产出的可预览 artifact | `sessionId`, `artifact` |

> **artifact 现已「流式增量提取 + 幂等去重」**（见 `src/core/artifact.ts` + `src/core/gateway/index.ts`）：
> - Gateway 在 token 流过程中（围栏/标签边界出现时）即增量调用 `publishArtifacts`，而非等整段回复结束才提取——预览面板随 AI 输出**实时**浮现。
> - artifact.id 由内容指纹生成，`publishArtifacts` 按会话维护已发 id 集合，重复提取自动跳过，保证同一份内容只预览一次。
> - 提取范围已放宽：```` ```html/markup/htm/svg ````、无语言标记但内容像 HTML 的围栏块、以及整段裸 `<!doctype html>…</html>` 文档，都会被识别成 html artifact（不再要求必须写 ```` ```html ```` 围栏）。
| `chat-error` | 后端→前端 | 本轮失败 | `sessionId`, `error:string` |
| `trace-start` | 后端→前端 | 请求开始（含未结束的 root span） | `sessionId`, `trace:TracePayload` |
| `trace-span` | 后端→前端 | 单个 Span 起/止增量 | `sessionId`, `phase:'start'\|'end'`, `span:Span` |
| `trace` | 后端→前端 | 请求结束的完整 Trace（校准用） | `sessionId`, `...TracePayload` |
| `step` | 后端→前端 | 工具调用步骤（搜索/抓取） | `sessionId`, `step:Step` |
| `ping` | 后端→前端 | 心跳保活 | — |

> `trace-start` / `trace-span` / `step` 均走"缓冲 + 广播"，兼容竞态；`trace`（完整校准）仅广播不缓冲。
> 前端增量合并函数：`mergeTraceSpan()`、`mergeStep()`（见 `src/office-web/src/pages/ChatPage.tsx`）。
> `reasoning` 与 `token` 均为**无 done 的增量块**：`reasoning` 独立累积到思考块，`token` 累积到正文；
> 两者都由 `token.done=true` 或 `chat-error` 收尾。

> **超时与失败兜底（重要契约）**：`STREAM_TIMEOUT_MS=120s`，超过则服务端 `AbortController.abort()`。
> - **用户主动停止**（`/api/chat/abort`）：标记 `userAbortedSessions`，catch 分支**静默**只发 `token.done` 复位 `busy`，不报错。
> - **服务端超时 / 真实异常**：catch 分支统一 `emit('chat-error',{sessionId,error})` 并 `throw`；**绝不再静默发空 `done`**——否则前端只收到空回复、用户完全无感知（早期 60s 超时即此 bug）。
> 前端 `chat-error` 处理器把末条 assistant 设为 `请求失败：${error}` 错误红气泡并清 `busy`；POST `/api/chat` 的 500 响应用 `hadErrorRef` 去重，避免与 SSE 重复弹出。

---

## 3. Trace / Span 数据模型

### TracePayload

```ts
{
  traceId: string;
  sessionId: string | null;
  rootName: string;          // 通常为 "chat"
  startedAt: number;         // epoch ms
  endedAt: number | null;
  status: 'ok' | 'error';
  spans: Span[];
}
```

### Span

```ts
{
  spanId: string;
  parentSpanId: string | null;
  traceId: string;
  name: string;              // 如 "chat" / "llm.completion" / "tool.call"
  kind: 'root' | 'llm' | 'tool' | 'db' | 'stream';
  startedAt: number;
  endedAt: number | null;    // 未结束为 null（前端显示"进行中"）
  status: 'ok' | 'error';
  attrs: Record<string, any>;
}
```

### kind 语义

| kind | 颜色 | 含义 | attrs 示例 |
|------|------|------|-----------|
| `root` | 蓝 | 本次请求根节点（chat） | `{ model, provider }` |
| `llm` | 紫 | 一次 LLM 调用 | `{ model, provider, promptTokens, completionTokens }` |
| `tool` | 橙 | 工具调用（搜索/抓取） | `{ tool:'search'\|'fetch', queries\|urls }` |
| `db` | 绿 | 数据库操作 | — |
| `stream` | 青 | 流式输出阶段 | — |

> 失败段（`status==='error'`）前端标红。
> `trace-span` 的 `phase` 为 `start` 时 `endedAt` 为 null；为 `end` 时补全 `endedAt`、`status`、`attrs`。

---

## 4. Step（工具调用步骤）数据模型

```ts
{
  stepId: string;
  name: string;              // "联网搜索" / "抓取网页"
  tool: 'search' | 'fetch';
  status: 'running' | 'done';   // 失败统一经 chat-error 上报
  args: string[];            // 搜索词数组 或 URL 数组
  result?: string;           // 完成摘要，如 "已搜索 2 个关键词"
  startedAt: number;
  endedAt?: number;
}
```

- 触发条件：模型在回复中写入 `[SEARCH:关键词]` / `[FETCH:url]` 标记（由 `gateway.extractSearchQueries` / `extractUrls` 解析）。
- 一次请求可能先后产生 `search` 与 `fetch` 两个 step（各自独立 stepId）。
- 前端在助手回答**之前**渲染 `ToolSteps` 卡片：spinner → ✓，可展开看 `args` / `result`。

---

## 5. HTTP API 一览

基础前缀 `/api`。完整实现见 `src/office-server/routes/api.ts`。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/chat` | 发起对话，`body:{text,sessionId?,source?,temperature?,providerId?,model?,resend?}`，返回 `{sessionId}` |
| GET | `/stream?sessionId=` | SSE 实时通道（见上） |
| GET | `/traces?sessionId=` | 回查该会话最近 20 条 Trace（含嵌套 spans） — **待删除**（前端已走 SSE 实时通道，无人调用） |
| GET | `/status` | `{ hasProviders }` |
| GET/PUT | `/model` | 当前选中模型 / 切换 |
| GET | `/model-options` | 可选模型列表 |
| POST | `/chat/abort` | 中止对话 `{sessionId}` |
| GET/POST/PUT/DELETE | `/sessions` `/sessions/:id` | 会话 CRUD（含软删除、置顶、重命名、恢复） |
| POST | `/sessions/:id/share` | 导出 Markdown + 分享令牌 `miniclaw://share/<token>`（令牌无协议消费者，待评估） |
| GET/POST/PUT/DELETE | `/providers` `/providers/:id` | 服务商 CRUD、启用切换、连通性测试 |
| GET/PUT | `/search-config` | 联网搜索开关与 provider（duckduckgo / custom） |
| GET | `/search?q=` | 手动搜索（测试用） — **待删除**（无前端调用） |
| GET/PUT | `/window-state/:name` | 窗口位置持久化 |
| GET/POST/PUT/DELETE | `/preview/*` | artifact 预览子系统（其中 `POST /preview/url` **待删除**，`loadUrl` 无消费方） |
| GET/PUT/POST | `/auth/github/*` | GitHub OAuth（其中 `GET /auth/github/token` **待删除**，无前端调用） |
| GET/PUT | `/api/workspace` | 工作区根目录读取与设置（沙箱边界） |
| GET/POST | `/api/fs/tree` `/api/fs/read` `/api/fs/revert` | 文件系统工具：列目录、读文件、撤销变更 |
| GET | `/api/fs/grep` `/api/fs/changes` | 文本搜索 / 变更列表 — **待删除**（无前端调用） |

---

## 6. 前端消费约定

- 所有 API 走**相对路径** `/api/...`（生产态与 Express 同源；开发态经 Vite dev `proxy` 转发到 :18791）。
- 单例 `EventSource('/api/stream?sessionId=' + sid)` 接收全部事件；按 `type` 分发到上文各处理器。
- 增量事件（`trace-start`/`trace-span`/`step`）用 `useReducer`/函数式 `setState` 合并，保证实时绘制无闪烁。
- 请求开始（`trace-start`）默认自动展开 Trace 面板；用户手动关闭后不再自动弹（头部 Trace 图标仍可随时点开）。

---

## 7. 前端渲染映射（事件 → 组件）

后端只管"切事件"，前端按 `type` 渲染富组件——这是 MiniClaw 能复刻 WorkBuddy / OpenCode 级别回复效果的关键。
映射集中在 `src/office-web/src/pages/ChatPage.tsx`，消费点见各 `if (d.type === ...)` 分支。

| 事件 | 累积状态 | 组件 | 渲染行为 |
|------|---------|------|---------|
| `reasoning` | `reasoning:string`（函数式 `setReasoning(prev => prev + content)`）| `ReasoningBlock`（可折叠「思考过程」）| 实时增长；仅当 `reasoning.length>0` 时显示；`token.done` 后停止增长 |
| `step` | `steps:any[]`（函数式合并 `mergeStep()`）| `ToolSteps` 卡片 | 渲染在正文**之前**：`running` 显示 spinner，`done` 显示 ✓，可展开看 `args`/`result` |
| `artifact` | 由独立 `previewClient` 经通配订阅 `*` 处理（主通道 `return` 跳过）| 文件视图 `mc-filecard` + 预览面板 | 与 `PreviewPage` 同源；新 artifact 进入文件列表，可点开预览 |

> **预览 iframe 的 sandbox 按来源分级**（见 `src/shared/preview-types.ts` `previewSandbox`）：
> - 可信来源（`ai` 本地 AI 产出 / `user` 用户编写）：`allow-scripts allow-same-origin allow-forms allow-popups allow-modals`——localStorage、同源 fetch、表单、弹窗、alert 均可用，对齐 WorkBuddy 预览能力。
> - 不可信来源（`import` 外部导入）：回退到 `allow-scripts`（不透明源），防止恶意 HTML 与 MiniClaw 主程序同源后读取 app 的 localStorage（OAuth / API key 等）。
| `token` | `m.content:string`（本轮完整正文）| `MarkdownStream` | **真正的流式 Markdown**：按块（标题/段落/代码/列表/表格/引用）切分，稳定 key 防重播，仅新增块淡入 + 末尾 caret；代码块轻量语法高亮（`.mc-kw`/`.mc-ty`）|
| `trace-start`/`trace-span`/`trace` | `trace` 状态（函数式 `mergeTraceSpan()`）| Trace 面板 | 请求开始自动展开，标出各 Span 耗时/状态，失败段标红 |
| `chat-error` | `m.error` | 错误条 | 终止本轮，思考块/工具卡片冻结，正文区显示错误 |

### 渲染层契约要点（对接正式版必须保持）

1. **正文是 Markdown，不是纯文本**。任何新前端形态（Web / 移动壳）都必须用 Markdown 渲染器消费 `token.content`，否则会退化成"哑"纯文本流。
2. **稳定 key 分块**：流式累积文本时按"块"而非"行"做稳定 key，已渲染块内容不变则不重绘，避免重播闪烁。MiniClaw 的 `MarkdownStream` 用块索引做 key。
3. **增量合并**：`reasoning`/`token` 用函数式 setState 累积；`step`/`trace` 用专用 merge 函数保证实时无闪烁。
4. **artifact 走独立通道**：`previewClient` 通配订阅所有会话，与主聊天 SSE 解耦，保证预览面板在任意会话/分栏下都能收到。

---

## 8. 文件工程能力（对标 OpenCode / Cursor 的「工作区」）

MiniClaw 通过「沙箱文件工具 + 工作区浏览器」补齐 AI IDE 的文件读写/编辑/搜索能力。所有文件操作被严格限制在配置的**工作区根目录**内（`fs-tools.resolveSafe` 拦截一切越界），杜绝 AI 伪造请求或越权访问。

### 8.1 文件工具循环（gateway 侧）

当「联网搜索启用 **或** 已配置工作区」时，走统一的**规划阶段 → 执行工具 → 最终阶段**：

1. **规划阶段**：`generateOnce` 让模型产出可能包含 `[SEARCH:]` / `[FETCH:]` / `[FS]` 工具块的内容。
2. **解析工具**：`extractFsTools` 解析 `[FS]...[/FS]` 内的 JSONL（每行一个 JSON 对象）：
   ```json
   {"action":"read","path":"src/app.ts"}
   {"action":"grep","pattern":"function","path":"src"}
   {"action":"edit","path":"src/app.ts","old":"foo","new":"bar","occurrence":"first"}
   {"action":"write","path":"src/app.ts","content":"完整内容"}
   ```
3. **执行工具**：逐个调用 `fsRead / fsGrep / fsEdit / fsWrite`，每次 emit `step`（工具栏卡片）+ `file-change`（驱动变更卡片）；写/编辑操作记录 `changeId` 供撤销。
4. **最终阶段**：把所有工具结果回灌模型，流式 emit 最终回答（与现有搜索分支共用同一套 token/reasoning 落库）。

系统提示词（`buildSystemPrompt`）在检测到工作区时会自动注入上述文件工具说明，模型据此产出 `[FS]` 块而无需前端干预。

### 8.2 SSE 事件：`file-change`

| 字段 | 含义 |
|------|------|
| `sessionId` | 触发变更的会话 |
| `change.action` | `read` / `edit` / `write` |
| `change.path` | 相对工作区的路径 |
| `change.changeId` | 撤销凭证（仅 `edit`/`write` 有，`read` 为 `""`）|
| `change.revertible` | 是否可撤销（`edit`/`write` 为 `true`）|
| `change.old` / `change.new` | 编辑/写入前后的全文（前端做行 diff）|

广播机制：同时推给对应会话与通配订阅者（`sessionId=*`），前端 `WorkspaceExplorer` 跨会话订阅，变更卡片在任意分栏都能出现。

### 8.3 文件系统 REST API（`/api/fs/*` + `/api/workspace`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/workspace` | 返回当前工作区根目录（绝对路径或 `null`）|
| PUT | `/api/workspace` | 设置工作区根目录（`{path}`），校验目录存在后落库 |
| GET | `/api/fs/tree?path=` | 列举目录（跳过 `node_modules`/`.git`，目录在前文件在后）|
| GET | `/api/fs/read?path=` | 读取文件（超 240KB 截断，二进制识别）|
| GET | `/api/fs/grep?pattern=&path=` | 正则文本搜索（限 80 处、跳过二进制）|
| POST | `/api/fs/revert` | 撤销某次变更（`{changeId}`，调用 `fsRevert`）|

### 8.4 前端消费

- **工作区浏览器**（`WorkspaceExplorer`）：在文件视图的「工作区」子页。顶部可设置/更改工作区根目录；下方可展开目录树、点击读取文件预览、把文件提示「发给对话」；底部「文件变更」卡片展示 AI 改动的行级 diff 与「撤销」按钮。
- 变更卡片的 diff 由前端 `lcsLineDiff` 计算（红=删除、绿=新增），撤销走 `/api/fs/revert` 后从列表移除。
- 「发给对话」通过 `window` 自定义事件 `mc-send` 把文件提示推给当前聚焦的对话窗格，AI 收到后会用 `[FS]` 工具自行读取/修改。
