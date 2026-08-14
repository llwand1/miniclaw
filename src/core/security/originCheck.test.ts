import { describe, it, expect } from 'vitest';
import { originCheck, corsWhitelist } from './originCheck';

// 极简 express 中间件上下文 mock
function ctx(overrides: { method?: string; origin?: string; referer?: string } = {}) {
  const req: any = {
    method: overrides.method || 'GET',
    headers: {},
    ...overrides,
  };
  if (overrides.origin !== undefined) req.headers.origin = overrides.origin;
  if (overrides.referer !== undefined) req.headers.referer = overrides.referer;
  const res: any = {
    statusCode: 0,
    status(c: number) { this.statusCode = c; return this; },
    json() { return this; },
  };
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  return { req, res, next, getNextCalled: () => nextCalled, getStatus: () => res.statusCode };
}

describe('security/originCheck', () => {
  it('SEC-08 GET 无 Origin/Referer 放行(curl 等)', () => {
    const c = ctx({ method: 'GET' });
    originCheck(c.req, c.res, c.next);
    expect(c.getNextCalled()).toBe(true);
  });

  it('SEC-08 GET 本地 Origin(localhost/127.0.0.1)放行', () => {
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:18791']) {
      const c = ctx({ method: 'GET', origin });
      originCheck(c.req, c.res, c.next);
      expect(c.getNextCalled()).toBe(true);
    }
  });

  it('SEC-08 恶意 Origin 拒绝(GET 带 Origin 校验)', () => {
    const c = ctx({ method: 'GET', origin: 'http://evil.com' });
    originCheck(c.req, c.res, c.next);
    expect(c.getNextCalled()).toBe(false);
    expect(c.getStatus()).toBe(403);
  });

  it('SEC-08 恶意 Referer 拒绝', () => {
    const c = ctx({ method: 'GET', referer: 'http://evil.com/page' });
    originCheck(c.req, c.res, c.next);
    expect(c.getNextCalled()).toBe(false);
    expect(c.getStatus()).toBe(403);
  });

  it('SEC-09 写操作(POST)无 Origin 强制拒绝', () => {
    const c = ctx({ method: 'POST' });
    originCheck(c.req, c.res, c.next);
    expect(c.getNextCalled()).toBe(false);
    expect(c.getStatus()).toBe(403);
  });

  it('SEC-09 写操作恶意 Origin 拒绝、本地 Origin 放行', () => {
    const bad = ctx({ method: 'POST', origin: 'http://evil.com' });
    originCheck(bad.req, bad.res, bad.next);
    expect(bad.getNextCalled()).toBe(false);

    const good = ctx({ method: 'POST', origin: 'http://127.0.0.1:18791' });
    originCheck(good.req, good.res, good.next);
    expect(good.getNextCalled()).toBe(true);
  });

  it('corsWhitelist:本地放行、外部拒绝、无 Origin 同源放行', () => {
    // 无 Origin(同源/服务端内部调用)→ 放行
    corsWhitelist(undefined, (err, allow) => { expect(err).toBeNull(); expect(allow).toBe(true); });
    // 本地开发端口 → 放行
    corsWhitelist('http://127.0.0.1:5173', (err, allow) => { expect(err).toBeNull(); expect(allow).toBe(true); });
    corsWhitelist('http://localhost:5173', (err, allow) => { expect(err).toBeNull(); expect(allow).toBe(true); });
    // 外部恶意来源 → 显式拒绝(allow=false,不抛错;真正的 403 由 originCheck 中间件给)
    corsWhitelist('http://evil.com', (err, allow) => { expect(err).toBeNull(); expect(allow).toBe(false); });
    // 非法 URL(无法解析)→ 同样拒绝
    corsWhitelist('not-a-url', (err, allow) => { expect(err).toBeNull(); expect(allow).toBe(false); });
  });
});
