import { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, WebContentsView } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { Gateway } from '../core/gateway';
import { createServer } from '../office-server';
import { createLogger } from '../core/logger';
import { previewService } from '../core/preview';

const cliLog = createLogger('cli');

let mainWindow: BrowserWindow | null = null;
let floatingWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const gateway = new Gateway();

// 预览子系统订阅：AI 产出的 artifact 进入主进程内存索引，供原生视图按需渲染。
// 与渲染进程通过 SSE 收到的同一事件解耦，互不依赖。
gateway.on('artifact', (e: any) => {
  if (e && e.artifact) previewService.upsertArtifact(e.artifact);
});

const PORT = parseInt(process.env.PORT || '18791', 10);
const SERVER_URL = `http://127.0.0.1:${PORT}`;

function getWebPath(): string {
  const isDev = !app.isPackaged;
  if (isDev) {
    return path.resolve(__dirname, '..', 'web');
  }
  return path.join(process.resourcesPath, 'web');
}

function waitForServer(url: string, retries = 30): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = (attempt: number) => {
      if (attempt > retries) return reject(new Error('Server did not start in time'));
      fetch(url).then(() => resolve()).catch(() => setTimeout(() => check(attempt + 1), 200));
    };
    check(0);
  });
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 680,
    title: 'MiniClaw',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // 实时预览：把预览服务绑定到主窗口
  const previewDir = path.join(app.getPath('userData'), 'preview');
  fs.mkdirSync(previewDir, { recursive: true });
  previewService.init({ WebContentsView, previewDir });
  previewService.setWindow(mainWindow);

  mainWindow.loadURL(SERVER_URL);
  mainWindow.on('closed', () => {
    previewService.hideAll();
    previewService.setWindow(null);
    mainWindow = null;
  });
}

function createFloatingWindow(): void {
  const { screen } = require('electron');
  const displaySize = screen.getPrimaryDisplay().workAreaSize;
  floatingWindow = new BrowserWindow({
    width: 48,
    height: 48,
    x: displaySize.width - 100,
    y: Math.floor(displaySize.height / 2),
    alwaysOnTop: true,
    skipTaskbar: true,
    frame: false,
    transparent: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  floatingWindow.loadURL(`${SERVER_URL}/floating.html`);
  floatingWindow.on('closed', () => { floatingWindow = null; });
}

function createTray(): void {
  tray = new Tray(nativeImage.createEmpty());
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => { if (mainWindow) mainWindow.show(); else createMainWindow(); } },
    { type: 'separator' },
    { label: '退出', click: () => { app.quit(); } },
  ]);
  tray.setToolTip('MiniClaw');
  tray.setContextMenu(contextMenu);
}

async function bootstrap(): Promise<void> {
  cliLog.info('Starting MiniClaw...');

  await gateway.start();

  const server = createServer(gateway, getWebPath());

  await app.whenReady();

  createMainWindow();
  createFloatingWindow();
  createTray();

  globalShortcut.register('CommandOrControl+Space', () => {
    if (floatingWindow) {
      floatingWindow.isVisible() ? floatingWindow.hide() : floatingWindow.show();
    }
  });

  cliLog.info('MiniClaw is running');
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', async () => {
  globalShortcut.unregisterAll();
  await gateway.stop();
  cliLog.info('MiniClaw stopped');
});

bootstrap().catch(err => {
  console.error('Failed to start MiniClaw:', err);
  process.exit(1);
});
