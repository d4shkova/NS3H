import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, app, shell } from 'electron';
import { closeAllSessions, flushAllLogs, initialiseLock, registerIpc } from './ipc/index.js';
import { dhShim } from './ssh/ssh2.js';
import { flushWithDeadline } from './lifecycle.js';

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
  if (dhShim.patched.length > 0) {
    console.log(
      `NS3H: restored DH groups this runtime is missing — ${dhShim.patched.join(', ')}`,
    );
  }
  registerIpc();
  // Read before the window exists: the app has to come up already sealed, rather than
  // painting itself and then deciding.
  void initialiseLock().finally(() => createWindow());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

let quitting = false;

/**
 * §5.3 — logs flush on session close and on app quit. Quit is deferred until the
 * buffers are on disk, otherwise the last couple of seconds of a session are lost.
 *
 * The second `quit` is scheduled with `setImmediate` rather than called outright. This
 * handler has just cancelled a termination the OS is still processing, and a `quit`
 * raised from inside that dispatch is dropped — on macOS the app then simply stays up,
 * and the user has to ask a second time to get the quit that already ran its flush.
 * Handing it to the next turn of the loop lets the cancellation finish first, so one
 * Quit is one quit.
 */
app.on('before-quit', (event) => {
  if (quitting) return; // the flush has already run — let this one through
  event.preventDefault();
  quitting = true;
  void flushWithDeadline(flushAllLogs).then(() => {
    closeAllSessions();
    setImmediate(() => app.quit());
  });
});
