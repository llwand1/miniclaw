import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // 测试用临时 DATA_DIR,避免污染真实库;各测试文件自行设置
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks', // 隔离进程,防止全局 DB/环境变量串扰
    poolOptions: { forks: { singleFork: false } },
  },
});
