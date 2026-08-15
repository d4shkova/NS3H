import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannel } from '@shared/ipc.js';
import type { Ns3hApi } from '@shared/api.js';
import type { SerialConfig } from '@shared/config.js';
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
} from '@shared/types.js';

type Unsubscribe = () => void;

function subscribe<T>(channel: string, handler: (payload: T) => void): Unsubscribe {
  const listener = (_event: IpcRendererEvent, payload: T) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: Ns3hApi = {
  platform: () => ipcRenderer.invoke(IpcChannel.platformInfo) as Promise<{ platform: string }>,

  config: {
    load: () => ipcRenderer.invoke(IpcChannel.configLoad),
    saveHost: (host, secrets) => ipcRenderer.invoke(IpcChannel.configSaveHost, host, secrets),
    deleteHost: (hostId) => ipcRenderer.invoke(IpcChannel.configDeleteHost, hostId),
    saveFolder: (folder) => ipcRenderer.invoke(IpcChannel.configSaveFolder, folder),
    deleteFolder: (folderId) => ipcRenderer.invoke(IpcChannel.configDeleteFolder, folderId),
    saveCredential: (credential, secrets) =>
      ipcRenderer.invoke(IpcChannel.configSaveCredential, credential, secrets),
    deleteCredential: (credentialId) =>
      ipcRenderer.invoke(IpcChannel.configDeleteCredential, credentialId),
    saveSettings: (patch) => ipcRenderer.invoke(IpcChannel.configSaveSettings, patch),
    chooseLogDirectory: () => ipcRenderer.invoke(IpcChannel.configChooseLogDirectory),
  },

  shell: {
    reveal: (path: string) => ipcRenderer.invoke(IpcChannel.revealPath, path) as Promise<void>,
  },

  serial: {
    list: () => ipcRenderer.invoke(IpcChannel.serialList) as Promise<SerialPortInfo[]>,
  },

  session: {
    openHost: (hostId: string) =>
      ipcRenderer.invoke(IpcChannel.sessionOpenHost, hostId) as Promise<OpenSessionResult>,
    openSsh: (target: SshTarget) =>
      ipcRenderer.invoke(IpcChannel.sessionOpenSsh, target) as Promise<OpenSessionResult>,
    openTelnet: (target: TelnetTargetInput) =>
      ipcRenderer.invoke(IpcChannel.sessionOpenTelnet, target) as Promise<OpenSessionResult>,
    openSerial: (name: string, config: SerialConfig) =>
      ipcRenderer.invoke(IpcChannel.sessionOpenSerial, name, config) as Promise<OpenSessionResult>,
    sendBreak: (sessionId: string) =>
      ipcRenderer.invoke(IpcChannel.sessionSendBreak, sessionId) as Promise<void>,
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
    onLog: (handler: (event: SessionLogEvent) => void) =>
      subscribe<SessionLogEvent>(IpcChannel.sessionLog, handler),
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
