import { BrowserWindow, ipcMain, type WebContents } from 'electron';
import { IpcChannel } from '@shared/ipc.js';
import type { OpenSessionResult, SshTarget } from '@shared/types.js';
import { SessionManager } from '../sessions/manager.js';

/**
 * One SessionManager per renderer. The renderer is sandboxed, so every argument
 * arriving here is untrusted and shape-checked before use.
 */
const managers = new Map<number, SessionManager>();

function managerFor(sender: WebContents): SessionManager {
  let manager = managers.get(sender.id);
  if (!manager) {
    manager = new SessionManager(sender);
    managers.set(sender.id, manager);
    sender.once('destroyed', () => {
      manager?.closeAll();
      managers.delete(sender.id);
    });
  }
  return manager;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function parseTarget(raw: unknown): SshTarget {
  const target = raw as SshTarget;
  requireString(target?.address, 'address');
  requireString(target?.auth?.username, 'username');
  if (typeof target.port !== 'number' || target.port < 1 || target.port > 65535) {
    throw new Error('port must be between 1 and 65535');
  }
  if (!['password', 'key', 'prompt'].includes(target.auth?.kind)) {
    throw new Error('unsupported auth kind');
  }
  return { ...target, name: target.name || target.address };
}

export function registerIpc(): void {
  ipcMain.handle(IpcChannel.sessionOpenSsh, (event, raw): OpenSessionResult => {
    const sessionId = managerFor(event.sender).openSsh(parseTarget(raw));
    return { sessionId };
  });

  ipcMain.handle(IpcChannel.sessionWrite, (event, sessionId: unknown, data: unknown) => {
    managerFor(event.sender).write(requireString(sessionId, 'sessionId'), String(data ?? ''));
  });

  ipcMain.handle(
    IpcChannel.sessionResize,
    (event, sessionId: unknown, cols: unknown, rows: unknown) => {
      if (typeof cols !== 'number' || typeof rows !== 'number') return;
      managerFor(event.sender).resize(
        requireString(sessionId, 'sessionId'),
        Math.max(1, Math.floor(cols)),
        Math.max(1, Math.floor(rows)),
      );
    },
  );

  ipcMain.handle(IpcChannel.sessionClose, (event, sessionId: unknown) => {
    managerFor(event.sender).close(requireString(sessionId, 'sessionId'));
  });

  ipcMain.handle(IpcChannel.hostKeyRespond, (event, promptId: unknown, accepted: unknown) => {
    managerFor(event.sender).respondHostKey(
      requireString(promptId, 'promptId'),
      accepted === true,
    );
  });

  ipcMain.handle(IpcChannel.authRespond, (event, promptId: unknown, responses: unknown) => {
    const values = Array.isArray(responses) ? responses.map((value) => String(value)) : null;
    managerFor(event.sender).respondAuth(requireString(promptId, 'promptId'), values);
  });

  ipcMain.handle(IpcChannel.platformInfo, () => ({ platform: process.platform }));

  ipcMain.handle(IpcChannel.windowMinimize, (event) =>
    BrowserWindow.fromWebContents(event.sender)?.minimize(),
  );

  ipcMain.handle(IpcChannel.windowToggleMaximize, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });

  ipcMain.handle(IpcChannel.windowClose, (event) =>
    BrowserWindow.fromWebContents(event.sender)?.close(),
  );
}

export function closeAllSessions(): void {
  for (const manager of managers.values()) manager.closeAll();
  managers.clear();
}
