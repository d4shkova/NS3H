/** Shapes for the SFTP dual pane (§6.3 / phase 9). */

export interface RemoteEntry {
  name: string;
  path: string;
  directory: boolean;
  symlink: boolean;
  size: number;
  modified: string;
  permissions: string;
}

export interface LocalEntry {
  name: string;
  path: string;
  directory: boolean;
  size: number;
  modified: string;
}

export interface TransferProgress {
  transferred: number;
  total: number;
}

export interface TransferEvent {
  id: string;
  sessionId: string;
  direction: 'download' | 'upload';
  name: string;
  transferred: number;
  total: number;
  status: 'running' | 'done' | 'error';
  detail?: string;
}

export interface Collision {
  kind: 'host' | 'folder' | 'credential';
  id: string;
  existing: string;
  incoming: string;
}

export interface ImportPreview {
  kind: 'config' | 'bundle';
  /** A backup needs its passphrase before anything can be reported. */
  needsPassphrase?: boolean;
  added: { hosts: number; folders: number; credentials: number };
  collisions: Collision[];
  /** §7 — key files that are not where the backup says they are. */
  missingKeys: { id: string; name: string; keyPath: string }[];
}

export interface ImportRequest {
  path: string;
  passphrase?: string;
  /** Per-id: true to overwrite, absent to keep what is here. */
  resolutions?: Record<string, boolean>;
}
