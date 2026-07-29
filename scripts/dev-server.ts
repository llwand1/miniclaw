import { Gateway } from '../src/core/gateway';
import { createServer } from '../src/office-server';
import { createLogger } from '../src/core/logger';
import path from 'node:path';

const log = createLogger('server');

async function main() {
  const PORT = parseInt(process.env.PORT || '18791', 10);
  log.info('Starting MiniClaw...');

  const gateway = new Gateway();
  await gateway.start();

  const webPath = path.resolve(__dirname, '..', 'dist', 'web');
  createServer(gateway, webPath);

  log.info(`Server ready at http://127.0.0.1:${PORT}`);
}

main().catch(err => { console.error('Failed:', err); process.exit(1); });
