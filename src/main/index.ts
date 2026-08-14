import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, app, shell } from 'electron';
import { closeAllSessions, registerIpc } from './ipc/index.js';

const dirname = fileURLToPath(new URL('.', import.meta.url));
const isMac = process.platform === 'darwin';

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: '#0A0A0B',
    // §6.1 — hiddenInset on macOS, a matching custom title bar elsewhere.
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } }
      : { frame: false }),
    ...(isMac ? { vibrancy: 'sidebar' as const } : {}),
    webPreferences: {
      preload: join(dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (devServer) {
    void window.loadURL(devServer);
  } else {
    void window.loadFile(join(dirname, '../renderer/index.html'));
  }

  return window;
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('before-quit', () => {
  closeAllSessions();
});
