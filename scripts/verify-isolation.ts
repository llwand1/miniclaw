// 验证 studentbuddy「多轮对话隔离」修复：同一会话的 B/C 类记忆不外泄到其它会话，
// 而 A 类（长期画像）仍全局共享。直接调用 Gateway 内真实的 retrieveMemories 私有方法。
import path from 'node:path';
import os from 'node:os';

// 必须在首次 getDb() 之前设置独立临时库，避免污染真实数据
process.env.DATA_DIR = path.join(os.tmpdir(), 'studentbuddy-iso-' + Date.now());

async function main() {
  const { getDb } = await import('../src/core/gateway/db');
  const { Gateway } = await import('../src/core/gateway');

  const db = getDb();
  // 造三条记忆：A 会话的 B 类、B 会话自己的 B 类、全局 A 类（无归属）
  db.prepare('INSERT INTO memories (content,category,importance,source,session_id) VALUES (?,?,?,?,?)')
    .run('A会话的近期关注', 'B', 0.6, 'session-A', 'session-A');
  db.prepare('INSERT INTO memories (content,category,importance,source,session_id) VALUES (?,?,?,?,?)')
    .run('B会话自己的近期关注', 'B', 0.6, 'session-B', 'session-B');
  db.prepare('INSERT INTO memories (content,category,importance,source,session_id) VALUES (?,?,?,?,?)')
    .run('全局长期画像', 'A', 0.9, null, null);

  const gw: any = new Gateway();
  const forB = gw.retrieveMemories('随便什么 query', 'session-B');
  const forA = gw.retrieveMemories('随便什么 query', 'session-A');

  const bSeesA = forB.some((m: any) => m.content === 'A会话的近期关注');
  const aSeesA = forA.some((m: any) => m.content === 'A会话的近期关注');
  const bSeesOwn = forB.some((m: any) => m.content === 'B会话自己的近期关注');
  const bothSeeProfile = forB.some((m: any) => m.content === '全局长期画像') &&
                         forA.some((m: any) => m.content === '全局长期画像');

  const checks: [string, boolean][] = [
    ['会话B 不应看到 会话A 的近期关注（隔离）', !bSeesA],
    ['会话A 应看到自己的近期关注', aSeesA],
    ['会话B 应看到自己的近期关注', bSeesOwn],
    ['A类长期画像对两会话均可见（全局共享）', bothSeeProfile],
  ];

  let ok = true;
  for (const [name, pass] of checks) {
    console.log(`${pass ? '✓' : '✗'} ${name}`);
    if (!pass) ok = false;
  }
  console.log(ok ? '\nRESULT: PASS —— 多会话记忆已隔离' : '\nRESULT: FAIL');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
