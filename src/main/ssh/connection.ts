import { readFile } from 'node:fs/promises';
import type { Client as SshClient, ClientChannel, ConnectConfig, SFTPWrapper } from 'ssh2';
import { sshClientClass, supportedAlgorithms } from './ssh2.js';
import type { NegotiatedAlgorithms, NoticeLevel, SshAuth, SshTarget } from '@shared/types.js';
import {
  FULL_ALGORITHMS,
  LEGACY_ALGORITHMS,
  describeDropped,
  filterAlgorithms,
  type AlgorithmSet,
} from './algorithms.js';
import { classifySshError, explainNetworkError, explainSftpRefusal } from './errors.js';
import { identifyHostKey, type HostKeyIdentity } from './fingerprint.js';
import { collectRemoteOffer, describeRemoteOffer, type RemoteOffer } from './handshakeLog.js';

/** §3.7 — SSH keepalive. */
const KEEPALIVE_INTERVAL_MS = 30_000;
const KEEPALIVE_COUNT_MAX = 3;
const HANDSHAKE_TIMEOUT_MS = 20_000;
const MAX_AUTH_ATTEMPTS = 3;

export interface SshCallbacks {
  onData(chunk: Buffer): void;
  onConnected(negotiation: NegotiatedAlgorithms): void;
  onClosed(detail: string): void;
  onError(detail: string): void;
  onNotice(level: NoticeLevel, text: string): void;
  /** Resolves true when the user trusts the key. Persisting it is the caller's job. */
  verifyHostKey(identity: HostKeyIdentity): Promise<boolean>;
  promptAuth(request: {
    title: string;
    instructions?: string;
    fields: { key: string; label: string; echo: boolean }[];
  }): Promise<string[] | null>;
}

interface Rung {
  label: string;
  set: AlgorithmSet;
}

const LADDER: Rung[] = [
  { label: 'full algorithm set', set: FULL_ALGORITHMS },
  { label: 'legacy algorithm set', set: LEGACY_ALGORITHMS },
];

type AttemptOutcome =
  | { kind: 'ready' }
  | { kind: 'failed'; failure: ReturnType<typeof classifySshError>; offer: RemoteOffer; raw: unknown }
  | { kind: 'aborted'; detail: string };

export class SshConnection {
  private client: SshClient | null = null;
  private stream: ClientChannel | null = null;
  private negotiation: NegotiatedAlgorithms | null = null;
  private disposed = false;
  /** Overrides the stored secret after an inline re-prompt. */
  private promptedSecret: string | null = null;
  private cols = 80;
  private rows = 24;

  constructor(
    private readonly target: SshTarget,
    private readonly callbacks: SshCallbacks,
  ) {}

  get negotiatedAlgorithms(): NegotiatedAlgorithms | null {
    return this.negotiation;
  }

  async open(): Promise<void> {
    let authAttempts = 0;

    for (const [index, rung] of LADDER.entries()) {
      if (this.disposed) return;

      if (index > 0) {
        this.callbacks.onNotice(
          'warn',
          `Retrying with the ${rung.label} — some devices reject an oversized KEXINIT.`,
        );
      }

      const { algorithms, dropped } = filterAlgorithms(rung.set, supportedAlgorithms());
      const droppedLines = describeDropped(dropped);
      if (index === 0 && droppedLines.length > 0) {
        this.callbacks.onNotice(
          'info',
          `Not offered (unsupported by this build) — ${droppedLines.join(' | ')}`,
        );
      }

      // Auth failures re-prompt against the same rung: the crypto already worked.
      for (;;) {
        const outcome = await this.attempt(algorithms);

        if (outcome.kind === 'ready') return;
        if (outcome.kind === 'aborted') {
          this.callbacks.onError(outcome.detail);
          return;
        }

        const { failure, offer, raw } = outcome;

        if (failure.kind === 'auth' && authAttempts < MAX_AUTH_ATTEMPTS) {
          authAttempts += 1;
          const secret = await this.promptForSecret(failure.message);
          if (secret === null) {
            this.callbacks.onError('Authentication cancelled.');
            return;
          }
          this.promptedSecret = secret;
          continue;
        }

        if (failure.kind === 'auth') {
          this.callbacks.onError(`Authentication failed: ${failure.message}`);
          return;
        }

        if (failure.kind === 'network') {
          this.callbacks.onError(
            explainNetworkError(raw, this.target.address, this.target.port),
          );
          return;
        }

        const isLastRung = index === LADDER.length - 1;
        if (!isLastRung) {
          this.callbacks.onNotice('warn', `${rung.label} failed: ${failure.message}`);
          break;
        }

        this.callbacks.onError(this.formatLadderFailure(failure.message, offer));
        return;
      }
    }
  }

  write(data: string): void {
    this.stream?.write(data);
  }

  /**
   * Opens an SFTP channel on the session that is already up, so a transfer costs no
   * second authentication and reuses the negotiated crypto.
   */
  openSftp(): Promise<SFTPWrapper> {
    return new Promise((resolveSftp, reject) => {
      if (!this.client) {
        reject(new Error('The session is not connected.'));
        return;
      }
      this.client.sftp((error, sftp) => {
        if (error) {
          reject(explainSftpRefusal(error, this.target.address));
          return;
        }
        resolveSftp(sftp);
      });
    });
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.stream?.setWindow(rows, cols, 0, 0);
  }

  close(): void {
    this.disposed = true;
    this.stream?.end();
    this.client?.end();
  }

  private formatLadderFailure(message: string, offer: RemoteOffer): string {
    const lines = [
      `Could not negotiate a connection to ${this.target.address}:${this.target.port}.`,
      '',
      'Attempted:',
      ...LADDER.map((rung) => `  · ${rung.label}`),
      '',
      `Last error: ${message}`,
    ];
    const offered = describeRemoteOffer(offer);
    if (offered.length > 0) {
      lines.push('', 'The server offered:', ...offered.map((line) => `  ${line}`));
    } else {
      lines.push('', 'The server closed the connection before advertising its algorithms.');
    }
    return lines.join('\n');
  }

  private async promptForSecret(reason: string): Promise<string | null> {
    const isKey = this.target.auth.kind === 'key';
    const response = await this.callbacks.promptAuth({
      title: isKey ? 'Key passphrase required' : 'Password required',
      instructions: reason,
      fields: [
        {
          key: 'secret',
          label: isKey
            ? `Passphrase for ${(this.target.auth as { keyPath: string }).keyPath}`
            : `Password for ${this.target.auth.username}@${this.target.address}`,
          echo: false,
        },
      ],
    });
    return response?.[0] ?? null;
  }

  private async buildConfig(algorithms: AlgorithmSet): Promise<ConnectConfig> {
    const auth: SshAuth = this.target.auth;
    const config: ConnectConfig = {
      host: this.target.address,
      port: this.target.port,
      username: auth.username,
      // §3.3 — required: many network devices and TACACS+ deployments use this
      // rather than plain `password`.
      tryKeyboard: true,
      keepaliveInterval: KEEPALIVE_INTERVAL_MS,
      keepaliveCountMax: KEEPALIVE_COUNT_MAX,
      readyTimeout: HANDSHAKE_TIMEOUT_MS,
      algorithms: {
        kex: algorithms.kex as never,
        serverHostKey: algorithms.serverHostKey as never,
        cipher: algorithms.cipher as never,
        hmac: algorithms.hmac as never,
      },
    };

    if (auth.kind === 'key') {
      // NS3H never copies key material — it is read at connect time and dropped.
      config.privateKey = await readFile(auth.keyPath);
      const passphrase = this.promptedSecret ?? auth.passphrase;
      if (passphrase) config.passphrase = passphrase;
    } else if (auth.kind === 'password') {
      const password = this.promptedSecret ?? auth.password;
      if (password) config.password = password;
    } else if (this.promptedSecret) {
      config.password = this.promptedSecret;
    }

    return config;
  }

  private async attempt(algorithms: AlgorithmSet): Promise<AttemptOutcome> {
    let config: ConnectConfig;
    try {
      config = await this.buildConfig(algorithms);
    } catch (error) {
      return {
        kind: 'aborted',
        detail: `Could not read the private key: ${(error as Error).message}`,
      };
    }

    const client = new (sshClientClass())();
    this.client = client;

    const offer: RemoteOffer = {};
    let handshakeCompleted = false;
    let settled = false;

    return new Promise<AttemptOutcome>((resolve) => {
      const finish = (outcome: AttemptOutcome) => {
        if (settled) return;
        settled = true;
        if (outcome.kind !== 'ready') client.end();
        resolve(outcome);
      };

      client.on('handshake', (negotiated) => {
        handshakeCompleted = true;
        this.negotiation = {
          kex: negotiated.kex,
          serverHostKey: negotiated.serverHostKey,
          cipher: negotiated.cs.cipher,
          mac: negotiated.cs.mac,
          hostKeyType: this.negotiation?.hostKeyType ?? negotiated.serverHostKey,
          fingerprint: this.negotiation?.fingerprint ?? '',
        };
      });

      client.on('keyboard-interactive', (name, instructions, _lang, prompts, finishAuth) => {
        void this.callbacks
          .promptAuth({
            title: name || 'Keyboard-interactive authentication',
            instructions: instructions || undefined,
            fields: prompts.map((prompt, index) => ({
              key: `p${index}`,
              label: prompt.prompt,
              // ssh2 leaves `echo` undefined when the server omits it; a prompt whose
              // echo flag is missing is a password prompt, so mask it.
              echo: prompt.echo === true,
            })),
          })
          .then((responses) => {
            if (responses === null) {
              finish({ kind: 'aborted', detail: 'Authentication cancelled.' });
              return;
            }
            finishAuth(responses);
          });
      });

      client.on('ready', () => {
        client.shell(
          { term: 'xterm-256color', cols: this.cols, rows: this.rows },
          (error, stream) => {
            if (error) {
              finish({
                kind: 'aborted',
                detail: `Connected, but the device refused a shell channel: ${error.message}`,
              });
              return;
            }
            this.stream = stream;
            stream.on('data', (chunk: Buffer) => this.callbacks.onData(chunk));
            stream.stderr.on('data', (chunk: Buffer) => this.callbacks.onData(chunk));
            stream.on('close', () => {
              this.callbacks.onClosed('The device closed the session.');
              client.end();
            });
            if (this.negotiation) this.callbacks.onConnected(this.negotiation);
            finish({ kind: 'ready' });
          },
        );
      });

      client.on('error', (error) => {
        finish({
          kind: 'failed',
          failure: classifySshError(error, handshakeCompleted),
          offer,
          raw: error,
        });
      });

      client.on('close', () => {
        finish({
          kind: 'failed',
          failure: classifySshError(
            new Error('The connection closed during the handshake.'),
            handshakeCompleted,
          ),
          offer,
          raw: null,
        });
      });

      client.connect({
        ...config,
        debug: (line: string) => collectRemoteOffer(offer, line),
        hostVerifier: (keyBlob: Buffer, callback: (ok: boolean) => void) => {
          const identity = identifyHostKey(keyBlob);
          this.negotiation = {
            ...(this.negotiation ?? {
              kex: '',
              serverHostKey: identity.keyType,
              cipher: '',
              mac: '',
            }),
            hostKeyType: identity.keyType,
            fingerprint: identity.fingerprint,
          } as NegotiatedAlgorithms;
          void this.callbacks.verifyHostKey(identity).then((accepted) => {
            if (!accepted) {
              finish({ kind: 'aborted', detail: 'Host key rejected — connection aborted.' });
            }
            callback(accepted);
          });
        },
      } as ConnectConfig);
    });
  }
}
