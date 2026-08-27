import type { RemoteCapabilities, RemoteEntry, TransferProgress } from '@shared/transfer.js';

/**
 * What the transfer pane needs from a remote side, whatever is carrying it.
 *
 * Three things implement this: SFTP on an open session, SFTP on its own connection, and
 * SMB. The pane, the IPC handlers and the progress reporting are the same for all three
 * — only the bytes underneath differ.
 */
export interface FileTransport {
  /** Where the pane opens: the device's home directory, or the share root. */
  home(): Promise<string>;
  list(path: string): Promise<RemoteEntry[]>;
  download(
    remotePath: string,
    localDirectory: string,
    onProgress: (progress: TransferProgress) => void,
  ): Promise<string>;
  upload(
    localPath: string,
    remoteDirectory: string,
    onProgress: (progress: TransferProgress) => void,
  ): Promise<string>;
  close(): void;

  /**
   * The file operations, all optional: a transport implements what its protocol can
   * actually carry, and the pane asks `capabilitiesOf` which ones are there rather than
   * offering a menu item that fails when it is clicked.
   */
  rename?(path: string, name: string): Promise<void>;
  remove?(path: string, directory: boolean): Promise<void>;
  /** `mode` is the POSIX permission bits, 0o000–0o7777. */
  chmod?(path: string, mode: number): Promise<void>;
  mkdir?(path: string): Promise<void>;
}

/** Which operations a transport implements. Derived, so the two cannot drift apart. */
export function capabilitiesOf(transport: FileTransport): RemoteCapabilities {
  return {
    rename: typeof transport.rename === 'function',
    remove: typeof transport.remove === 'function',
    chmod: typeof transport.chmod === 'function',
    mkdir: typeof transport.mkdir === 'function',
  };
}

/** Directories first, then by name — the order both panes sort in. */
export function sortEntries(entries: RemoteEntry[]): RemoteEntry[] {
  return entries.sort((a, b) => {
    if (a.directory !== b.directory) return a.directory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
