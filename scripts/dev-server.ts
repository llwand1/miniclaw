import { Gateway } from '../src/core/gateway';
import { createServer } from '../src/office-server';
import { createLogger } from '../src/core/logger';
import { previewService } from '../src/core/preview';
import path from 'node:path';

const log = createLogger('server');

async function main() {
  const PORT = parseInt(process.env.PORT || '18791', 10);
  log.info('Starting studentbuddy...');

  const gateway = new Gateway();
  await gateway.start();

  // 预览索引：AI 产出的 artifact 进入服务端内存索引，供 /api/preview/* 与前端刷新回灌。
  // （原 Electron 主进程里的订阅，纯 Web 模式下迁移到 dev-server 入口）
  gateway.on('artifact', (e: any) => {
    if (e && e.artifact) previewService.upsertArtifact(e.artifact);
  });

  const webPath = path.resolve(__dirname, '..', 'dist', 'web');
  createServer(gateway, webPath);

  log.info(`Server ready at http://127.0.0.1:${PORT}`);
}

main().catch(err => { console.error('Failed:', err); process.exit(1); });
