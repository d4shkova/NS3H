import { BrowserWindow, clipboard, dialog, ipcMain, shell, type WebContents } from 'electron';
import { IpcChannel } from '@shared/ipc.js';
import type { OpenSessionResult, SshTarget } from '@shared/types.js';
import type { Credential, Folder, Host, Settings } from '@shared/config.js';
import { SessionManager } from '../sessions/manager.js';
import { secrets } from '../secrets/index.js';
import { ConfigService, newConfigId, type CredentialSecrets } from '../store/index.js';
import { LockStore } from '../lock/store.js';
import { configPath } from '../store/paths.js';
import { normaliseCredential } from '../store/credentials.js';
import { normaliseFolder, normaliseHost } from '../store/hosts.js';
import { LogService } from '../logging/index.js';
import { listSerialPorts } from '../serial/ports.js';
import { listLogFolders, listLogSessions } from '../logging/browse.js';
import { LogReader } from '../logging/reader.js';
import { listLocal } from '../ssh/sftp.js';
import { TransferHub, isTransferConnectionId } from '../files/hub.js';
import type { FileTransport } from '../files/transport.js';
import { TransferService, bundleFileName, configFileName } from '../transfer/index.js';
import { randomBytes } from 'node:crypto';
import type { SerialConfig } from '@shared/config.js';
import type { TelnetTargetInput } from '@shared/types.js';
import type { FileTargetInput, TransferEvent } from '@shared/transfer.js';

type TransferStatus = TransferEvent['status'];

let configService: ConfigService | null = null;

function config(): ConfigService {
  configService ??= new ConfigService(secrets());
  return configService;
}

let lockStore: LockStore | null = null;

function lock(): LockStore {
  lockStore ??= new LockStore(configPath('lock.json'));
  return lockStore;
}

/**
 * Whether the app is sealed. Set once at startup from whether a launch password exists,
 * and cleared only by a correct password or by the reset.
 *
 * It is held in main rather than in the interface on purpose: a lock the renderer decides
 * for itself is a lock that a renderer bug can decide against, and the point of it is to
 * stand between a person at the keyboard and the stored passwords.
 */
let locked = false;

/**
 * The only channels served while locked: what the lock screen needs to paint itself, get
 * out of the way, or start over. Everything else — every secret, every session, every
 * change to the configuration — is refused until the password is in.
 */
const UNLOCKED_ONLY_EXEMPT = new Set<string>([
  IpcChannel.lockStatus,
  IpcChannel.lockUnlock,
  IpcChannel.lockReset,
  IpcChannel.platformInfo,
  IpcChannel.windowMinimize,
  IpcChannel.windowToggleMaximize,
  IpcChannel.windowClose,
]);

/** Registers a handler that refuses to run while the app is locked. */
function handle(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: never[]) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (locked && !UNLOCKED_ONLY_EXEMPT.has(channel)) {
      throw new Error('NS3H is locked.');
    }
    return (handler as (event: Electron.IpcMainInvokeEvent, ...rest: unknown[]) => unknown)(
      event,
      ...args,
    );
  });
}

/** Read at startup, before the window is shown, so the app opens straight into the lock. */
export async function initialiseLock(): Promise<void> {
  locked = await lock().enabled();
}

function registerLockIpc(): void {
  handle(IpcChannel.lockStatus, async () => ({
    enabled: await lock().enabled(),
    locked,
    // The lock screen has no access to settings, and an unthemed lock screen would be the
    // first thing the user sees.
    theme: (await config().snapshot()).settings.theme,
  }));

  handle(IpcChannel.lockUnlock, async (_event, password: unknown) => {
    if (typeof password !== 'string') return false;
    const ok = await lock().verify(password);
    if (ok) locked = false;
    return ok;
  });

  handle(IpcChannel.lockSet, async (_event, password: unknown, current: unknown) => {
    // Changing or clearing an existing password needs the current one: an unlocked app
    // left alone is exactly when someone would quietly turn this off.
    if (await lock().enabled()) {
      if (typeof current !== 'string' || !(await lock().verify(current))) {
        return { ok: false, reason: 'That is not the current launch password.' };
      }
    }

    if (password === null) {
      await lock().clear();
      return { ok: true };
    }
    if (typeof password !== 'string' || password.length < 8) {
      return { ok: false, reason: 'A launch password must be at least 8 characters.' };
    }
    await lock().set(password);
    return { ok: true };
  });

  handle(IpcChannel.lockReset, async () => {
    // Deliberately destructive, and the only way past a forgotten password: everything
    // that could authenticate goes, the hosts stay, and the lock itself is removed so the
    // user can set a new one.
    const snapshot = await config().resetCredentials();
    await lock().clear();
    locked = false;
    return snapshot;
  });
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

let transfers: TransferService | null = null;

function transferService(): TransferService {
  transfers ??= new TransferService(config(), secrets());
  return transfers;
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
      hubs.get(sender.id)?.closeAll();
      hubs.delete(sender.id);
    });
  }
  return manager;
}

/** Standalone transfer connections, one hub per renderer alongside its manager. */
const hubs = new Map<number, TransferHub>();

function hubFor(sender: WebContents): TransferHub {
  let hub = hubs.get(sender.id);
  if (!hub) {
    // The manager is what raises host-key and password prompts, so the hub borrows it.
    hub = new TransferHub(managerFor(sender));
    hubs.set(sender.id, hub);
  }
  return hub;
}

/**
 * The transfer pane addresses a session and a standalone connection the same way; the id
 * says which is which.
 *
 * A session id may carry a mode — `ses_ab12:scp` — because the same session can transfer
 * either way and the choice belongs to the pane, not to the session. Putting it in the id
 * keeps the pane's whole notion of a source a single string, and needs no extra IPC to
 * set, clear, or forget.
 */
function transportFor(sender: WebContents, id: string): Promise<FileTransport> {
  if (isTransferConnectionId(id)) return Promise.resolve(hubFor(sender).transport(id));

  const [sessionId, mode] = id.split(':');
  return managerFor(sender).transport(sessionId, mode === 'scp' ? 'scp' : 'sftp');
}

const FILE_PROTOCOLS = ['sftp', 'scp', 'smb'];

/** Untrusted, like everything else from the renderer — and it carries a password. */
async function parseFileTarget(raw: unknown): Promise<FileTargetInput> {
  const input = raw as FileTargetInput;
  if (!FILE_PROTOCOLS.includes(input?.protocol)) {
    throw new Error('A transfer target must be sftp, scp, or smb.');
  }
  requireString(input.host, 'host');
  if (typeof input.port !== 'number' || input.port < 1 || input.port > 65535) {
    throw new Error('port must be between 1 and 65535');
  }

  const target: FileTargetInput = {
    protocol: input.protocol,
    host: input.host,
    port: input.port,
    username: typeof input.username === 'string' ? input.username : '',
    ...(typeof input.password === 'string' && input.password ? { password: input.password } : {}),
    ...(typeof input.share === 'string' ? { share: input.share } : {}),
    ...(typeof input.domain === 'string' ? { domain: input.domain } : {}),
  };

  // A saved credential is resolved here so its secret never travels to the renderer and
  // back. What the renderer sent is only used when no credential was chosen.
  if (typeof input.credentialId === 'string' && input.credentialId) {
    const auth = await config().resolveCredential(input.credentialId);
    if (!auth) throw new Error('That credential no longer exists.');
    target.username = auth.username || target.username;
    if (auth.kind === 'key') {
      target.keyPath = auth.keyPath;
      if (auth.passphrase) target.passphrase = auth.passphrase;
      delete target.password;
    } else if (auth.kind === 'password') {
      target.password = auth.password;
    }
  } else if (typeof input.keyPath === 'string' && input.keyPath) {
    target.keyPath = input.keyPath;
    if (typeof input.passphrase === 'string' && input.passphrase) {
      target.passphrase = input.passphrase;
    }
  }

  if (!target.username) throw new Error('username must not be empty');
  return target;
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

/**
 * A running transfer reports every chunk SFTP hands over — around 32 KB apiece, so a
 * 1 GB file is tens of thousands of IPC messages and as many React renders, for a
 * progress bar that moves a fraction of a pixel each time. Progress is coalesced to
 * this interval; the terminal event always goes through, so the bar still lands on
 * its final state.
 */
const PROGRESS_INTERVAL_MS = 100;

function progressReporter(
  sender: WebContents,
  descriptor: { id: string; sessionId: string; direction: 'download' | 'upload'; name: string },
): {
  running: (transferred: number, total: number) => void;
  finish: (status: TransferStatus, detail?: string) => void;
} {
  let lastSentAt = 0;
  let latest: { transferred: number; total: number } | null = null;

  const send = (transferred: number, total: number, status: TransferStatus, detail?: string) => {
    if (sender.isDestroyed()) return;
    sender.send(IpcChannel.transferProgress, {
      ...descriptor, transferred, total, status, detail,
    });
  };

  return {
    running: (transferred, total) => {
      latest = { transferred, total };
      const now = Date.now();
      if (now - lastSentAt < PROGRESS_INTERVAL_MS) return;
      lastSentAt = now;
      send(transferred, total, 'running');
    },
    finish: (status, detail) => {
      // `done` reports the byte count that actually moved rather than a synthetic 1/1,
      // so the last frame the user sees matches the file on disk.
      if (status === 'done' && latest) send(latest.transferred, latest.total, status);
      else send(0, 1, status, detail);
    },
  };
}

function registerConfigIpc(): void {
  handle(IpcChannel.configLoad, () => config().snapshot());

  handle(IpcChannel.configSaveHost, (_event, raw: unknown, rawSecrets: unknown) => {
    const host = normaliseHost(withId(raw, 'hst'));
    if (!host) throw new Error('host is missing an id');
    return config().saveHost(host as Host, parseSecrets(rawSecrets));
  });

  handle(IpcChannel.configDeleteHost, (_event, hostId: unknown) =>
    config().deleteHost(requireString(hostId, 'hostId')),
  );

  handle(IpcChannel.configSaveFolder, (_event, raw: unknown) => {
    const folder = normaliseFolder(withId(raw, 'fld'));
    if (!folder) throw new Error('folder is missing an id');
    return config().saveFolder(folder as Folder);
  });

  handle(IpcChannel.configDeleteFolder, (_event, folderId: unknown) =>
    config().deleteFolder(requireString(folderId, 'folderId')),
  );

  handle(
    IpcChannel.configSaveCredential,
    (_event, raw: unknown, rawSecrets: unknown) => {
      const credential = normaliseCredential(withId(raw, 'crd'));
      if (!credential) throw new Error('credential is missing an id');
      return config().saveCredential(credential as Credential, parseSecrets(rawSecrets));
    },
  );

  handle(IpcChannel.configDeleteCredential, (_event, credentialId: unknown) =>
    config().deleteCredential(requireString(credentialId, 'credentialId')),
  );

  handle(IpcChannel.configChooseLogDirectory, async (event) => {
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

  handle(IpcChannel.configRevealSecret, (_event, ownerId: unknown, kind: unknown) =>
    config().revealSecret(
      requireString(ownerId, 'ownerId'),
      kind === 'passphrase' ? 'passphrase' : 'password',
    ),
  );

  handle(IpcChannel.revealPath, (_event, path: unknown) => {
    shell.showItemInFolder(requireString(path, 'path'));
  });

  // Clipboard goes through main: a sandboxed renderer's navigator.clipboard is
  // gated on focus and permissions, and a terminal paste cannot depend on that.
  handle(IpcChannel.clipboardRead, () => clipboard.readText());

  handle(IpcChannel.clipboardWrite, (_event, text: unknown) => {
    if (typeof text !== 'string' || text.length === 0) return;
    clipboard.writeText(text);
  });

  handle(IpcChannel.logsListFolders, async () =>
    listLogFolders((await config().snapshot()).settings.logDirectory),
  );

  handle(IpcChannel.logsListSessions, async (_event, folder: unknown) =>
    listLogSessions(
      (await config().snapshot()).settings.logDirectory,
      requireString(folder, 'folder'),
    ),
  );

  handle(IpcChannel.logsOpen, (_event, path: unknown) =>
    logReader().open(requireString(path, 'path')),
  );

  handle(
    IpcChannel.logsLines,
    (_event, path: unknown, start: unknown, count: unknown) =>
      logReader().lines(
        requireString(path, 'path'),
        typeof start === 'number' ? start : 0,
        typeof count === 'number' ? Math.min(count, 5000) : 200,
      ),
  );

  handle(IpcChannel.logsSearch, (_event, path: unknown, query: unknown) =>
    logReader().search(requireString(path, 'path'), typeof query === 'string' ? query : ''),
  );

  handle(IpcChannel.logsClose, (_event, path: unknown) => {
    logReader().close(requireString(path, 'path'));
  });

  handle(IpcChannel.exportConfig, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)!;
    const result = await dialog.showSaveDialog(window, {
      title: 'Export configuration',
      defaultPath: configFileName(),
      filters: [{ name: 'NS3H configuration', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await transferService().exportConfig(result.filePath);
    return result.filePath;
  });

  handle(IpcChannel.exportBundle, async (event, passphrase: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)!;
    const result = await dialog.showSaveDialog(window, {
      title: 'Export configuration and credentials',
      defaultPath: bundleFileName(),
      filters: [{ name: 'NS3H backup', extensions: ['ns3h'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await transferService().exportBundle(result.filePath, requireString(passphrase, 'passphrase'));
    return result.filePath;
  });

  handle(
    IpcChannel.importPreview,
    async (event, path: unknown, passphrase: unknown) => {
      // Called with no path to open the picker, or with one to retry under a passphrase.
      if (typeof path === 'string' && path) {
        return transferService().preview(path, typeof passphrase === 'string' ? passphrase : undefined);
      }

      const window = BrowserWindow.fromWebContents(event.sender)!;
      const result = await dialog.showOpenDialog(window, {
        title: 'Import configuration or backup',
        properties: ['openFile'],
        filters: [
          { name: 'NS3H files', extensions: ['json', 'ns3h'] },
          { name: 'All files', extensions: ['*'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      const chosen = result.filePaths[0];
      return { path: chosen, preview: await transferService().preview(chosen) };
    },
  );

  handle(IpcChannel.importApply, (_event, request: unknown) => {
    const input = request as { path?: unknown; passphrase?: unknown; resolutions?: unknown };
    return transferService().apply({
      path: requireString(input?.path, 'path'),
      passphrase: typeof input?.passphrase === 'string' ? input.passphrase : undefined,
      resolutions:
        typeof input?.resolutions === 'object' && input.resolutions !== null
          ? (input.resolutions as Record<string, boolean>)
          : {},
    });
  });

  handle(IpcChannel.configSaveSettings, (_event, patch: unknown) => {
    if (typeof patch !== 'object' || patch === null) throw new Error('settings patch must be an object');
    return config().saveSettings(patch as Partial<Settings>);
  });
}

export function registerIpc(): void {
  registerLockIpc();
  registerConfigIpc();

  handle(IpcChannel.sessionOpenHost, async (event, hostId: unknown) => {
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

  handle(IpcChannel.sessionOpenSsh, (event, raw): OpenSessionResult => {
    // Quick connections have no saved host, so they always log, under `_quick/`.
    const sessionId = managerFor(event.sender).openSsh(parseTarget(raw), { logging: true });
    return { sessionId };
  });

  handle(IpcChannel.sessionOpenTelnet, (event, raw): OpenSessionResult => {
    const sessionId = managerFor(event.sender).openTelnet(parseTelnetTarget(raw), {
      logging: true,
    });
    return { sessionId };
  });

  handle(
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

  handle(IpcChannel.sessionSendBreak, (event, sessionId: unknown) =>
    managerFor(event.sender).sendBreak(requireString(sessionId, 'sessionId')),
  );

  handle(IpcChannel.serialList, () => listSerialPorts());

  handle(IpcChannel.transferConnect, async (event, raw: unknown) =>
    hubFor(event.sender).connect(await parseFileTarget(raw)),
  );

  handle(IpcChannel.transferConnections, (event) => hubFor(event.sender).list());

  handle(IpcChannel.transferDisconnect, (event, id: unknown) => {
    hubFor(event.sender).disconnect(requireString(id, 'connectionId'));
  });

  handle(IpcChannel.transferRemoteHome, async (event, connectionId: unknown) =>
    (await transportFor(event.sender, requireString(connectionId, 'connectionId'))).home(),
  );

  handle(
    IpcChannel.transferRemoteList,
    async (event, connectionId: unknown, path: unknown) =>
      (await transportFor(event.sender, requireString(connectionId, 'connectionId'))).list(
        requireString(path, 'path'),
      ),
  );

  handle(IpcChannel.transferLocalList, (_event, path: unknown) =>
    listLocal(typeof path === 'string' ? path : ''),
  );

  handle(IpcChannel.transferChooseDirectory, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(window!, {
      title: 'Choose a directory',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  handle(
    IpcChannel.transferDownload,
    async (event, sessionId: unknown, remotePath: unknown, localDirectory: unknown) => {
      const id = `trf_${randomBytes(3).toString('hex')}`;
      const session = requireString(sessionId, 'sessionId');
      const remote = requireString(remotePath, 'remotePath');
      const name = remote.split('/').pop() ?? remote;

      // Progress is a stream of events rather than a resolved promise, so a large
      // file shows movement instead of appearing to hang.
      const report = progressReporter(event.sender, {
        id, sessionId: session, direction: 'download', name,
      });

      try {
        const transport = await transportFor(event.sender, session);
        const target = await transport.download(
          remote, requireString(localDirectory, 'localDirectory'),
          ({ transferred, total }) => report.running(transferred, total),
        );
        report.finish('done');
        return target;
      } catch (error) {
        report.finish('error', (error as Error).message);
        throw error;
      }
    },
  );

  handle(
    IpcChannel.transferUpload,
    async (event, sessionId: unknown, localPath: unknown, remoteDirectory: unknown) => {
      const id = `trf_${randomBytes(3).toString('hex')}`;
      const session = requireString(sessionId, 'sessionId');
      const local = requireString(localPath, 'localPath');
      const name = local.split(/[\\/]/).pop() ?? local;

      const report = progressReporter(event.sender, {
        id, sessionId: session, direction: 'upload', name,
      });

      try {
        const transport = await transportFor(event.sender, session);
        const target = await transport.upload(
          local, requireString(remoteDirectory, 'remoteDirectory'),
          ({ transferred, total }) => report.running(transferred, total),
        );
        report.finish('done');
        return target;
      } catch (error) {
        report.finish('error', (error as Error).message);
        throw error;
      }
    },
  );

  handle(IpcChannel.sessionWrite, (event, sessionId: unknown, data: unknown) => {
    managerFor(event.sender).write(requireString(sessionId, 'sessionId'), String(data ?? ''));
  });

  handle(
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

  handle(IpcChannel.sessionClose, (event, sessionId: unknown) => {
    managerFor(event.sender).close(requireString(sessionId, 'sessionId'));
  });

  handle(IpcChannel.hostKeyRespond, (event, promptId: unknown, accepted: unknown) => {
    managerFor(event.sender).respondHostKey(
      requireString(promptId, 'promptId'),
      accepted === true,
    );
  });

  handle(IpcChannel.authRespond, (event, promptId: unknown, responses: unknown) => {
    const values = Array.isArray(responses) ? responses.map((value) => String(value)) : null;
    managerFor(event.sender).respondAuth(requireString(promptId, 'promptId'), values);
  });

  handle(IpcChannel.platformInfo, () => ({ platform: process.platform }));

  handle(IpcChannel.windowMinimize, (event) =>
    BrowserWindow.fromWebContents(event.sender)?.minimize(),
  );

  handle(IpcChannel.windowToggleMaximize, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });

  handle(IpcChannel.windowClose, (event) =>
    BrowserWindow.fromWebContents(event.sender)?.close(),
  );
}

export function closeAllSessions(): void {
  for (const hub of hubs.values()) hub.closeAll();
  hubs.clear();
  for (const manager of managers.values()) manager.closeAll();
  managers.clear();
}

/** Gives every open log a chance to flush before the process goes away (§5.3). */
export async function flushAllLogs(): Promise<void> {
  await Promise.all([...managers.values()].map((manager) => manager.flushAll()));
}
