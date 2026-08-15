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
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  logDirectory: null,
  theme: 'ns3h-dark',
  fontFamily: 'JetBrains Mono',
  fontSize: 13,
  scrollback: 10000,
  sidebarWidth: 20,
  pasteWarnMultiline: true,
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
