import type { FileTargetInput } from '@shared/transfer.js';
import type { SshTarget } from '@shared/types.js';
import { SshConnection, type SshCallbacks } from '../ssh/connection.js';
import { SftpSession } from '../ssh/sftp.js';
import { ScpTransport } from './scp.js';
import type { FileTransport } from './transport.js';

/** What the hub has to supply: how to ask the user things, and how to report a drop. */
export interface StandaloneCallbacks {
  verifyHostKey: SshCallbacks['verifyHostKey'];
  onClosed(detail: string): void;
  onNotice: SshCallbacks['onNotice'];
}

/**
 * An SSH connection for transfer and nothing else (§ phase 12) — no shell, no terminal, no
 * session log.
 *
 * This is the same `SshConnection` a terminal session uses, opened with `shell: false`, so
 * a transfer target gets the algorithm ladder, the known-hosts check and the auth
 * re-prompt without any of it being written twice. SFTP and SCP both ride on it.
 */
async function connectForTransfer(
  target: FileTargetInput,
  callbacks: StandaloneCallbacks,
): Promise<SshConnection> {
  const sshTarget: SshTarget = {
    name: `${target.username}@${target.host}`,
    address: target.host,
    port: target.port,
    auth: target.keyPath
      ? {
          kind: 'key',
          username: target.username,
          keyPath: target.keyPath,
          ...(target.passphrase ? { passphrase: target.passphrase } : {}),
        }
      : target.password
        ? { kind: 'password', username: target.username, password: target.password }
        : { kind: 'prompt', username: target.username },
  };

  // `open` resolves once the ladder is done; it reports the outcome through the callbacks
  // rather than by throwing, so the failure is captured here and turned back into a
  // rejection the pane can show.
  let failure: string | null = null;
  const secret = target.password ?? target.passphrase ?? '';
  let offered = false;
  let ranOutOfAnswers = false;

  const connection = new SshConnection(
    sshTarget,
    {
      onData: () => {},
      onConnected: () => {},
      onClosed: (detail) => callbacks.onClosed(detail),
      onError: (detail) => {
        failure = detail;
      },
      onNotice: callbacks.onNotice,
      verifyHostKey: callbacks.verifyHostKey,
      /**
       * A session answers a prompt in its terminal; a standalone connection has no
       * terminal to put one in, and no tab to attach it to — waiting on a modal that
       * cannot appear would hang the connect for good. So the secret from the form
       * answers the first round, and anything past that fails with a message instead:
       * the form is the prompt, and the user retypes there.
       *
       * The consequence, and it is a real one: a device demanding a second factor cannot
       * be reached this way. Open an SSH session and transfer over that.
       */
      promptAuth: (request) => {
        if (!offered && secret && request.fields.length === 1) {
          offered = true;
          return Promise.resolve([secret]);
        }
        ranOutOfAnswers = true;
        return Promise.resolve(null);
      },
    },
    { shell: false },
  );

  await connection.open();

  if (ranOutOfAnswers) {
    connection.close();
    throw new Error(
      secret
        ? `${target.host} refused those credentials. Check the username and password — ` +
          'a device asking for more than one answer (a token, or a second factor) has to ' +
          'be reached through an SSH session instead.'
        : `${target.host} asked for a password. Enter one above, or pick a saved credential.`,
    );
  }
  if (failure) {
    connection.close();
    throw new Error(failure);
  }

  return connection;
}

/** SFTP on a connection of its own. */
export class StandaloneSftp implements FileTransport {
  private constructor(
    private readonly connection: SshConnection,
    private readonly session: SftpSession,
  ) {}

  static async connect(
    target: FileTargetInput,
    callbacks: StandaloneCallbacks,
  ): Promise<StandaloneSftp> {
    const connection = await connectForTransfer(target, callbacks);
    try {
      return new StandaloneSftp(connection, new SftpSession(await connection.openSftp()));
    } catch (error) {
      connection.close();
      throw error;
    }
  }

  home(): Promise<string> {
    return this.session.realpath('.');
  }

  list = (path: string) => this.session.list(path);
  download = (
    remotePath: string,
    localDirectory: string,
    onProgress: Parameters<SftpSession['download']>[2],
  ) => this.session.download(remotePath, localDirectory, onProgress);
  upload = (
    localPath: string,
    remoteDirectory: string,
    onProgress: Parameters<SftpSession['upload']>[2],
  ) => this.session.upload(localPath, remoteDirectory, onProgress);

  close(): void {
    this.session.end();
    this.connection.close();
  }
}

/**
 * SCP on a connection of its own.
 *
 * Nothing is opened at connect time beyond the SSH connection itself: SCP has no session
 * of its own, each transfer being one exec channel. That also means connecting cannot
 * tell whether the device has an SCP server — the first transfer is what finds out.
 */
export async function connectStandaloneScp(
  target: FileTargetInput,
  callbacks: StandaloneCallbacks,
): Promise<FileTransport> {
  const connection = await connectForTransfer(target, callbacks);
  return new ScpTransport(
    (command) => connection.exec(command),
    () => connection.close(),
  );
}
