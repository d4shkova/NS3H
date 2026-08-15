/** Types shared between main, preload, and renderer. No runtime imports from either side. */

export type Protocol = 'ssh' | 'telnet' | 'serial';

export type SshAuth =
  | { kind: 'password'; username: string; password?: string }
  | { kind: 'key'; username: string; keyPath: string; passphrase?: string }
  /** No stored credential — everything is prompted for inline. */
  | { kind: 'prompt'; username: string };

export interface SshTarget {
  /** Friendly name shown in the tab and status bar. */
  name: string;
  address: string;
  port: number;
  auth: SshAuth;
}

export interface TelnetTargetInput {
  name: string;
  address: string;
  port: number;
}

export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  /** `/dev/ttyUSB0 — FTDI FT232R`; users do not recognise bare paths. */
  label: string;
}

export type SessionStatus = 'connecting' | 'connected' | 'closed' | 'error';

export interface NegotiatedAlgorithms {
  kex: string;
  serverHostKey: string;
  /** Client → server cipher; the two directions are the same in practice. */
  cipher: string;
  mac: string;
  hostKeyType: string;
  fingerprint: string;
}

export interface SessionInfo {
  id: string;
  protocol: Protocol;
  name: string;
  address: string;
  port: number;
  username: string;
  status: SessionStatus;
  negotiation?: NegotiatedAlgorithms;
  /** Set once the session's log file is open. */
  logPath?: string;
}

export interface SessionStatusEvent {
  sessionId: string;
  status: SessionStatus;
  /** Human-readable detail for `error` and `closed`. */
  detail?: string;
  negotiation?: NegotiatedAlgorithms;
  /** Set once the session's log file is open (§6.2 logging indicator). */
  logPath?: string;
}

export interface SessionDataEvent {
  sessionId: string;
  data: Uint8Array;
}

/** Emitted once, when a session's log file opens. Not a status transition. */
export interface SessionLogEvent {
  sessionId: string;
  logPath: string;
}

export type NoticeLevel = 'info' | 'warn' | 'error';

/** Out-of-band text rendered into the terminal pane (retry ladder, failures). */
export interface SessionNoticeEvent {
  sessionId: string;
  level: NoticeLevel;
  text: string;
}

export interface HostKeyPromptRequest {
  id: string;
  sessionId: string;
  address: string;
  port: number;
  keyType: string;
  fingerprint: string;
  /** Present when a different key was previously accepted for this address:port. */
  previous?: {
    keyType: string;
    fingerprint: string;
    acceptedAt: string;
  };
}

export interface AuthPromptField {
  key: string;
  label: string;
  /** false for password-style fields — the renderer must mask them. */
  echo: boolean;
}

export interface AuthPromptRequest {
  id: string;
  sessionId: string;
  title: string;
  instructions?: string;
  fields: AuthPromptField[];
}

export interface OpenSessionResult {
  sessionId: string;
}
