import { randomBytes } from 'node:crypto';
import type { WebContents } from 'electron';
import type {
  AuthPromptRequest,
  HostKeyPromptRequest,
  NegotiatedAlgorithms,
  NoticeLevel,
  SessionInfo,
  SshTarget,
} from '@shared/types.js';
import { IpcChannel } from '@shared/ipc.js';
import { SshConnection } from '../ssh/connection.js';
import type { HostKeyIdentity } from '../ssh/fingerprint.js';
import { KnownHostsStore, verifyHostKey } from '../store/knownHosts.js';
import type { LogService } from '../logging/index.js';
import type { SessionLogWriter } from '../logging/writer.js';

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}

interface Session {
  info: SessionInfo;
  connection: SshConnection;
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
        void this.startLog(sessionId, target, options, negotiation);
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
    target: SshTarget,
    options: OpenSshOptions,
    negotiation: NegotiatedAlgorithms,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !this.logs || !options.logging) return;

    try {
      const log = await this.logs.begin({
        hostId: options.hostId,
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
      });
      if (!log) return; // no log directory chosen yet

      for (const chunk of session.pending) log.write(chunk);
      session.pending = [];
      session.log = log;
      session.info.logPath = log.path;
      this.emit(IpcChannel.sessionStatus, {
        sessionId,
        status: session.info.status,
        negotiation,
        logPath: log.path,
      });
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

  private async resolveHostKey(
    sessionId: string,
    target: SshTarget,
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
