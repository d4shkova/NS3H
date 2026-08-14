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
import type { HostKeyIdentity } from '../ssh/fingerprint.js';
import { KnownHostsStore, verifyHostKey } from '../store/knownHosts.js';

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}

interface Session {
  info: SessionInfo;
  connection: SshConnection;
}

type Pending<T> = { resolve: (value: T) => void };

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly hostKeyPrompts = new Map<string, Pending<boolean>>();
  private readonly authPrompts = new Map<string, Pending<string[] | null>>();

  constructor(
    private readonly sender: WebContents,
    private readonly knownHosts = new KnownHostsStore(),
  ) {}

  openSsh(target: SshTarget): string {
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
      onData: (chunk) => this.emitData(sessionId, chunk),
      onConnected: (negotiation) => {
        info.status = 'connected';
        info.negotiation = negotiation;
        this.emit(IpcChannel.sessionStatus, { sessionId, status: 'connected', negotiation });
      },
      onClosed: (detail) => {
        info.status = 'closed';
        this.emit(IpcChannel.sessionStatus, { sessionId, status: 'closed', detail });
        this.sessions.delete(sessionId);
      },
      onError: (detail) => {
        info.status = 'error';
        this.emit(IpcChannel.sessionStatus, { sessionId, status: 'error', detail });
        this.sessions.delete(sessionId);
      },
      onNotice: (level: NoticeLevel, text: string) =>
        this.emit(IpcChannel.sessionNotice, { sessionId, level, text }),
      verifyHostKey: (identity) => this.resolveHostKey(sessionId, target, identity),
      promptAuth: (request) => this.askAuth(sessionId, request),
    });

    this.sessions.set(sessionId, { info, connection });
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
    this.sessions.delete(sessionId);
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id);
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
