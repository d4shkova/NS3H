import type {
  ConfigSnapshot,
  Credential,
  Folder,
  Host,
  Settings,
} from './config.js';
import type { SerialConfig } from './config.js';
import type { LogDocument, LogFileInfo, LogFolderInfo, LogMatch } from './logs.js';
import type {
  AuthPromptRequest,
  HostKeyPromptRequest,
  OpenSessionResult,
  SessionDataEvent,
  SessionLogEvent,
  SessionNoticeEvent,
  SerialPortInfo,
  SessionStatusEvent,
  SshTarget,
  TelnetTargetInput,
} from './types.js';

export type Unsubscribe = () => void;

/**
 * The whole surface the renderer can reach. Declared here rather than inferred from
 * the preload so the renderer never pulls in Electron's type graph.
 */
/** Omitted fields mean "unchanged"; an empty string clears the stored secret. */
export interface CredentialSecrets {
  password?: string;
  passphrase?: string;
}

export interface Ns3hApi {
  platform(): Promise<{ platform: string }>;

  config: {
    load(): Promise<ConfigSnapshot>;
    saveHost(host: Host, secrets?: CredentialSecrets): Promise<ConfigSnapshot>;
    deleteHost(hostId: string): Promise<ConfigSnapshot>;
    saveFolder(folder: Folder): Promise<ConfigSnapshot>;
    deleteFolder(folderId: string): Promise<ConfigSnapshot>;
    saveCredential(
      credential: Credential,
      secrets?: CredentialSecrets,
    ): Promise<ConfigSnapshot>;
    deleteCredential(credentialId: string): Promise<ConfigSnapshot>;
    saveSettings(patch: Partial<Settings>): Promise<ConfigSnapshot>;
    /** Opens a native directory picker and stores the choice. Null if cancelled. */
    chooseLogDirectory(): Promise<ConfigSnapshot | null>;
  };

  shell: {
    /** Shows a file in the OS file manager. */
    reveal(path: string): Promise<void>;
  };

  clipboard: {
    read(): Promise<string>;
    write(text: string): Promise<void>;
  };

  logs: {
    folders(): Promise<LogFolderInfo[]>;
    sessions(folder: string): Promise<LogFileInfo[]>;
    /** Opens a session log for reading; the file is split into lines in main. */
    open(path: string): Promise<LogDocument>;
    lines(path: string, start: number, count: number): Promise<string[]>;
    search(path: string, query: string): Promise<LogMatch[]>;
    close(path: string): Promise<void>;
  };

  serial: {
    /** Re-enumerated on every call — adapters get plugged in mid-session. */
    list(): Promise<SerialPortInfo[]>;
  };

  session: {
    /** Connect to a saved host, resolving its credential and secret in main. */
    openHost(hostId: string): Promise<OpenSessionResult>;
    openSsh(target: SshTarget): Promise<OpenSessionResult>;
    openTelnet(target: TelnetTargetInput): Promise<OpenSessionResult>;
    openSerial(name: string, config: SerialConfig): Promise<OpenSessionResult>;
    /** Serial only: assert break for 250 ms (Cisco password recovery). */
    sendBreak(sessionId: string): Promise<void>;
    write(sessionId: string, data: string): Promise<void>;
    resize(sessionId: string, cols: number, rows: number): Promise<void>;
    close(sessionId: string): Promise<void>;
    onData(handler: (event: SessionDataEvent) => void): Unsubscribe;
    onStatus(handler: (event: SessionStatusEvent) => void): Unsubscribe;
    onNotice(handler: (event: SessionNoticeEvent) => void): Unsubscribe;
    onLog(handler: (event: SessionLogEvent) => void): Unsubscribe;
  };

  hostKey: {
    onPrompt(handler: (request: HostKeyPromptRequest) => void): Unsubscribe;
    respond(promptId: string, accepted: boolean): Promise<void>;
  };

  auth: {
    onPrompt(handler: (request: AuthPromptRequest) => void): Unsubscribe;
    respond(promptId: string, responses: string[] | null): Promise<void>;
  };

  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
  };
}
