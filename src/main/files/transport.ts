import type { RemoteEntry, TransferProgress } from '@shared/transfer.js';

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
}

/** Directories first, then by name — the order both panes sort in. */
export function sortEntries(entries: RemoteEntry[]): RemoteEntry[] {
  return entries.sort((a, b) => {
    if (a.directory !== b.directory) return a.directory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
