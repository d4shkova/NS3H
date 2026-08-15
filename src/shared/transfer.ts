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

/**
 * A transfer that does not ride on an open terminal session (§ phase 12).
 *
 * SFTP over its own SSH connection, or SMB to a Windows or Samba share. Neither needs a
 * CLI session first — a firmware image often has to be pushed to a box nobody wants a
 * shell on, and the file server it comes from has no shell at all.
 */
export type FileProtocol = 'sftp' | 'scp' | 'smb';

/** How a session's own transfer is carried. SCP is the fallback for gear with no SFTP. */
export type SessionTransferMode = 'sftp' | 'scp';

export interface FileTargetInput {
  protocol: FileProtocol;
  host: string;
  port: number;
  username: string;
  /** Sent for this connection only — a standalone target is never written to disk. */
  password?: string;
  /** SFTP with key auth. */
  keyPath?: string;
  passphrase?: string;
  /** Reuses a saved credential's secret instead of a typed one. */
  credentialId?: string;
  /** SMB: the share to attach, without the leading `\\host\`. */
  share?: string;
  /** SMB: NTLM domain or workgroup. */
  domain?: string;
}

/** A live standalone connection, as the transfer pane lists it. */
export interface FileConnection {
  id: string;
  protocol: FileProtocol;
  /** `admin@10.1.1.5` or `\\fileserver\images`. */
  label: string;
  /** Where the pane opens: the SFTP home directory, or the share root. */
  home: string;
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
