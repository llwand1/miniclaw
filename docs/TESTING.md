# studentbuddy 测试指南

> 更新日期：2026-08-14
> 范围：`src/**/*.test.ts` 共 14 个测试文件（含本次新增 `scheduler.test.ts`）

---

## 一、运行方式

| 命令 | 说明 |
|------|------|
| `npm test` | 一次性跑完全部测试（CI 用） |
| `npm run test:watch` | 监听模式，改代码自动重跑 |
| `npm run test:daily` | 每日冒烟（`scripts/daily-test.cjs`） |
| `npx vitest run <file>` | 单文件调试，如 `npx vitest run src/core/gateway/scheduler.test.ts` |

配置见 `vitest.config.ts`：`include` 只收 `src/**/*.test.ts`，`pool: 'forks'` 隔离进程防 DB/环境变量串扰，`testTimeout: 30000`。

> 注意：项目目标 Node 20（`engines`）。若用 Node 22 跑，better-sqlite3 可能出现 ABI 不匹配导致的失败，非代码缺陷。

---

## 二、测试文件清单

| 文件 | 用例前缀 | 覆盖点 |
|------|---------|--------|
| `src/core/adapter/anthropic.test.ts` | ADP- | Anthropic 适配器流解析 |
| `src/core/adapter/openai-compatible.test.ts` | ADP- | OpenAI 兼容 SSE 流、reasoning、usage、tool_calls 增量合并、abort/超时、错误码 |
| `src/core/artifact.test.ts` | ART- | artifact 识别（html/markdown/code）、幂等去重、渲染与转义 |
| `src/core/fs-tools.test.ts` | FST- | 路径解析、越界拒绝、目录树、读写/编辑/撤销/搜索、二进制识别、截断 |
| `src/core/gateway/db.test.ts` | DBS- | 建表结构、WAL/外键、种子行、密钥迁移幂等、时间戳列格式与更新语义 |
| `src/core/gateway/gateway.test.ts` | GWY- | 集成：空库种子、流式落库、联网搜索工具、超时/中止、用量兜底、原生 tool loop |
| `src/core/gateway/parsers.test.ts` | — | 工具标记解析（[FS]/[SEARCH]/[TODO]/[MEM] 等）、todo 追踪器 |
| `src/core/gateway/scheduler.test.ts` | SCH- | **定时任务日期逻辑**（2026-08-14 新增）：nextRunAt、once/interval 创建、改期/改频、启停、删除软删、列表排序、模型解析 |
| `src/core/security/approval.test.ts` | SEC- | 审批闸门：需审批/自动批准、批准/拒绝、越界拒绝、重复处理、**跨日统计**（新增） |
| `src/core/security/crypto.test.ts` | SEC- | AES-GCM 加解密往返、幂等、随机 IV、损坏密文容错、DPAPI 迁移 |
| `src/core/security/originCheck.test.ts` | SEC- | DNS rebinding 防护的 Origin 校验 |
| `src/core/security/policy.test.ts` | SEC- | 路径黑名单/扩展名白名单/写入限流策略 |
| `src/core/upload.test.ts` | — | 上传保存、黑名单扩展名、txt/pdf 提取、二进制识别 |
| `src/office-server/routes/quiz.test.ts` | — | 题库 CRUD/批量导入/删除、做题统计聚合、created_at 断言、来源字段清洗 |

---

## 三、测试数据规范（本次强化重点）

### 1. 时间戳断言
所有含时间的表列（`created_at` / `updated_at` / `ts` / `next_run_at` / `last_run_at`）落库均为 **SQLite 时间串**格式：

```
YYYY-MM-DD HH:MM:SS   （UTC，秒级精度）
```

对应正则：`/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/`

- `db.test.ts`（DBS-04/05）：断言 created_at/updated_at/ts 格式，且消息时间 ≥ 会话创建时间（单调递增）；UPDATE 后 updated_at 刷新、created_at 不变。
- `quiz.test.ts`：断言题库列表返回的 `created_at` 为 SQLite 时间串。
- `approval.test.ts`（SEC-13 新增）：**跨日统计**——昨日（`Date.now() - 24h` 构造）处理的审批项不计入 `approvedToday`/`rejectedToday`，防止统计口径混入历史数据。

### 2. 日期化业务数据
- `scheduler.test.ts` 用真实日期场景：`2026-08-15T08:30:00Z`（once 精确时刻）、`2026-09-01T12:00:00Z`（跨月改期）、interval 断言与基准时间的分钟差值（`sqlToEpoch` 换算）。
- `quiz.test.ts` 的 `QUIZ_DATA` 带日期化标题与来源：`2026-08 数学单元测验`、web 来源带 `url`、ai 来源无 `url`（验证 `sanitizeSource` 清洗行为）。
- 定时任务归属会话标题带 `【定时】` 前缀，作为可断言的产品行为。

### 3. 时间可控性
- 需要固定"现在"的用例使用 `vi.useFakeTimers()` + `vi.setSystemTime(base)`，结束后 `finally { vi.useRealTimers() }` 恢复，避免真实时钟漂移导致断言不稳定。
- 秒级时间戳刷新类断言（DBS-05）用 `setTimeout(1100)` 等待跨秒，确保可复现。

---

## 四、隔离策略

每个测试文件在 `vi.hoisted()` 里 `fs.mkdtempSync` 生成独立临时目录并设为 `process.env.DATA_DIR`，保证：
- 不连真实库（`~/studentbuddy-data` 等）
- 文件工具不碰真实工作区（`setWorkspaceRoot` 指向独立 tmp）
- 进程级隔离（`pool: 'forks'`）防模块级单例串扰

新增测试文件必须沿用此模式，否则会污染真实数据。

---

## 五、本次变更（2026-08-14）

1. **新增 `scheduler.test.ts`（SCH-01~07）**：定时任务是纯日期逻辑（`nextRunAt` 推进、once/interval 切换、next_run_at 重算），此前完全无测试，本次补齐 8 个用例。
2. **`approval.test.ts` 新增 SEC-13 跨日统计**：验证 `getApprovalStats` 的"今日"口径不混入昨日数据。
3. **`db.test.ts` 新增 DBS-04/05**：时间戳列格式与更新语义。
4. **`quiz.test.ts` 精细化**：日期化题库数据 + `created_at` 格式断言 + 来源字段清洗断言。
