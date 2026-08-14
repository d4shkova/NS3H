import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannel } from '@shared/ipc.js';
import type { Ns3hApi } from '@shared/api.js';
import type {
  AuthPromptRequest,
  HostKeyPromptRequest,
  OpenSessionResult,
  SessionDataEvent,
  SessionNoticeEvent,
  SessionStatusEvent,
  SshTarget,
} from '@shared/types.js';

type Unsubscribe = () => void;

function subscribe<T>(channel: string, handler: (payload: T) => void): Unsubscribe {
  const listener = (_event: IpcRendererEvent, payload: T) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: Ns3hApi = {
  platform: () => ipcRenderer.invoke(IpcChannel.platformInfo) as Promise<{ platform: string }>,

  session: {
    openSsh: (target: SshTarget) =>
      ipcRenderer.invoke(IpcChannel.sessionOpenSsh, target) as Promise<OpenSessionResult>,
    write: (sessionId: string, data: string) =>
      ipcRenderer.invoke(IpcChannel.sessionWrite, sessionId, data) as Promise<void>,
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IpcChannel.sessionResize, sessionId, cols, rows) as Promise<void>,
    close: (sessionId: string) =>
      ipcRenderer.invoke(IpcChannel.sessionClose, sessionId) as Promise<void>,

    onData: (handler: (event: SessionDataEvent) => void) =>
      subscribe<SessionDataEvent>(IpcChannel.sessionData, handler),
    onStatus: (handler: (event: SessionStatusEvent) => void) =>
      subscribe<SessionStatusEvent>(IpcChannel.sessionStatus, handler),
    onNotice: (handler: (event: SessionNoticeEvent) => void) =>
      subscribe<SessionNoticeEvent>(IpcChannel.sessionNotice, handler),
  },

  hostKey: {
    onPrompt: (handler: (request: HostKeyPromptRequest) => void) =>
      subscribe<HostKeyPromptRequest>(IpcChannel.hostKeyPrompt, handler),
    respond: (promptId: string, accepted: boolean) =>
      ipcRenderer.invoke(IpcChannel.hostKeyRespond, promptId, accepted) as Promise<void>,
  },

  auth: {
    onPrompt: (handler: (request: AuthPromptRequest) => void) =>
      subscribe<AuthPromptRequest>(IpcChannel.authPrompt, handler),
    respond: (promptId: string, responses: string[] | null) =>
      ipcRenderer.invoke(IpcChannel.authRespond, promptId, responses) as Promise<void>,
  },

  window: {
    minimize: () => ipcRenderer.invoke(IpcChannel.windowMinimize) as Promise<void>,
    toggleMaximize: () => ipcRenderer.invoke(IpcChannel.windowToggleMaximize) as Promise<void>,
    close: () => ipcRenderer.invoke(IpcChannel.windowClose) as Promise<void>,
  },
};

contextBridge.exposeInMainWorld('ns3h', api);
