import pino from 'pino';
import path from 'node:path';
import fs from 'node:fs';

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const DATA_DIR = process.env.DATA_DIR || path.join(process.env.APPDATA || '', 'MiniClaw');

let loggerInstance: pino.Logger;

export function getLogger(): pino.Logger {
  if (loggerInstance) return loggerInstance;

  const logDir = path.join(DATA_DIR, 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const logFile = path.join(logDir, `miniclaw-${new Date().toISOString().slice(0, 10)}.log`);

  const transport = pino.transport({
    targets: [
      {
        target: 'pino-pretty',
        level: LOG_LEVEL,
        options: { colorize: true, translateTime: 'HH:MM:ss' },
      },
      {
        target: 'pino/file',
        level: LOG_LEVEL,
        options: { destination: logFile, mkdir: true },
      },
    ],
  });

  loggerInstance = pino(
    { level: LOG_LEVEL, name: 'miniclaw' },
    transport,
  );

  return loggerInstance;
}

export function createLogger(namespace: string): pino.Logger {
  return getLogger().child({ namespace });
}

export const logger = getLogger();
