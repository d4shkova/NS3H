/** Channel names for the preload bridge. Keep every string in one place. */
export const IpcChannel = {
  // renderer → main (invoke)
  sessionOpenSsh: 'session:open-ssh',
  sessionWrite: 'session:write',
  sessionResize: 'session:resize',
  sessionClose: 'session:close',
  hostKeyRespond: 'host-key:respond',
  authRespond: 'auth:respond',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  platformInfo: 'platform:info',

  // main → renderer (send)
  sessionData: 'session:data',
  sessionStatus: 'session:status',
  sessionNotice: 'session:notice',
  hostKeyPrompt: 'host-key:prompt',
  authPrompt: 'auth:prompt',
} as const;

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel];
