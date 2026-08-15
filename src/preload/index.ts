import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannel } from '@shared/ipc.js';
import type { Ns3hApi } from '@shared/api.js';
import type { SerialConfig } from '@shared/config.js';
import type { TransferEvent } from '@shared/transfer.js';
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

  clipboard: {
    read: () => ipcRenderer.invoke(IpcChannel.clipboardRead) as Promise<string>,
    write: (text: string) => ipcRenderer.invoke(IpcChannel.clipboardWrite, text) as Promise<void>,
  },

  logs: {
    folders: () => ipcRenderer.invoke(IpcChannel.logsListFolders),
    sessions: (folder: string) => ipcRenderer.invoke(IpcChannel.logsListSessions, folder),
    open: (path: string) => ipcRenderer.invoke(IpcChannel.logsOpen, path),
    lines: (path: string, start: number, count: number) =>
      ipcRenderer.invoke(IpcChannel.logsLines, path, start, count),
    search: (path: string, query: string) =>
      ipcRenderer.invoke(IpcChannel.logsSearch, path, query),
    close: (path: string) => ipcRenderer.invoke(IpcChannel.logsClose, path),
  },

  serial: {
    list: () => ipcRenderer.invoke(IpcChannel.serialList) as Promise<SerialPortInfo[]>,
  },

  transfer: {
    remoteHome: (sessionId: string) =>
      ipcRenderer.invoke(IpcChannel.transferRemoteHome, sessionId),
    remoteList: (sessionId: string, path: string) =>
      ipcRenderer.invoke(IpcChannel.transferRemoteList, sessionId, path),
    localList: (path: string) => ipcRenderer.invoke(IpcChannel.transferLocalList, path),
    download: (sessionId: string, remotePath: string, localDirectory: string) =>
      ipcRenderer.invoke(IpcChannel.transferDownload, sessionId, remotePath, localDirectory),
    upload: (sessionId: string, localPath: string, remoteDirectory: string) =>
      ipcRenderer.invoke(IpcChannel.transferUpload, sessionId, localPath, remoteDirectory),
    chooseDirectory: () => ipcRenderer.invoke(IpcChannel.transferChooseDirectory),
    onProgress: (handler: (event: TransferEvent) => void) =>
      subscribe<TransferEvent>(IpcChannel.transferProgress, handler),
  },

  backup: {
    exportConfig: () => ipcRenderer.invoke(IpcChannel.exportConfig),
    exportBundle: (passphrase: string) =>
      ipcRenderer.invoke(IpcChannel.exportBundle, passphrase),
    choose: () => ipcRenderer.invoke(IpcChannel.importPreview),
    preview: (path: string, passphrase: string) =>
      ipcRenderer.invoke(IpcChannel.importPreview, path, passphrase),
    apply: (request) => ipcRenderer.invoke(IpcChannel.importApply, request),
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
