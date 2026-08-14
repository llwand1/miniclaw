// studentbuddy 对话功能全功能大测试(日常化的一部分)
// 空库(临时 DATA_DIR)起 dev-server,遍历对话相关的全部 REST API,
// 验证每个端点返回正确。可反复运行;与 `npm run test:daily` 配套。
// 用法:node scripts/functional-e2e.mjs
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DATA_DIR = path.join(process.env.TEMP || os.tmpdir(), 'studentbuddy-e2e-' + Date.now());
const PORT = 18993;
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name} ${detail}`); }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 本地 mock LLM server:返回 OpenAI 兼容 SSE 流,供 chat 全链路验证
const MOCK_LLM_PORT = 18994;
function startMockLlm() {
  const http = require('node:http');
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const enc = new TextEncoder();
        res.write(enc.encode('data: {"choices":[{"delta":{"content":"你好,这是"},"finish_reason":null}]}\n\n'));
        res.write(enc.encode('data: {"choices":[{"delta":{"content":" mock 回复"},"finish_reason":null}]}\n\n'));
        res.write(enc.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":6}}\n\n'));
        res.write(enc.encode('data: [DONE]\n\n'));
        res.end();
      } else {
        res.writeHead(404).end();
      }
    });
    server.listen(MOCK_LLM_PORT, '127.0.0.1', () => resolve(server));
  });
}

async function get(p, extra = {}) {
  const r = await fetch(BASE + p, { headers: { Origin: ORIGIN, ...extra.headers } });
  let body = null;
  try { body = await r.json(); } catch { body = null; }
  return { status: r.status, body };
}

async function send(method, p, data, extra = {}) {
  const r = await fetch(BASE + p, {
    method,
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...extra.headers },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  let body = null;
  try { body = await r.json(); } catch { body = null; }
  return { status: r.status, body };
}

async function main() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // child / mockLlm 在 finally 中统一清理:任何 return / 异常路径都不泄漏子进程与端口
  let child = null;
  let mockLlm = null;
  try {
  const tsxCli = path.resolve(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
  child = spawn(process.execPath, [tsxCli, 'scripts/dev-server.ts'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATA_DIR, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => log += d);
  child.stderr.on('data', d => log += d);

  let ready = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try { const r = await fetch(`${BASE}/api/status`); if (r.ok) { ready = true; break; } } catch { /* retry */ }
  }
  if (!ready) { console.log('SERVER NOT READY'); console.log(log.slice(-3000)); return 1; }
  mockLlm = await startMockLlm(); // 本地 mock LLM,供 chat 全链路
  console.log(`\n[1/8] 基础状态与种子`);
  {
    const s = await get('/api/status');
    ok('GET /api/status → hasProviders=true', s.status === 200 && s.body.hasProviders === true, JSON.stringify(s.body));
  }
  {
    const db = require(path.resolve(__dirname, '..', 'node_modules', 'better-sqlite3'));
    const dbh = new db(path.join(DATA_DIR, 'studentbuddy.db'));
    const prov = dbh.prepare('SELECT id, name FROM providers').all();
    const agt = dbh.prepare('SELECT id FROM agents').all();
    const tables = dbh.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length;
    dbh.close();
    ok('空库种子:providers 已注入 openai-default', prov.length === 1 && prov[0].id === 'openai-default', JSON.stringify(prov));
    ok('空库种子:agents 已注入 default', agt.length === 1 && agt[0].id === 'default');
    ok('DB 建表:22 张(21 + approval_queue)', tables === 22, `actual=${tables}`);
  }

  console.log(`\n[2/8] 服务商与模型`);
  {
    const s = await get('/api/providers');
    ok('GET /api/providers → 列表含种子', s.status === 200 && Array.isArray(s.body) && s.body.length >= 1);
    // 把种子 provider 指向本地 mock LLM,使 chat 全链路可通
    const seed = (s.body || []).find(p => p.id === 'openai-default');
    if (seed) {
      const seedPut = await send('PUT', `/api/providers/${seed.id}`, {
        type: 'openai', name: 'Mock LLM', baseUrl: `http://127.0.0.1:${MOCK_LLM_PORT}/v1`, apiKey: 'sk-mock', defaultModel: 'mock-model', enabled: true,
      });
      ok('PUT 种子 provider → 指向本地 mock', seedPut.status === 200, `status=${seedPut.status} ${JSON.stringify(seedPut.body)}`);
    }
    const created = await send('POST', '/api/providers', {
      type: 'openai', name: '测试服务商', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-1', defaultModel: 'test-model', enabled: true,
    });
    ok('POST /api/providers → 新建成功', created.status === 200 || created.status === 201, `status=${created.status}`);
    const list = await get('/api/providers');
    const found = (list.body || []).find(p => p.name === '测试服务商');
    ok('POST 后列表可见新服务商', !!found, JSON.stringify(list.body));
    if (found) {
      const upd = await send('PUT', `/api/providers/${found.id}`, {
        type: 'openai', name: '测试服务商2', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-1', defaultModel: 'test-model', enabled: true,
      });
      ok('PUT /api/providers/:id → 重命名成功', upd.status === 200, `status=${upd.status} ${JSON.stringify(upd.body)}`);
      const del = await send('DELETE', `/api/providers/${found.id}`);
      ok('DELETE /api/providers/:id → 删除成功', del.status === 200, `status=${del.status}`);
    }
    const m = await get('/api/model-options');
    ok('GET /api/model-options → 可解析', m.status === 200, `status=${m.status}`);
  }

  console.log(`\n[3/8] 对话主链路(chat + SSE 事件)`);
  {
    // 种子 provider 已指向本地 mock LLM,chat 应真正走通:返回 sessionId + 落库 user/assistant 消息
    const c = await send('POST', '/api/chat', { text: '你好,测试', source: 'main' });
    ok('POST /api/chat → 返回 sessionId', c.status === 200 && typeof c.body?.sessionId === 'string', `status=${c.status} ${JSON.stringify(c.body)}`);
    if (c.body?.sessionId) {
      const sid = c.body.sessionId;
      // 等待流式回复落库(异步,轮询)
      let msgs = [];
      for (let i = 0; i < 20; i++) {
        await sleep(200);
        const one = await get(`/api/sessions/${sid}`);
        msgs = one.body?.messages || [];
        if (msgs.some(m => m.role === 'assistant')) break;
      }
      ok('chat 落库:user + assistant 消息', msgs.some(m => m.role === 'user') && msgs.some(m => m.role === 'assistant'), JSON.stringify(msgs.map(m => m.role)));
      ok('chat 落库:assistant 含 mock 回复', msgs.some(m => m.role === 'assistant' && String(m.content).includes('mock 回复')), JSON.stringify(msgs.map(m => m.content)));
      const sessions = await get('/api/sessions');
      const found = (sessions.body || []).find(s => s.id === sid);
      ok('GET /api/sessions → 会话已落库', !!found);
      const one = await get(`/api/sessions/${sid}`);
      ok('GET /api/sessions/:id → 含消息', one.status === 200 && Array.isArray(one.body?.messages), `status=${one.status}`);
      const rename = await send('PUT', `/api/sessions/${sid}`, { title: '重命名会话' });
      ok('PUT /api/sessions/:id → 重命名成功', rename.status === 200, `status=${rename.status}`);
      const pin = await send('PUT', `/api/sessions/${sid}/pin`, {});
      ok('PUT /api/sessions/:id/pin → 置顶成功', pin.status === 200, `status=${pin.status}`);
      const ctx = await get(`/api/sessions/${sid}/context`);
      ok('GET /api/sessions/:id/context → 上下文估算', ctx.status === 200, `status=${ctx.status}`);
      // 用量统计应已写入(mock 返回了 usage)
      const usage = await get('/api/usage/stats');
      const hasUsage = usage.status === 200 && (usage.body?.totalCompletionTokens > 0 || JSON.stringify(usage.body).includes('6'));
      ok('chat 后 /api/usage/stats → 有用量', hasUsage, JSON.stringify(usage.body));
    }
    const running = await get('/api/running-tasks');
    ok('GET /api/running-tasks → 可解析', running.status === 200, `status=${running.status}`);
  }

  console.log(`\n[4/8] 记忆 / 搜索配置 / 系统提示词`);
  {
    const mem = await get('/api/memories');
    ok('GET /api/memories → 可解析', mem.status === 200 && Array.isArray(mem.body), `status=${mem.status}`);
    const sc = await get('/api/search-config');
    ok('GET /api/search-config → 默认关闭(enabled=0)', sc.status === 200 && Number(sc.body?.enabled) === 0, JSON.stringify(sc.body));
    const scPut = await send('PUT', '/api/search-config', { enabled: true, provider: 'duckduckgo' });
    ok('PUT /api/search-config → 开启搜索', scPut.status === 200, `status=${scPut.status}`);
    const sp = await get('/api/system-prompt');
    ok('GET /api/system-prompt → 可解析', sp.status === 200, `status=${sp.status}`);
    const spPut = await send('PUT', '/api/system-prompt', { content: '你是测试助手' });
    ok('PUT /api/system-prompt → 保存成功', spPut.status === 200, `status=${spPut.status} ${JSON.stringify(spPut.body)}`);
  }

  console.log(`\n[5/8] 技能管理`);
  {
    const list = await get('/api/skills');
    ok('GET /api/skills → 可解析', list.status === 200 && Array.isArray(list.body), `status=${list.status}`);
    const created = await send('POST', '/api/skills', { name: 'test-skill', description: '测试技能', body: '# 测试技能\n\n执行步骤' });
    ok('POST /api/skills → 新建成功', created.status === 200 || created.status === 201, `status=${created.status}`);
    const list2 = await get('/api/skills');
    const found = (list2.body || []).find(s => s.name === 'test-skill');
    ok('POST 后技能可见', !!found);
    if (found) {
      const upd = await send('PUT', `/api/skills/${found.id}`, { description: '更新描述' });
      ok('PUT /api/skills/:id → 更新成功', upd.status === 200, `status=${upd.status}`);
      const del = await send('DELETE', `/api/skills/${found.id}`);
      ok('DELETE /api/skills/:id → 删除成功', del.status === 200, `status=${del.status}`);
    }
  }

  console.log(`\n[6/8] 工作区与文件系统`);
  {
    const ws = await get('/api/workspace');
    ok('GET /api/workspace → 可解析', ws.status === 200, `status=${ws.status}`);
    const wsDir = path.join(DATA_DIR, 'workspace');
    fs.mkdirSync(wsDir, { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'hello.ts'), 'export const x = 1;\n');
    const wsPut = await send('PUT', '/api/workspace', { path: wsDir });
    ok('PUT /api/workspace → 设置工作区', wsPut.status === 200, `status=${wsPut.status} ${JSON.stringify(wsPut.body)}`);
    const tree = await get('/api/fs/tree?path=.');
    ok('GET /api/fs/tree → 列出 hello.ts', tree.status === 200 && JSON.stringify(tree.body).includes('hello.ts'), `status=${tree.status}`);
    const read = await get('/api/fs/read?path=hello.ts');
    ok('GET /api/fs/read → 读文件', read.status === 200 && (read.body?.content || '').includes('export const x'), `status=${read.status}`);
    const grep = await get('/api/fs/grep?pattern=export&path=.');
    ok('GET /api/fs/grep → 命中 export', grep.status === 200 && (grep.body?.matches?.length || 0) >= 1, `status=${grep.status}`);
  }

  console.log(`\n[7/8] 安全子系统(策略 / 审批)`);
  {
    const pol = await get('/api/security/policy');
    ok('GET /api/security/policy → 默认策略', pol.status === 200 && pol.body?.approvalMode === 'require_approval', JSON.stringify(pol.body));
    const polPut = await send('PUT', '/api/security/policy', { writeRatePerMin: 50 });
    ok('PUT /api/security/policy → 更新策略', polPut.status === 200, `status=${polPut.status}`);
    const appr = await get('/api/security/approvals');
    ok('GET /api/security/approvals → 可解析', appr.status === 200 && Array.isArray(appr.body), `status=${appr.status}`);
    const stats = await get('/api/security/stats');
    ok('GET /api/security/stats → 统计可解析', stats.status === 200, `status=${stats.status}`);
  }

  console.log(`\n[8/8] 定时任务 / 用量 / 窗口状态 / Trace`);
  {
    const tasks = await get('/api/tasks');
    ok('GET /api/tasks → 可解析({tasks: []})', tasks.status === 200 && Array.isArray(tasks.body?.tasks), `status=${tasks.status} ${JSON.stringify(tasks.body)}`);
    const t = await send('POST', '/api/tasks', { name: '测试任务', prompt: '汇报状态', mode: 'interval', intervalMinutes: 60 });
    ok('POST /api/tasks → 新建定时任务', t.status === 200 || t.status === 201, `status=${t.status}`);
    const tasks2 = await get('/api/tasks');
    const found = (tasks2.body?.tasks || []).find(x => x.name === '测试任务');
    ok('POST 后定时任务可见', !!found, JSON.stringify(tasks2.body));
    if (found) {
      const del = await send('DELETE', `/api/tasks/${found.id}`);
      ok('DELETE /api/tasks/:id → 删除成功', del.status === 200, `status=${del.status}`);
    }
    const usage = await get('/api/usage/stats');
    ok('GET /api/usage/stats → 可解析', usage.status === 200, `status=${usage.status}`);
    // 注:window-state API 已在并发重构中移除(前端也不再调用,window_state 表属遗留),不再断言
    const traces = await get('/api/traces');
    ok('GET /api/traces → 可解析(可能为空)', traces.status === 200, `status=${traces.status}`);
  }

  console.log(`\n══════════════════════════════`);
  console.log(`  通过 ${pass} / ${pass + fail}`);
  if (fail > 0) {
    console.log('  失败项:');
    for (const f of failures) console.log('    ✗ ' + f);
    console.log('══════════════════════════════');
    return 1;
  }
  console.log('  全功能大测试 ✅ PASS');
  console.log('══════════════════════════════');
  return 0;
  } finally {
    // 任何路径(成功/失败/异常)都清理子进程与 mock LLM,避免端口泄漏
    if (child) { try { child.kill(); } catch { /* ignore */ } }
    if (mockLlm) { try { mockLlm.close(); } catch { /* ignore */ } }
  }
}

main().then(code => process.exit(code)).catch(e => { console.error('E2E FAILED:', e); process.exit(1); });
