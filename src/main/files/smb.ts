import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable, Writable } from 'node:stream';
import type { FileTargetInput, RemoteEntry, TransferProgress } from '@shared/transfer.js';
import { sortEntries, type FileTransport } from './transport.js';

/**
 * The subset of `@tryjsky/v9u-smb2` this uses. The package ships types, but they omit
 * `size` on a stat — which the wire format does carry, and the pane needs.
 */
interface SmbStats {
  name: string;
  size: number;
  mtime: Date;
  isDirectory(): boolean;
}

interface SmbClient {
  readdir(path: string, options: { stats: true }): Promise<SmbStats[]>;
  createReadStream(path: string): Promise<Readable & { fileSize: number }>;
  createWriteStream(path: string): Promise<Writable>;
  stat(path: string): Promise<SmbStats>;
  disconnect(): void;
}

type SmbConstructor = new (options: {
  share: string;
  domain: string;
  username: string;
  password: string;
  port?: number;
  autoCloseTimeout?: number;
}) => SmbClient;

/** Loaded on first SMB connection, never at startup — see the note in ssh2.ts. */
let pending: Promise<SmbConstructor> | null = null;

function loadSmb(): Promise<SmbConstructor> {
  pending ??= import('@tryjsky/v9u-smb2').then(
    (module) => (module.default ?? module) as unknown as SmbConstructor,
  );
  return pending;
}

/**
 * The pane speaks in POSIX paths rooted at `/`; SMB wants backslash-separated paths
 * relative to the share, with the root written as an empty string. Everything crossing
 * this boundary is converted, so nothing above has to know.
 */
export function toSmbPath(path: string): string {
  return path.replace(/^\/+/, '').replace(/\//g, '\\');
}

export function joinShare(base: string, segment: string): string {
  if (segment === '..') {
    const trimmed = base.replace(/\/+$/, '');
    const parent = trimmed.slice(0, trimmed.lastIndexOf('/'));
    return parent || '/';
  }
  return `${base === '/' ? '' : base.replace(/\/+$/, '')}/${segment}`;
}

/** `\\fileserver\images` — how a share is written everywhere a user would see it. */
export function shareUnc(host: string, share: string): string {
  return `\\\\${host}\\${share}`;
}

export class SmbTransport implements FileTransport {
  private constructor(private readonly client: SmbClient) {}

  static async connect(target: FileTargetInput): Promise<SmbTransport> {
    // Trimmed of whitespace as well as separators: a field holding only spaces is empty,
    // and letting it through means the failure arrives from the far end as a puzzle.
    const share = (target.share ?? '').trim().replace(/^[\\/]+|[\\/]+$/g, '');
    if (!share) {
      throw new Error(
        'An SMB connection needs a share name — the part after the host in ' +
          `\\\\${target.host}\\<share>.`,
      );
    }

    const SMB2 = await loadSmb();
    const client = new SMB2({
      share: shareUnc(target.host, share),
      domain: target.domain || 'WORKGROUP',
      username: target.username,
      password: target.password ?? '',
      ...(target.port && target.port !== 445 ? { port: target.port } : {}),
    });

    const transport = new SmbTransport(client);
    try {
      // Nothing is sent until the first request, so the share root is read here: a bad
      // password or share name should fail at connect, not on the first click.
      await transport.list('/');
    } catch (error) {
      client.disconnect();
      throw explainSmbError(error, target.host, share, target.port);
    }
    return transport;
  }

  /** SMB has no per-user home; a share opens at its root. */
  home(): Promise<string> {
    return Promise.resolve('/');
  }

  async list(path: string): Promise<RemoteEntry[]> {
    const entries = await this.client.readdir(toSmbPath(path), { stats: true });
    return sortEntries(
      entries.map((entry) => ({
        name: entry.name,
        path: joinShare(path, entry.name),
        directory: entry.isDirectory(),
        // SMB reparse points are not POSIX symlinks and are not followed here.
        symlink: false,
        size: entry.size,
        modified: entry.mtime instanceof Date ? entry.mtime.toISOString() : '',
        // No POSIX mode on the wire; the column says so rather than inventing bits.
        permissions: entry.isDirectory() ? 'dir' : '—',
      })),
    );
  }

  async download(
    remotePath: string,
    localDirectory: string,
    onProgress: (progress: TransferProgress) => void,
  ): Promise<string> {
    const source = await this.client.createReadStream(toSmbPath(remotePath));
    const total = source.fileSize ?? 0;
    const target = join(localDirectory, basename(remotePath.replace(/\/+$/, '')));

    let transferred = 0;
    source.on('data', (chunk: Buffer) => {
      transferred += chunk.length;
      onProgress({ transferred, total });
    });

    try {
      await pipeline(source, createWriteStream(target));
    } catch (error) {
      const { rm } = await import('node:fs/promises');
      await rm(target, { force: true }).catch(() => {});
      throw error;
    }
    return target;
  }

  async upload(
    localPath: string,
    remoteDirectory: string,
    onProgress: (progress: TransferProgress) => void,
  ): Promise<string> {
    const info = await stat(localPath);
    if (info.isDirectory()) {
      throw new Error('Directories cannot be transferred yet — send individual files.');
    }
    const target = joinShare(remoteDirectory, basename(localPath));

    let transferred = 0;
    const source = createReadStream(localPath);
    source.on('data', (chunk: Buffer | string) => {
      transferred += chunk.length;
      onProgress({ transferred, total: info.size });
    });

    await pipeline(source, await this.client.createWriteStream(toSmbPath(target)));
    return target;
  }

  close(): void {
    this.client.disconnect();
  }
}

/**
 * SMB reports failures as `STATUS_*` codes, which are precise and mean nothing to
 * anyone who has not read MS-SMB2. The common four are named.
 */
export function explainSmbError(
  error: unknown,
  host: string,
  share: string,
  port = 445,
): Error {
  const code = (error as { code?: string })?.code ?? '';
  const message = (error as Error)?.message ?? String(error);

  const explained = (text: string) => {
    const wrapped = new Error(text);
    wrapped.stack = `${wrapped.name}: ${text}`;
    return wrapped;
  };

  switch (code) {
    case 'STATUS_LOGON_FAILURE':
      return explained(
        `${host} rejected those credentials. Check the username, password, and whether ` +
          'the account needs a domain or workgroup rather than the default WORKGROUP.',
      );
    case 'STATUS_BAD_NETWORK_NAME':
      return explained(
        `${host} has no share called "${share}". Check the share name — it is the part ` +
          `after the host in \\\\${host}\\<share>, not a path inside it.`,
      );
    case 'STATUS_ACCESS_DENIED':
      return explained(
        `${host} accepted the login but refused access to "${share}". The account has no ` +
          'permission on that share.',
      );
    case 'STATUS_NOT_SUPPORTED':
      return explained(
        `${host} refused the SMB2 dialect. NS3H speaks SMB2 only — a host offering just ` +
          'SMB1 (an old NAS, or a device with SMB2 disabled) cannot be reached this way.',
      );
    case 'ECONNREFUSED':
      return explained(
        `${host} refused the connection on port ${port}. Is file sharing enabled, and is ` +
          'the port open through the firewall?',
      );
    case 'ETIMEDOUT':
    case 'EHOSTUNREACH':
      return explained(`No route to ${host} on port ${port}, or a firewall is dropping it.`);
    default:
      return explained(`SMB connection to \\\\${host}\\${share} failed: ${message}`);
  }
}
