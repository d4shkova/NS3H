/** On-disk config shapes (§4). Plain JSON, hand-editable, no secrets. */

import type { Protocol } from './types.js';

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface SerialConfig {
  path: string;
  baudRate: number;
  dataBits: 7 | 8;
  parity: 'none' | 'even' | 'odd';
  stopBits: 1 | 2;
  flowControl: 'none' | 'rtscts' | 'xonxoff';
}

/** A credential defined on the host itself rather than shared from the list. */
export interface InlineCredential {
  type: 'password' | 'key';
  username: string;
  keyPath: string | null;
  hasPassphrase: boolean;
}

export interface Host {
  id: string;
  name: string;
  protocol: Protocol;
  folderId: string | null;
  address: string | null;
  port: number | null;
  /** Mutually exclusive with inlineCredential. */
  credentialId: string | null;
  inlineCredential: InlineCredential | null;
  logging: boolean;
  /**
   * Pinned to the sidebar by the user, under the hosts they connect to most.
   *
   * Off unless it is asked for: a favourite is a statement about this device, and an
   * install that has never opened the box should have an empty list rather than one
   * that quietly filled itself.
   */
  favorite: boolean;
  serial: SerialConfig | null;
  createdAt: string;
}

export interface HostsFile {
  version: 1;
  folders: Folder[];
  hosts: Host[];
}

export interface Credential {
  id: string;
  name: string;
  type: 'password' | 'key';
  username: string;
  /** Private keys stay where they are — NS3H never copies key material. */
  keyPath: string | null;
  hasPassphrase: boolean;
}

export interface CredentialsFile {
  version: 1;
  credentials: Credential[];
}

/** How often one saved host has been connected to, and when it last was. */
export interface HostUsage {
  count: number;
  /** ISO timestamp of the most recent connection — the tie-break between equal counts. */
  lastAt: string;
}

export interface Settings {
  version: 1;
  /** Unset on first run; session logging is blocked until it is chosen (§4.3). */
  logDirectory: string | null;
  theme: string;
  fontFamily: string;
  fontSize: number;
  scrollback: number;
  sidebarWidth: number;
  /** Warn before pasting more than one line into a session (§ user preference). */
  pasteWarnMultiline: boolean;
  /**
   * Host folders the user has folded shut, by id.
   *
   * Collapsed rather than expanded: open is the default, so an untouched install stores
   * nothing, and a folder that is deleted simply stops being mentioned.
   */
  collapsedFolders: string[];
  /**
   * Connection counts per host id, which is what the sidebar's frequent list is ordered
   * by. Kept in settings rather than in the hosts file so that counting a connection
   * never rewrites the thing being counted — a hosts file is what the user edits and
   * exports, and it should not churn every time a session is opened.
   */
  hostUsage: Record<string, HostUsage>;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  logDirectory: null,
  theme: 'midnatt',
  fontFamily: 'JetBrains Mono',
  fontSize: 13,
  scrollback: 10000,
  sidebarWidth: 20,
  pasteWarnMultiline: true,
  collapsedFolders: [],
  hostUsage: {},
};

export const EMPTY_HOSTS: HostsFile = { version: 1, folders: [], hosts: [] };
export const EMPTY_CREDENTIALS: CredentialsFile = { version: 1, credentials: [] };

export type SecretKind = 'password' | 'passphrase';

/** Why secret storage is unavailable, so the UI can say something specific. */
export interface SecretsStatus {
  available: boolean;
  reason?: string;
}

export interface ConfigSnapshot {
  hosts: HostsFile;
  credentials: CredentialsFile;
  settings: Settings;
  secrets: SecretsStatus;
}
