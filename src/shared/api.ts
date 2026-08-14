import type {
  AuthPromptRequest,
  HostKeyPromptRequest,
  OpenSessionResult,
  SessionDataEvent,
  SessionNoticeEvent,
  SessionStatusEvent,
  SshTarget,
} from './types.js';

export type Unsubscribe = () => void;

/**
 * The whole surface the renderer can reach. Declared here rather than inferred from
 * the preload so the renderer never pulls in Electron's type graph.
 */
export interface Ns3hApi {
  platform(): Promise<{ platform: string }>;

  session: {
    openSsh(target: SshTarget): Promise<OpenSessionResult>;
    write(sessionId: string, data: string): Promise<void>;
    resize(sessionId: string, cols: number, rows: number): Promise<void>;
    close(sessionId: string): Promise<void>;
    onData(handler: (event: SessionDataEvent) => void): Unsubscribe;
    onStatus(handler: (event: SessionStatusEvent) => void): Unsubscribe;
    onNotice(handler: (event: SessionNoticeEvent) => void): Unsubscribe;
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
