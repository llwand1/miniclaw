# SSE / HTTP 接口契约

本文档定义 studentbuddy（本地 Web 服务形态）前后端之间的 **稳定接口契约**。studentbuddy 是单一形态的
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

**断线重连（2026-08-13 新增，Last-Event-ID 语义）：**

- 每个入缓冲的事件都带**单调递增序号** `seq`（按会话独立计数）；新一轮对话（sendText 后）从 1 重新计数。
- 客户端重连时携带**已收到的最大序号**（URL 参数 `?since=<n>`，兼容 `Last-Event-ID` 头），
  服务端只回放 `seq > since` 的事件——既补齐断线期间错过的事件，又不重复回放已消费的
  token 正文/思考（避免把整段回复 append 两遍导致重复或冲掉）。
- 前端为**手动重连**（不依赖 EventSource 原生自动重连，因其无法携带 since）：断线后指数退避
  （1s→2s→4s…封顶 15s）重建连接；重连成功（onopen）后拉 `GET /api/sessions/:id/live` 快照，
  对齐 replace 类状态（steps/todos；reasoning 靠 since 增量回放补齐，避免与快照重复累计）。
- 心跳兼做**断链探测**：对已销毁（`destroyed`/`writableEnded`）或写入失败的连接从订阅集合移除，
  防止僵尸连接持续接收事件造成资源泄漏。
- 前端在**切换会话**与**发送新消息**时重置已收序号为 0（服务端新一轮序号从 1 重新计数，
  否则旧序号会让 since 跳过新轮全部事件）。

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
| `step` | 后端→前端 | 工具调用步骤(原生 function call 或文本标记触发的搜索/抓取/文件操作)；**运行中同一 stepId 可多次推送**（`progress` 逐项上报） | `sessionId`, `step:Step` |
| `todos` | 后端→前端 | 任务规划清单（WorkBuddy 式）；规划阶段解析 `[TODO:...]` 下发，随工具步骤完成**逐个打勾**（每次变化整体推送全量） | `sessionId`, `todos:Todo[]` |
| `ping` | 后端→前端 | 心跳保活 | — |

> **todos 事件（任务清单实时打勾）**：后端权威驱动，前端按下发 `status` 渲染，不再靠 step 数索引硬推。
> - 初始下发：全 `pending`（首项视为 `running`）；随后 search/fetch/fs（含原生工具循环）每完成一步 `complete()` 推送一次，该项变 `done`、下一项变 `running`。
> - 收尾：正常完成 `finishAll()` 全部打勾；用户停止 `stop()` 当前项标 `stopped`；`chat-error` / `token.done` 前端兜底更新。
> - 双路径都覆盖：文本标记路径（chat-flow.ts）与原生 function call 路径（native-tools.ts 首轮探测文本解析 `[TODO:...]`）。

> `step` 走"缓冲 + 广播"，兼容竞态。
> 前端增量合并函数：`mergeStep()`（见 `src/office-web/src/components/chat/useChatPane.ts`）。
> `reasoning` 与 `token` 均为**无 done 的增量块**：`reasoning` 独立累积到思考块，`token` 累积到正文；
> 两者都由 `token.done=true` 或 `chat-error` 收尾。

> **超时与失败兜底（重要契约）**：`STREAM_TIMEOUT_MS=120s`，超过则服务端 `AbortController.abort()`。
> - **用户主动停止**（`/api/chat/abort`）：标记 `userAbortedSessions`，catch 分支**静默**只发 `token.done` 复位 `busy`，不报错。
> - **服务端超时 / 真实异常**：catch 分支统一 `emit('chat-error',{sessionId,error})` 并 `throw`；**绝不再静默发空 `done`**——否则前端只收到空回复、用户完全无感知（早期 60s 超时即此 bug）。
> 前端 `chat-error` 处理器把末条 assistant 设为 `请求失败：${error}` 错误红气泡并清 `busy`；POST `/api/chat` 的 500 响应用 `hadErrorRef` 去重，避免与 SSE 重复弹出。

---

## 3. Step（工具调用步骤）数据模型

```ts
{
  stepId: string;
  name: string;              // "联网搜索" / "抓取网页" / "读取文件" / "编辑文件" ...
  tool: 'search' | 'fetch' | 'fs';
  status: 'running' | 'done';   // 失败统一经 chat-error 上报
  args: string[];            // 搜索词数组 / URL 数组 / 工具参数 JSON 字符串
  progress?: {               // 运行中逐项进度（搜索/抓取每完成一个关键词/URL 上报一次）
    done: number;            // 已完成数量
    total: number;           // 总数
    item: string;            // 当前完成项（关键词 / URL）
    ok: boolean;             // 该项是否成功
    summary: string;         // 该项结果摘要，如 "已搜索「苹果」：3 条结果"
  };
  result?: string;           // 运行中为进度提示文本；完成时为**完整**结果（不再截断 200 字符）
  startedAt: number;
  endedAt?: number;
}
```

- **触发方式(双路径并行)**：
  1. **原生 function call(2026-08-12 新增,优先)**：网关 `runNativeToolLoop` 带 `tools` 参数请求模型(OpenAI function calling / Anthropic tools),模型返回 `tool_calls` 时由 `executeNativeToolCall` 逐个执行并 emit `step`。工具清单:`search_web` / `fetch_page`(联网搜索启用时)+ `fs_read` / `fs_grep` / `fs_edit` / `fs_write`(工作区配置时);`tool` 字段取 `search` / `fetch` / `fs`。
  2. **文本标记(兼容回退)**：模型在回复中写入 `[SEARCH:关键词]` / `[FETCH:url]` / `[FS]...[/FS]` 标记(由 `gateway.extractSearchQueries` / `extractUrls` / `extractFsTools` 解析),当模型未走原生工具时触发。
- 一次请求可能先后产生多个 step(搜索、抓取、文件读写,各自独立 stepId);原生工具循环最多 `MAX_TOOL_TURNS=8` 轮,超限发 `chat-error`。
- 前端在助手回答**之前**渲染过程面板（`ProcessPanel` 内嵌 `ToolCallStream` 流式卡片）：
  运行中展示「具体在干什么」（解析 args 为友好动作行，多个关键词/URL 逐项打勾 + 进度条），
  完成 ✓ + 耗时，可展开看**完整**参数与结果；`tool='fs'` 用文件图标,`search`/`fetch` 用搜索/地球图标。

---

## 4. HTTP API 一览

基础前缀 `/api`。完整实现见 `src/office-server/routes/api.ts`。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/chat` | 发起对话，`body:{text,sessionId?,source?,temperature?,providerId?,model?,resend?}`，返回 `{sessionId}` |
| GET | `/stream?sessionId=` | SSE 实时通道（见上） |
| GET | `/status` | `{ hasProviders }` |
| GET/PUT | `/model` | 当前选中模型 / 切换 |
| GET | `/model-options` | 可选模型列表 |
| POST | `/chat/abort` | 中止对话 `{sessionId}` |
| GET/POST/PUT/DELETE | `/sessions` `/sessions/:id` | 会话 CRUD（含软删除、置顶、重命名、恢复） |
| POST | `/sessions/:id/share` | 导出 Markdown + 分享令牌 `studentbuddy://share/<token>`（令牌无协议消费者，待评估） |
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

## 5. 前端消费约定

- 所有 API 走**相对路径** `/api/...`（生产态与 Express 同源；开发态经 Vite dev `proxy` 转发到 :18791）。
- 单例 `EventSource('/api/stream?sessionId=' + sid)` 接收全部事件；按 `type` 分发到上文各处理器。
- 增量事件（`step`）用函数式 `setState` 合并（`mergeStep`），保证实时绘制无闪烁。

---

## 6. 前端渲染映射（事件 → 组件）

后端只管"切事件"，前端按 `type` 渲染富组件——这是 studentbuddy 能复刻 WorkBuddy / OpenCode 级别回复效果的关键。
映射集中在 `src/office-web/src/pages/ChatPage.tsx`，消费点见各 `if (d.type === ...)` 分支。

| 事件 | 累积状态 | 组件 | 渲染行为 |
|------|---------|------|---------|
| `reasoning` | `reasoning:string`（函数式 `setReasoning(prev => prev + content)`）| `ReasoningBlock`（可折叠「思考过程」）| 实时增长；仅当 `reasoning.length>0` 时显示；`token.done` 后停止增长 |
| `step` | `steps:any[]`（函数式合并 `mergeStep()`）| `ProcessPanel` → `ToolCallStream` 流式工具卡片 | 过程式：运行中逐项打勾 + 进度条 + 参数预览，`done` ✓ + 耗时，展开看完整 args/result |
| `artifact` | 由独立 `previewClient` 经通配订阅 `*` 处理（主通道 `return` 跳过）| 文件视图 `mc-filecard` + 预览面板 | 与 `PreviewPage` 同源；新 artifact 进入文件列表，可点开预览 |

> **预览 iframe 的 sandbox 按来源分级**（见 `src/shared/preview-types.ts` `previewSandbox`）：
> - 可信来源（`ai` 本地 AI 产出 / `user` 用户编写）：`allow-scripts allow-same-origin allow-forms allow-popups allow-modals`——localStorage、同源 fetch、表单、弹窗、alert 均可用，对齐 WorkBuddy 预览能力。
> - 不可信来源（`import` 外部导入）：回退到 `allow-scripts`（不透明源），防止恶意 HTML 与 studentbuddy 主程序同源后读取 app 的 localStorage（OAuth / API key 等）。
| `token` | `m.content:string`（本轮完整正文）| `MarkdownStream` | **真正的流式 Markdown**：按块（标题/段落/代码/列表/表格/引用）切分，稳定 key 防重播，仅新增块淡入 + 末尾 caret；代码块轻量语法高亮（`.mc-kw`/`.mc-ty`）|
| `chat-error` | `m.error` | 错误条 | 终止本轮，思考块/工具卡片冻结，正文区显示错误 |

### 渲染层契约要点（对接正式版必须保持）

1. **正文是 Markdown，不是纯文本**。任何新前端形态（Web / 移动壳）都必须用 Markdown 渲染器消费 `token.content`，否则会退化成"哑"纯文本流。
2. **稳定 key 分块**：流式累积文本时按"块"而非"行"做稳定 key，已渲染块内容不变则不重绘，避免重播闪烁。studentbuddy 的 `MarkdownStream` 用块索引做 key。
3. **增量合并**：`reasoning`/`token` 用函数式 setState 累积；`step` 用专用 merge 函数保证实时无闪烁。
4. **artifact 走独立通道**：`previewClient` 通配订阅所有会话，与主聊天 SSE 解耦，保证预览面板在任意会话/分栏下都能收到。

---

## 7. 文件工程能力（对标 OpenCode / Cursor 的「工作区」）

studentbuddy 通过「沙箱文件工具 + 工作区浏览器」补齐 AI IDE 的文件读写/编辑/搜索能力。所有文件操作被严格限制在配置的**工作区根目录**内（`fs-tools.resolveSafe` 拦截一切越界），杜绝 AI 伪造请求或越权访问。

### 7.1 文件工具循环（gateway 侧）

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

### 7.2 SSE 事件：`file-change`

| 字段 | 含义 |
|------|------|
| `sessionId` | 触发变更的会话 |
| `change.action` | `read` / `edit` / `write` |
| `change.path` | 相对工作区的路径 |
| `change.changeId` | 撤销凭证（仅 `edit`/`write` 有，`read` 为 `""`）|
| `change.revertible` | 是否可撤销（`edit`/`write` 为 `true`）|
| `change.old` / `change.new` | 编辑/写入前后的全文（前端做行 diff）|

广播机制：同时推给对应会话与通配订阅者（`sessionId=*`），前端 `WorkspaceExplorer` 跨会话订阅，变更卡片在任意分栏都能出现。

### 7.3 文件系统 REST API（`/api/fs/*` + `/api/workspace`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/workspace` | 返回当前工作区根目录（绝对路径或 `null`）|
| PUT | `/api/workspace` | 设置工作区根目录（`{path}`），校验目录存在后落库 |
| GET | `/api/fs/tree?path=` | 列举目录（跳过 `node_modules`/`.git`，目录在前文件在后）|
| GET | `/api/fs/read?path=` | 读取文件（超 240KB 截断，二进制识别）|
| GET | `/api/fs/grep?pattern=&path=` | 正则文本搜索（限 80 处、跳过二进制）|
| POST | `/api/fs/revert` | 撤销某次变更（`{changeId}`，调用 `fsRevert`）|

### 7.4 前端消费

- **工作区浏览器**（`WorkspaceExplorer`）：在文件视图的「工作区」子页。顶部可设置/更改工作区根目录；下方可展开目录树、点击读取文件预览、把文件提示「发给对话」；底部「文件变更」卡片展示 AI 改动的行级 diff 与「撤销」按钮。
- 变更卡片的 diff 由前端 `lcsLineDiff` 计算（红=删除、绿=新增），撤销走 `/api/fs/revert` 后从列表移除。
- 「发给对话」通过 `window` 自定义事件 `mc-send` 把文件提示推给当前聚焦的对话窗格，AI 收到后会用 `[FS]` 工具自行读取/修改。
