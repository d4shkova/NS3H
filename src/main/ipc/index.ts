import { BrowserWindow, clipboard, dialog, ipcMain, shell, type WebContents } from 'electron';
import { IpcChannel } from '@shared/ipc.js';
import type { OpenSessionResult, SshTarget } from '@shared/types.js';
import type { Credential, Folder, Host, Settings } from '@shared/config.js';
import { SessionManager } from '../sessions/manager.js';
import { secrets } from '../secrets/index.js';
import { ConfigService, newConfigId, type CredentialSecrets } from '../store/index.js';
import { normaliseCredential } from '../store/credentials.js';
import { normaliseFolder, normaliseHost } from '../store/hosts.js';
import { LogService } from '../logging/index.js';
import { listSerialPorts } from '../serial/ports.js';
import { listLogFolders, listLogSessions } from '../logging/browse.js';
import { LogReader } from '../logging/reader.js';
import { listLocal } from '../ssh/sftp.js';
import { randomBytes } from 'node:crypto';
import type { SerialConfig } from '@shared/config.js';
import type { TelnetTargetInput } from '@shared/types.js';
import type { TransferEvent } from '@shared/transfer.js';

type TransferStatus = TransferEvent['status'];

let configService: ConfigService | null = null;

function config(): ConfigService {
  configService ??= new ConfigService(secrets());
  return configService;
}

/** The renderer is sandboxed, so anything it sends is normalised before it is stored. */
function parseSecrets(raw: unknown): CredentialSecrets | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const input = raw as CredentialSecrets;
  const result: CredentialSecrets = {};
  if (typeof input.password === 'string') result.password = input.password;
  if (typeof input.passphrase === 'string') result.passphrase = input.passphrase;
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * One SessionManager per renderer. The renderer is sandboxed, so every argument
 * arriving here is untrusted and shape-checked before use.
 */
const managers = new Map<number, SessionManager>();

let reader: LogReader | null = null;

function logReader(): LogReader {
  reader ??= new LogReader(async () => (await config().snapshot()).settings.logDirectory);
  return reader;
}

function logService(): LogService {
  return new LogService(async () => (await config().snapshot()).settings);
}

function managerFor(sender: WebContents): SessionManager {
  let manager = managers.get(sender.id);
  if (!manager) {
    manager = new SessionManager(sender, logService());
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

function parseTelnetTarget(raw: unknown): TelnetTargetInput {
  const target = raw as TelnetTargetInput;
  requireString(target?.address, 'address');
  if (typeof target.port !== 'number' || target.port < 1 || target.port > 65535) {
    throw new Error('port must be between 1 and 65535');
  }
  return { name: target.name || target.address, address: target.address, port: target.port };
}

const PARITY = ['none', 'even', 'odd'];
const FLOW = ['none', 'rtscts', 'xonxoff'];

function parseSerialConfig(raw: unknown): SerialConfig {
  const config = raw as SerialConfig;
  requireString(config?.path, 'path');
  if (typeof config.baudRate !== 'number' || config.baudRate <= 0) {
    throw new Error('baudRate must be a positive number');
  }
  return {
    path: config.path,
    baudRate: config.baudRate,
    dataBits: config.dataBits === 7 ? 7 : 8,
    parity: PARITY.includes(config.parity) ? config.parity : 'none',
    stopBits: config.stopBits === 2 ? 2 : 1,
    flowControl: FLOW.includes(config.flowControl) ? config.flowControl : 'none',
  } as SerialConfig;
}

/** New records arrive without an id; minting them in main keeps ids off the renderer. */
function withId(raw: unknown, prefix: 'hst' | 'crd' | 'fld'): unknown {
  if (typeof raw !== 'object' || raw === null) throw new Error('expected an object');
  const record = raw as { id?: unknown };
  return typeof record.id === 'string' && record.id.length > 0
    ? raw
    : { ...record, id: newConfigId(prefix) };
}

function registerConfigIpc(): void {
  ipcMain.handle(IpcChannel.configLoad, () => config().snapshot());

  ipcMain.handle(IpcChannel.configSaveHost, (_event, raw: unknown, rawSecrets: unknown) => {
    const host = normaliseHost(withId(raw, 'hst'));
    if (!host) throw new Error('host is missing an id');
    return config().saveHost(host as Host, parseSecrets(rawSecrets));
  });

  ipcMain.handle(IpcChannel.configDeleteHost, (_event, hostId: unknown) =>
    config().deleteHost(requireString(hostId, 'hostId')),
  );

  ipcMain.handle(IpcChannel.configSaveFolder, (_event, raw: unknown) => {
    const folder = normaliseFolder(withId(raw, 'fld'));
    if (!folder) throw new Error('folder is missing an id');
    return config().saveFolder(folder as Folder);
  });

  ipcMain.handle(IpcChannel.configDeleteFolder, (_event, folderId: unknown) =>
    config().deleteFolder(requireString(folderId, 'folderId')),
  );

  ipcMain.handle(
    IpcChannel.configSaveCredential,
    (_event, raw: unknown, rawSecrets: unknown) => {
      const credential = normaliseCredential(withId(raw, 'crd'));
      if (!credential) throw new Error('credential is missing an id');
      return config().saveCredential(credential as Credential, parseSecrets(rawSecrets));
    },
  );

  ipcMain.handle(IpcChannel.configDeleteCredential, (_event, credentialId: unknown) =>
    config().deleteCredential(requireString(credentialId, 'credentialId')),
  );

  ipcMain.handle(IpcChannel.configChooseLogDirectory, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await (window
      ? dialog.showOpenDialog(window, {
          title: 'Choose a directory for session logs',
          properties: ['openDirectory', 'createDirectory'],
        })
      : dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] }));

    if (result.canceled || result.filePaths.length === 0) return null;
    return config().saveSettings({ logDirectory: result.filePaths[0] });
  });

  ipcMain.handle(IpcChannel.revealPath, (_event, path: unknown) => {
    shell.showItemInFolder(requireString(path, 'path'));
  });

  // Clipboard goes through main: a sandboxed renderer's navigator.clipboard is
  // gated on focus and permissions, and a terminal paste cannot depend on that.
  ipcMain.handle(IpcChannel.clipboardRead, () => clipboard.readText());

  ipcMain.handle(IpcChannel.clipboardWrite, (_event, text: unknown) => {
    if (typeof text !== 'string' || text.length === 0) return;
    clipboard.writeText(text);
  });

  ipcMain.handle(IpcChannel.logsListFolders, async () =>
    listLogFolders((await config().snapshot()).settings.logDirectory),
  );

  ipcMain.handle(IpcChannel.logsListSessions, async (_event, folder: unknown) =>
    listLogSessions(
      (await config().snapshot()).settings.logDirectory,
      requireString(folder, 'folder'),
    ),
  );

  ipcMain.handle(IpcChannel.logsOpen, (_event, path: unknown) =>
    logReader().open(requireString(path, 'path')),
  );

  ipcMain.handle(
    IpcChannel.logsLines,
    (_event, path: unknown, start: unknown, count: unknown) =>
      logReader().lines(
        requireString(path, 'path'),
        typeof start === 'number' ? start : 0,
        typeof count === 'number' ? Math.min(count, 5000) : 200,
      ),
  );

  ipcMain.handle(IpcChannel.logsSearch, (_event, path: unknown, query: unknown) =>
    logReader().search(requireString(path, 'path'), typeof query === 'string' ? query : ''),
  );

  ipcMain.handle(IpcChannel.logsClose, (_event, path: unknown) => {
    logReader().close(requireString(path, 'path'));
  });

  ipcMain.handle(IpcChannel.configSaveSettings, (_event, patch: unknown) => {
    if (typeof patch !== 'object' || patch === null) throw new Error('settings patch must be an object');
    return config().saveSettings(patch as Partial<Settings>);
  });
}

export function registerIpc(): void {
  registerConfigIpc();

  ipcMain.handle(IpcChannel.sessionOpenHost, async (event, hostId: unknown) => {
    const resolved = await config().resolveHost(requireString(hostId, 'hostId'));
    if (!resolved) throw new Error('That host could not be opened.');
    const manager = managerFor(event.sender);
    const options = { hostId: resolved.hostId, logging: resolved.logging };

    switch (resolved.kind) {
      case 'ssh':
        return { sessionId: manager.openSsh(resolved.target, options) };
      case 'telnet':
        return { sessionId: manager.openTelnet(resolved.target, options) };
      case 'serial':
        return { sessionId: manager.openSerial(resolved.name, resolved.serial, options) };
    }
  });

  ipcMain.handle(IpcChannel.sessionOpenSsh, (event, raw): OpenSessionResult => {
    // Quick connections have no saved host, so they always log, under `_quick/`.
    const sessionId = managerFor(event.sender).openSsh(parseTarget(raw), { logging: true });
    return { sessionId };
  });

  ipcMain.handle(IpcChannel.sessionOpenTelnet, (event, raw): OpenSessionResult => {
    const sessionId = managerFor(event.sender).openTelnet(parseTelnetTarget(raw), {
      logging: true,
    });
    return { sessionId };
  });

  ipcMain.handle(
    IpcChannel.sessionOpenSerial,
    (event, name: unknown, raw: unknown): OpenSessionResult => {
      const config = parseSerialConfig(raw);
      const sessionId = managerFor(event.sender).openSerial(
        typeof name === 'string' && name ? name : config.path,
        config,
        { logging: true },
      );
      return { sessionId };
    },
  );

  ipcMain.handle(IpcChannel.sessionSendBreak, (event, sessionId: unknown) =>
    managerFor(event.sender).sendBreak(requireString(sessionId, 'sessionId')),
  );

  ipcMain.handle(IpcChannel.serialList, () => listSerialPorts());

  ipcMain.handle(IpcChannel.transferRemoteHome, (event, sessionId: unknown) =>
    managerFor(event.sender).remoteHome(requireString(sessionId, 'sessionId')),
  );

  ipcMain.handle(IpcChannel.transferRemoteList, (event, sessionId: unknown, path: unknown) =>
    managerFor(event.sender).remoteList(
      requireString(sessionId, 'sessionId'),
      requireString(path, 'path'),
    ),
  );

  ipcMain.handle(IpcChannel.transferLocalList, (_event, path: unknown) =>
    listLocal(typeof path === 'string' ? path : ''),
  );

  ipcMain.handle(IpcChannel.transferChooseDirectory, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(window!, {
      title: 'Choose a directory',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle(
    IpcChannel.transferDownload,
    async (event, sessionId: unknown, remotePath: unknown, localDirectory: unknown) => {
      const id = `trf_${randomBytes(3).toString('hex')}`;
      const session = requireString(sessionId, 'sessionId');
      const remote = requireString(remotePath, 'remotePath');
      const name = remote.split('/').pop() ?? remote;

      // Progress is a stream of events rather than a resolved promise, so a large
      // file shows movement instead of appearing to hang.
      const report = (transferred: number, total: number, status: TransferStatus, detail?: string) =>
        event.sender.isDestroyed() ||
        event.sender.send(IpcChannel.transferProgress, {
          id, sessionId: session, direction: 'download', name, transferred, total, status, detail,
        });

      try {
        const target = await managerFor(event.sender).download(
          session, remote, requireString(localDirectory, 'localDirectory'),
          ({ transferred, total }) => report(transferred, total, 'running'),
        );
        report(1, 1, 'done');
        return target;
      } catch (error) {
        report(0, 1, 'error', (error as Error).message);
        throw error;
      }
    },
  );

  ipcMain.handle(
    IpcChannel.transferUpload,
    async (event, sessionId: unknown, localPath: unknown, remoteDirectory: unknown) => {
      const id = `trf_${randomBytes(3).toString('hex')}`;
      const session = requireString(sessionId, 'sessionId');
      const local = requireString(localPath, 'localPath');
      const name = local.split(/[\\/]/).pop() ?? local;

      const report = (transferred: number, total: number, status: TransferStatus, detail?: string) =>
        event.sender.isDestroyed() ||
        event.sender.send(IpcChannel.transferProgress, {
          id, sessionId: session, direction: 'upload', name, transferred, total, status, detail,
        });

      try {
        const target = await managerFor(event.sender).upload(
          session, local, requireString(remoteDirectory, 'remoteDirectory'),
          ({ transferred, total }) => report(transferred, total, 'running'),
        );
        report(1, 1, 'done');
        return target;
      } catch (error) {
        report(0, 1, 'error', (error as Error).message);
        throw error;
      }
    },
  );

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

/** Gives every open log a chance to flush before the process goes away (§5.3). */
export async function flushAllLogs(): Promise<void> {
  await Promise.all([...managers.values()].map((manager) => manager.flushAll()));
}
