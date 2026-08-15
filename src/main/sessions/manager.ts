import { randomBytes } from 'node:crypto';
import type { WebContents } from 'electron';
import type {
  AuthPromptRequest,
  HostKeyPromptRequest,
  NoticeLevel,
  SessionInfo,
  SshTarget,
} from '@shared/types.js';
import { IpcChannel } from '@shared/ipc.js';
import { SshConnection } from '../ssh/connection.js';
import { TelnetConnection, type TelnetTarget } from '../telnet/connection.js';
import { SerialConnection } from '../serial/connection.js';
import type { SerialConfig } from '@shared/config.js';
import type { HostKeyIdentity } from '../ssh/fingerprint.js';
import { KnownHostsStore, verifyHostKey } from '../store/knownHosts.js';
import type { LogService, SessionLogRequest } from '../logging/index.js';
import { SftpSession } from '../ssh/sftp.js';
import type { FileTransport } from '../files/transport.js';
import type { SessionLogWriter } from '../logging/writer.js';

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}

/** What every protocol has to provide the manager. */
interface Transport {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
  sendBreak?(): Promise<void>;
}

interface Session {
  info: SessionInfo;
  connection: Transport;
  /** Opened on demand for file transfer; SSH sessions only. Held as the in-flight
   * promise so concurrent requests share one channel. */
  sftp?: Promise<SftpSession>;
  /** Null until the log opens, or for good when logging is off. */
  log: SessionLogWriter | null;
  /**
   * Output that arrived while the log file was still being opened. Small and
   * short-lived, but dropping it would lose the device's banner and first prompt.
   */
  pending: Buffer[];
  logging: boolean;
}

export interface OpenSshOptions {
  /** Absent for quick connections, which log under `_quick/<address>/`. */
  hostId?: string;
  /** Per §5.1 quick connections always log; saved hosts follow their own setting. */
  logging: boolean;
}

type Pending<T> = { resolve: (value: T) => void };

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly hostKeyPrompts = new Map<string, Pending<boolean>>();
  private readonly authPrompts = new Map<string, Pending<string[] | null>>();

  constructor(
    private readonly sender: WebContents,
    private readonly logs: LogService | null = null,
    private readonly knownHosts = new KnownHostsStore(),
  ) {}

  openSsh(target: SshTarget, options: OpenSshOptions = { logging: true }): string {
    const sessionId = newId('ses');
    const info: SessionInfo = {
      id: sessionId,
      protocol: 'ssh',
      name: target.name,
      address: target.address,
      port: target.port,
      username: target.auth.username,
      status: 'connecting',
    };

    const connection = new SshConnection(target, {
      onData: (chunk) => {
        this.record(sessionId, chunk);
        this.emitData(sessionId, chunk);
      },
      onConnected: (negotiation) => {
        info.status = 'connected';
        info.negotiation = negotiation;
        this.emit(IpcChannel.sessionStatus, { sessionId, status: 'connected', negotiation });
        void this.startLog(
          sessionId,
          options,
          {
            name: target.name,
            address: target.address,
            port: target.port,
            protocol: 'ssh',
            user: target.auth.username,
            crypto: {
              kex: negotiation.kex,
              cipher: negotiation.cipher,
              mac: negotiation.mac,
              hostKey: `${negotiation.hostKeyType} ${negotiation.fingerprint}`,
            },
          },
        );
      },
      onClosed: (detail) => {
        info.status = 'closed';
        this.emit(IpcChannel.sessionStatus, { sessionId, status: 'closed', detail });
        void this.finish(sessionId);
      },
      onError: (detail) => {
        info.status = 'error';
        this.emit(IpcChannel.sessionStatus, { sessionId, status: 'error', detail });
        void this.finish(sessionId);
      },
      onNotice: (level: NoticeLevel, text: string) =>
        this.emit(IpcChannel.sessionNotice, { sessionId, level, text }),
      verifyHostKey: (identity) => this.resolveHostKey(sessionId, target, identity),
      promptAuth: (request) => this.askAuth(sessionId, request),
    });

    this.sessions.set(sessionId, {
      info,
      connection,
      log: null,
      pending: [],
      logging: options.logging,
    });
    this.emit(IpcChannel.sessionStatus, { sessionId, status: 'connecting' });
    void connection.open();
    return sessionId;
  }

  openTelnet(target: TelnetTarget, options: OpenSshOptions = { logging: true }): string {
    const sessionId = newId('ses');
    const info: SessionInfo = {
      id: sessionId,
      protocol: 'telnet',
      name: target.name,
      address: target.address,
      port: target.port,
      username: '',
      status: 'connecting',
    };

    const connection = new TelnetConnection(target, {
      onData: (chunk) => {
        this.record(sessionId, chunk);
        this.emitData(sessionId, chunk);
      },
      onConnected: () => {
        info.status = 'connected';
        this.emit(IpcChannel.sessionStatus, { sessionId, status: 'connected' });
        void this.startLog(sessionId, options, {
          name: target.name,
          address: target.address,
          port: target.port,
          protocol: 'telnet',
        });
      },
      onClosed: (detail) => {
        info.status = 'closed';
        this.emit(IpcChannel.sessionStatus, { sessionId, status: 'closed', detail });
        void this.finish(sessionId);
      },
      onError: (detail) => {
        info.status = 'error';
        this.emit(IpcChannel.sessionStatus, { sessionId, status: 'error', detail });
        void this.finish(sessionId);
      },
      onNotice: (level, text) => this.emit(IpcChannel.sessionNotice, { sessionId, level, text }),
    });

    this.sessions.set(sessionId, {
      info,
      connection,
      log: null,
      pending: [],
      logging: options.logging,
    });
    this.emit(IpcChannel.sessionStatus, { sessionId, status: 'connecting' });
    connection.open();
    return sessionId;
  }

  openSerial(
    name: string,
    config: SerialConfig,
    options: OpenSshOptions = { logging: true },
  ): string {
    const sessionId = newId('ses');
    const info: SessionInfo = {
      id: sessionId,
      protocol: 'serial',
      name,
      address: config.path,
      port: config.baudRate,
      username: '',
      status: 'connecting',
    };

    const connection = new SerialConnection(config, {
      onData: (chunk) => {
        this.record(sessionId, chunk);
        this.emitData(sessionId, chunk);
      },
      onConnected: () => {
        info.status = 'connected';
        this.emit(IpcChannel.sessionStatus, { sessionId, status: 'connected' });
        void this.startLog(sessionId, options, {
          name,
          address: config.path,
          port: config.baudRate,
          protocol: 'serial',
          serial: {
            path: config.path,
            baudRate: config.baudRate,
            dataBits: config.dataBits,
            parity: config.parity,
            stopBits: config.stopBits,
            flowControl: config.flowControl,
          },
        });
      },
      onClosed: (detail) => {
        info.status = 'closed';
        this.emit(IpcChannel.sessionStatus, { sessionId, status: 'closed', detail });
        void this.finish(sessionId);
      },
      onError: (detail) => {
        info.status = 'error';
        this.emit(IpcChannel.sessionStatus, { sessionId, status: 'error', detail });
        void this.finish(sessionId);
      },
      onNotice: (level, text) => this.emit(IpcChannel.sessionNotice, { sessionId, level, text }),
    });

    this.sessions.set(sessionId, {
      info,
      connection,
      log: null,
      pending: [],
      logging: options.logging,
    });
    this.emit(IpcChannel.sessionStatus, { sessionId, status: 'connecting' });
    connection.open();
    return sessionId;
  }

  /** SFTP runs over the session that is already authenticated (§ phase 9). */
  private sftpFor(sessionId: string): Promise<SftpSession> {
    const session = this.sessions.get(sessionId);
    if (!session) return Promise.reject(new Error('That session is no longer open.'));
    if (session.info.protocol !== 'ssh') {
      return Promise.reject(
        new Error('File transfer needs an SSH session — telnet and serial cannot carry it.'),
      );
    }
    // The in-flight promise is what is cached, not just the result: opening the pane
    // fires a home lookup and a listing together, and awaiting the result would let
    // both open their own channel — one of which is then leaked until the session ends.
    if (session.sftp) return session.sftp;

    const connection = session.connection as SshConnection;
    const opening = connection.openSftp().then((wrapper) => {
      // A device that drops the subsystem later must not leave a dead handle cached.
      const forget = () => {
        if (session.sftp === opening) session.sftp = undefined;
      };
      wrapper.on('close', forget);
      wrapper.on('end', forget);
      return new SftpSession(wrapper);
    });

    session.sftp = opening;
    opening.catch(() => {
      // A refusal is retried on the next request rather than remembered forever: the
      // subsystem can be enabled on the device without reconnecting the session.
      if (session.sftp === opening) session.sftp = undefined;
    });
    return opening;
  }

  /**
   * The session's SFTP channel behind the same interface a standalone connection
   * implements, so the transfer pane and its IPC handlers do not care which they have.
   * `close` is a no-op: the channel belongs to the session and goes when it does.
   */
  async transport(sessionId: string): Promise<FileTransport> {
    const sftp = await this.sftpFor(sessionId);
    return {
      home: () => sftp.realpath('.'),
      list: (path) => sftp.list(path),
      download: (remotePath, localDirectory, onProgress) =>
        sftp.download(remotePath, localDirectory, onProgress),
      upload: (localPath, remoteDirectory, onProgress) =>
        sftp.upload(localPath, remoteDirectory, onProgress),
      close: () => {},
    };
  }

  /** Serial only — the toolbar button is hidden for other protocols. */
  async sendBreak(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.connection.sendBreak) {
      throw new Error('Send Break only applies to a serial session.');
    }
    await session.connection.sendBreak();
    this.emit(IpcChannel.sessionNotice, {
      sessionId,
      level: 'info',
      text: 'Sent break.',
    });
  }

  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.connection.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.sessions.get(sessionId)?.connection.resize(cols, rows);
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.connection.close();
    void this.finish(sessionId);
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id);
  }

  /** Flushes every open log — called on app quit so nothing is left in a buffer. */
  async flushAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => session.log?.close()));
  }

  /**
   * §2 — logging happens in main, on the raw stream. The terminal can be backgrounded
   * or destroyed and the session keeps writing.
   */
  private record(sessionId: string, chunk: Buffer): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.logging) return;
    if (session.log) session.log.write(chunk);
    else session.pending.push(Buffer.from(chunk));
  }

  private async startLog(
    sessionId: string,
    options: OpenSshOptions,
    descriptor: Omit<SessionLogRequest, 'hostId'>,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !this.logs || !options.logging) return;

    try {
      const log = await this.logs.begin({ hostId: options.hostId, ...descriptor });
      if (!log) return; // no log directory chosen yet

      for (const chunk of session.pending) log.write(chunk);
      session.pending = [];
      session.log = log;
      session.info.logPath = log.path;
      // A dedicated event: re-emitting `status` would look like a second connect,
      // and the renderer would print the connection banner again — mid-line, on top
      // of whatever the device had already sent.
      this.emit(IpcChannel.sessionLog, { sessionId, logPath: log.path });
    } catch (error) {
      session.logging = false;
      session.pending = [];
      this.emit(IpcChannel.sessionNotice, {
        sessionId,
        level: 'error',
        text: `Session logging is off: ${(error as Error).message}`,
      });
    }
  }

  private async finish(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    // A channel still being opened is closed as soon as it arrives; a rejected open
    // has nothing to close, and its error has already been reported to the caller.
    void session.sftp?.then((sftp) => sftp.end()).catch(() => {});
    await session.log?.close();
  }

  respondHostKey(promptId: string, accepted: boolean): void {
    const pending = this.hostKeyPrompts.get(promptId);
    if (!pending) return;
    this.hostKeyPrompts.delete(promptId);
    pending.resolve(accepted);
  }

  respondAuth(promptId: string, responses: string[] | null): void {
    const pending = this.authPrompts.get(promptId);
    if (!pending) return;
    this.authPrompts.delete(promptId);
    pending.resolve(responses);
  }

  /**
   * Public because a standalone transfer connection (§ phase 12) has no session but must
   * go through the same known-hosts check and the same modal — a key is a key, whether a
   * terminal or a file pane is behind it.
   */
  async resolveHostKey(
    sessionId: string,
    target: { address: string; port: number },
    identity: HostKeyIdentity,
  ): Promise<boolean> {
    const file = await this.knownHosts.read();
    const verdict = verifyHostKey(file, target.address, target.port, identity.fingerprint);

    if (verdict.kind === 'trusted') return true;

    const promptId = newId('hkp');
    const request: HostKeyPromptRequest = {
      id: promptId,
      sessionId,
      address: target.address,
      port: target.port,
      keyType: identity.keyType,
      fingerprint: identity.fingerprint,
      ...(verdict.kind === 'changed'
        ? {
            previous: {
              keyType: verdict.previous.keyType,
              fingerprint: verdict.previous.fingerprint,
              acceptedAt: verdict.previous.acceptedAt,
            },
          }
        : {}),
    };

    const accepted = await new Promise<boolean>((resolve) => {
      this.hostKeyPrompts.set(promptId, { resolve });
      this.emit(IpcChannel.hostKeyPrompt, request);
    });

    if (accepted) {
      await this.knownHosts.accept({
        address: target.address,
        port: target.port,
        keyType: identity.keyType,
        fingerprint: identity.fingerprint,
        acceptedAt: new Date().toISOString(),
      });
    }
    return accepted;
  }

  private askAuth(
    sessionId: string,
    request: Omit<AuthPromptRequest, 'id' | 'sessionId'>,
  ): Promise<string[] | null> {
    const promptId = newId('aup');
    return new Promise((resolve) => {
      this.authPrompts.set(promptId, { resolve });
      this.emit(IpcChannel.authPrompt, { ...request, id: promptId, sessionId });
    });
  }

  private emitData(sessionId: string, chunk: Buffer): void {
    // A copy, because the Buffer is pooled and IPC serialisation is asynchronous.
    this.emit(IpcChannel.sessionData, { sessionId, data: new Uint8Array(chunk) });
  }

  private emit(channel: string, payload: unknown): void {
    if (this.sender.isDestroyed()) return;
    this.sender.send(channel, payload);
  }
}
