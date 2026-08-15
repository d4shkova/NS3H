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
