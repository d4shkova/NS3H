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

/**
 * A saved credential, named rather than spelled out. Quick connect may send this instead
 * of a username and secret; main resolves it into one of the `SshAuth` kinds above before
 * anything dials, so the secret never travels to the renderer and back.
 *
 * Deliberately not a member of `SshAuth`: everything downstream of the IPC boundary takes
 * an auth that is already resolved, and the type says so.
 */
export interface SavedCredentialAuth {
  kind: 'saved';
  credentialId: string;
}

/** What the renderer may ask to connect to — the resolved form is `SshTarget`. */
export interface SshTargetInput extends Omit<SshTarget, 'auth'> {
  auth: SshAuth | SavedCredentialAuth;
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

/**
 * Emitted whenever a session's logging state changes: when its log file opens, and
 * again whenever the user toggles logging for that session. Not a status transition.
 */
export interface SessionLogEvent {
  sessionId: string;
  /** The file being written, or null when logging is off for this session. */
  logPath: string | null;
  logging: boolean;
}

/** The answer to a logging toggle — what the session is actually doing now. */
export interface SessionLoggingResult {
  logging: boolean;
  logPath: string | null;
  /** Why the request could not be honoured, when `logging` is not what was asked for. */
  reason?: string;
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
  /** Whether this session starts out logging — a saved host follows its own setting. */
  logging: boolean;
}
