import { createReadStream, createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { once } from 'node:events';
import type { ClientChannel } from 'ssh2';
import type { RemoteEntry, TransferProgress } from '@shared/transfer.js';
import { sortEntries, type FileTransport } from './transport.js';
import {
  ScpChannel,
  formatControlLine,
  parseControlLine,
  quoteRemotePath,
} from './scpProtocol.js';

/** Opens an exec channel on whichever SSH connection is underneath. */
export type ExecChannel = (command: string) => Promise<ClientChannel>;

/**
 * Thrown when the remote side cannot be browsed. SCP has no listing operation at all —
 * `ls` is a separate command, and a switch does not have one — so the pane falls back to
 * a typed path rather than pretending the directory is empty.
 */
export class NotBrowsableError extends Error {
  readonly browsable = false;
  constructor(message: string) {
    super(message);
    this.name = 'NotBrowsableError';
  }
}

/**
 * File transfer over SCP (§ phase 13).
 *
 * The reason this exists: a great deal of network gear runs an SCP server and no SFTP
 * subsystem — on IOS, `ip scp server enable` with nothing equivalent for SFTP — so the
 * SFTP channel is refused and SCP is the only way in. It works over a session that is
 * already open, or over a connection of its own.
 */
export class ScpTransport implements FileTransport {
  constructor(
    private readonly exec: ExecChannel,
    private readonly disposer: (() => void) | null = null,
  ) {}

  /**
   * `pwd` if the device has one. A switch does not, and answers with nothing usable —
   * in which case the pane starts at `/` and the user types where they mean.
   */
  async home(): Promise<string> {
    try {
      const output = (await this.run('pwd')).trim().split('\n').pop() ?? '';
      return output.startsWith('/') ? output : '/';
    } catch {
      return '/';
    }
  }

  /**
   * SCP cannot list, so this runs `ls` and parses it. That works on anything POSIX and
   * fails on network gear, which is reported as such rather than as an empty directory.
   */
  async list(path: string): Promise<RemoteEntry[]> {
    let output: string;
    try {
      output = await this.run(`ls -la ${quoteRemotePath(path)}`);
    } catch (error) {
      throw new NotBrowsableError(
        `This device cannot list ${path} over SCP (${(error as Error).message}). ` +
          'SCP has no directory listing of its own — NS3H runs `ls`, which a switch or ' +
          'router does not have. Type a path on the right to send or fetch a file by name.',
      );
    }

    const entries = parseLsOutput(output, path);
    if (entries.length === 0 && !/^total /m.test(output)) {
      throw new NotBrowsableError(
        `This device answered \`ls\` with something that is not a directory listing. ` +
          'Type a path on the right to send or fetch a file by name.',
      );
    }
    return entries;
  }

  async download(
    remotePath: string,
    localDirectory: string,
    onProgress: (progress: TransferProgress) => void,
  ): Promise<string> {
    const channel = new ScpChannel(await this.exec(`scp -f ${quoteRemotePath(remotePath)}`));
    let target = '';

    try {
      // The exchange is strictly turn-taking: we say ready, it describes the file, we say
      // ready again, it sends the bytes.
      channel.ack();
      await channel.readAck();

      const header = parseControlLine(await channel.readLine());
      target = join(localDirectory, basename(header.name || remotePath));
      const sink = createWriteStream(target);
      channel.ack();

      let transferred = 0;
      await channel.readBody(header.size, (chunk) => {
        transferred += chunk.length;
        onProgress({ transferred, total: header.size });
        // A full write buffer is the disk asking for time; the channel waits for it.
        return sink.write(chunk) ? undefined : once(sink, 'drain').then(() => undefined);
      });

      await new Promise<void>((resolve, reject) => {
        sink.end((error?: Error | null) => (error ? reject(error) : resolve()));
      });

      // The trailing status byte, then our own — after which the device closes.
      await channel.readAck();
      channel.ack();
      channel.end();
      return target;
    } catch (error) {
      channel.end();
      // A half-written file is worse than none — it looks like a completed transfer.
      if (target) await rm(target, { force: true }).catch(() => {});
      throw error;
    }
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

    const name = basename(localPath);
    const channel = new ScpChannel(await this.exec(`scp -t ${quoteRemotePath(remoteDirectory)}`));

    try {
      await channel.readAck();
      channel.write(
        formatControlLine({ mode: info.mode & 0o777 || 0o644, size: info.size, name }),
      );
      await channel.readAck();

      let transferred = 0;
      const source = createReadStream(localPath);
      source.on('data', (chunk: Buffer | string) => {
        transferred += chunk.length;
        onProgress({ transferred, total: info.size });
      });

      for await (const chunk of source) channel.write(chunk as Buffer);

      // End-of-file marker, then the device's verdict on the whole thing.
      channel.write(Buffer.from([0]));
      await channel.readAck();
      channel.end();

      return `${remoteDirectory.replace(/\/+$/, '')}/${name}`;
    } catch (error) {
      channel.end();
      throw error;
    }
  }

  close(): void {
    this.disposer?.();
  }

  /** Runs a command and returns its stdout, failing on a non-zero exit. */
  private async run(command: string): Promise<string> {
    const channel = await this.exec(command);
    const out: Buffer[] = [];
    const err: Buffer[] = [];

    channel.on('data', (chunk: Buffer) => out.push(chunk));
    channel.stderr?.on('data', (chunk: Buffer) => err.push(chunk));

    const [code] = (await once(channel, 'close')) as [number | null];
    if (code !== 0 && code !== null) {
      const detail = Buffer.concat(err).toString('utf8').trim();
      throw new Error(detail || `the command exited with status ${code}`);
    }
    return Buffer.concat(out).toString('utf8');
  }
}

const LS_LINE =
  /^([dlrwxsSt-]{10})\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\w{3}\s+\d+\s+[\d:]{4,5})\s+(.*)$/;

/**
 * Parses `ls -la`. Deliberately forgiving: the columns vary between coreutils, BusyBox and
 * BSD, and a line that does not fit is skipped rather than failing the listing.
 */
export function parseLsOutput(output: string, path: string): RemoteEntry[] {
  const entries: RemoteEntry[] = [];

  for (const line of output.split('\n')) {
    const match = LS_LINE.exec(line.trim());
    if (!match) continue;

    const [, permissions, size, when, rawName] = match;
    // `link -> target` is one entry, not two.
    const name = permissions.startsWith('l') ? rawName.split(' -> ')[0] : rawName;
    if (name === '.' || name === '..' || name === '') continue;

    entries.push({
      name,
      path: `${path.replace(/\/+$/, '')}/${name}`,
      directory: permissions.startsWith('d'),
      symlink: permissions.startsWith('l'),
      size: Number.parseInt(size, 10),
      // `ls` prints a local, year-less date; it is shown as sent rather than turned into
      // a timestamp that would be wrong by up to a year.
      modified: when,
      permissions,
    });
  }

  return sortEntries(entries);
}
