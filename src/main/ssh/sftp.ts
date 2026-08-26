import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { SFTPWrapper } from 'ssh2';
import type { RemoteEntry, TransferProgress } from '@shared/transfer.js';

/** POSIX file mode bits, since the remote side is not the local platform. */
function isDirectory(mode: number): boolean {
  return (mode & 0o170000) === 0o040000;
}

function isSymlink(mode: number): boolean {
  return (mode & 0o170000) === 0o120000;
}

export function permissionString(mode: number): string {
  const bits = ['r', 'w', 'x'];
  let text = isDirectory(mode) ? 'd' : isSymlink(mode) ? 'l' : '-';
  for (let group = 2; group >= 0; group -= 1) {
    for (let bit = 2; bit >= 0; bit -= 1) {
      text += mode & (1 << (group * 3 + bit)) ? bits[2 - bit] : '-';
    }
  }
  return text;
}

/**
 * The path a file called `name` would have, alongside `path`.
 *
 * Renaming asks for a name, not a path — moving a file elsewhere is a different job with
 * a different set of ways to go wrong — so the new name is placed in the directory the
 * file is already in.
 */
export function siblingPath(path: string, name: string): string {
  const parent = path.replace(/\/+$/, '').replace(/\/[^/]*$/, '');
  return `${parent}/${name}`;
}

/** A remote path is joined POSIX-style regardless of what the client runs on. */
export function joinRemote(base: string, segment: string): string {
  if (segment === '..') {
    const trimmed = base.replace(/\/+$/, '');
    const parent = trimmed.slice(0, trimmed.lastIndexOf('/'));
    return parent || '/';
  }
  return `${base.replace(/\/+$/, '')}/${segment}`;
}

export class SftpSession {
  constructor(private readonly sftp: SFTPWrapper) {}

  /** The device's idea of home, which is where a transfer pane should start. */
  realpath(path: string): Promise<string> {
    return new Promise((resolvePath, reject) => {
      this.sftp.realpath(path, (error, resolved) =>
        error ? reject(error) : resolvePath(resolved),
      );
    });
  }

  list(path: string): Promise<RemoteEntry[]> {
    return new Promise((resolveList, reject) => {
      this.sftp.readdir(path, (error, list) => {
        if (error) {
          reject(new Error(`Could not read ${path}: ${error.message}`));
          return;
        }
        const entries = list.map((item) => ({
          name: item.filename,
          path: joinRemote(path, item.filename),
          directory: isDirectory(item.attrs.mode),
          symlink: isSymlink(item.attrs.mode),
          size: item.attrs.size,
          modified: new Date(item.attrs.mtime * 1000).toISOString(),
          permissions: permissionString(item.attrs.mode),
        }));
        entries.sort((a, b) => {
          if (a.directory !== b.directory) return a.directory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        resolveList(entries);
      });
    });
  }

  async download(
    remotePath: string,
    localDirectory: string,
    onProgress: (progress: TransferProgress) => void,
  ): Promise<string> {
    const size = await this.size(remotePath);
    const target = join(localDirectory, basename(remotePath));

    let transferred = 0;
    const source = this.sftp.createReadStream(remotePath);
    source.on('data', (chunk: Buffer) => {
      transferred += chunk.length;
      onProgress({ transferred, total: size });
    });

    try {
      await pipeline(source, createWriteStream(target));
    } catch (error) {
      // A half-written file is worse than none: it looks like a successful transfer to
      // anything that opens it later. The transfer error is what the user gets told.
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
    const target = joinRemote(remoteDirectory, basename(localPath));

    let transferred = 0;
    const source = createReadStream(localPath);
    source.on('data', (chunk: Buffer | string) => {
      transferred += chunk.length;
      onProgress({ transferred, total: info.size });
    });

    await pipeline(source, this.sftp.createWriteStream(target));
    return target;
  }

  /** Renames in place: the file keeps the directory it is in and takes a new name. */
  rename(path: string, name: string): Promise<void> {
    return new Promise((done, reject) => {
      this.sftp.rename(path, siblingPath(path, name), (error) =>
        error ? reject(new Error(`Could not rename ${path}: ${error.message}`)) : done(),
      );
    });
  }

  /**
   * Deletes a file, or an empty directory.
   *
   * A directory with anything in it is refused by the device, and that refusal is passed
   * on as it is: a recursive delete over SFTP is a walk of the tree issuing one unlink
   * per file, and doing that from a menu item on a mistaken click is not worth the
   * convenience.
   */
  remove(path: string, directory: boolean): Promise<void> {
    return new Promise((done, reject) => {
      const finish = (error: Error | null | undefined) =>
        error ? reject(new Error(`Could not delete ${path}: ${error.message}`)) : done();
      if (directory) this.sftp.rmdir(path, finish);
      else this.sftp.unlink(path, finish);
    });
  }

  chmod(path: string, mode: number): Promise<void> {
    return new Promise((done, reject) => {
      this.sftp.chmod(path, mode, (error) =>
        error
          ? reject(
              new Error(
                `Could not set the permissions on ${path}: ${error.message}`,
              ),
            )
          : done(),
      );
    });
  }

  mkdir(path: string): Promise<void> {
    return new Promise((done, reject) => {
      this.sftp.mkdir(path, (error) =>
        error ? reject(new Error(`Could not create ${path}: ${error.message}`)) : done(),
      );
    });
  }

  private size(path: string): Promise<number> {
    return new Promise((resolveSize, reject) => {
      this.sftp.stat(path, (error, attrs) =>
        error ? reject(error) : resolveSize(attrs.size),
      );
    });
  }

  end(): void {
    this.sftp.end();
  }
}

export interface LocalEntry {
  name: string;
  path: string;
  directory: boolean;
  size: number;
  modified: string;
}

/** The local half of the dual pane. Kept here so both sides read the same shape. */
export async function listLocal(path: string): Promise<{ path: string; entries: LocalEntry[] }> {
  const full = resolve(path || homedir());
  const names = await readdir(full);

  // Stat in parallel: one round trip per file in series makes a directory of a few
  // thousand entries take seconds on a network mount, and libuv queues the work anyway.
  const stats = await Promise.all(
    names.map(async (name): Promise<LocalEntry | null> => {
      const entryPath = join(full, name);
      try {
        const info = await stat(entryPath);
        return {
          name,
          path: entryPath,
          directory: info.isDirectory(),
          size: info.size,
          modified: info.mtime.toISOString(),
        };
      } catch {
        // Unreadable entries are skipped rather than failing the listing.
        return null;
      }
    }),
  );
  const entries = stats.filter((entry): entry is LocalEntry => entry !== null);

  entries.sort((a, b) => {
    if (a.directory !== b.directory) return a.directory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const parent = dirname(full);
  if (parent !== full) {
    entries.unshift({ name: '..', path: parent, directory: true, size: 0, modified: '' });
  }

  return { path: full, entries };
}
