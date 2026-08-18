import { create } from 'zustand';
import type {
  AuthPromptRequest,
  HostKeyPromptRequest,
  Protocol,
  SessionStatus,
  SshTargetInput,
} from '@shared/types.js';
import type { Host, SerialConfig } from '@shared/config.js';
import { useConfig } from './config.js';
import { useTransfers } from './transfers.js';

export interface SessionTab {
  id: string;
  name: string;
  address: string;
  port: number;
  username: string;
  status: SessionStatus;
  protocol: Protocol;
  detail?: string;
  negotiationSummary?: string;
  /** Set once main has the log file open — drives the status bar indicator. */
  logPath?: string;
  /**
   * Whether this session is recording. Starts from the host's setting and follows the
   * toolbar toggle from there; the saved host is not changed by toggling it.
   */
  logging: boolean;
}

export type SidebarSection =
  | 'home'
  | 'hosts'
  | 'credentials'
  | 'logs'
  | 'transfer'
  | 'quick';

interface SessionState {
  tabs: SessionTab[];
  activeId: string | null;
  section: SidebarSection;
  hostKeyPrompt: HostKeyPromptRequest | null;
  authPrompts: Record<string, AuthPromptRequest | undefined>;

  setSection: (section: SidebarSection) => void;
  connect: (target: SshTargetInput) => Promise<void>;
  connectTelnet: (target: { name: string; address: string; port: number }) => Promise<void>;
  connectSerial: (name: string, config: SerialConfig) => Promise<void>;
  connectHost: (host: Host) => Promise<void>;
  sendBreak: (sessionId: string) => Promise<void>;
  /** Starts or stops logging for one session. Returns the state it ended up in. */
  setLogging: (sessionId: string, logging: boolean) => Promise<boolean>;
  connectError: string | null;
  clearConnectError: () => void;
  setActive: (id: string) => void;
  closeTab: (id: string) => void;
  applyStatus: (
    id: string,
    status: SessionStatus,
    detail?: string,
    summary?: string,
    logPath?: string,
  ) => void;
  applyLogging: (sessionId: string, logging: boolean, logPath: string | null) => void;
  setHostKeyPrompt: (request: HostKeyPromptRequest | null) => void;
  setAuthPrompt: (sessionId: string, request: AuthPromptRequest | null) => void;
}

/**
 * Who a tab says it is connected as. A saved credential is sent to main as an id alone,
 * so its username is looked up from the configuration the renderer already has — the
 * name is not a secret, and only the password ever needed keeping out of here.
 */
function usernameFor(target: SshTargetInput): string {
  const auth = target.auth;
  if (auth.kind !== 'saved') return auth.username;
  const saved = useConfig
    .getState()
    .snapshot.credentials.credentials.find((entry) => entry.id === auth.credentialId);
  return saved?.username ?? '';
}

export const useSessions = create<SessionState>((set, get) => ({
  tabs: [],
  activeId: null,
  section: 'home',
  hostKeyPrompt: null,
  authPrompts: {},
  connectError: null,

  setSection: (section) => set({ section }),
  clearConnectError: () => set({ connectError: null }),

  connectTelnet: async (target) => {
    try {
      const { sessionId, logging } = await window.ns3h.session.openTelnet(target);
      useConfig.getState().setView({ kind: 'sessions' });
      set((state) => ({
        connectError: null,
        tabs: [
          ...state.tabs,
          {
            id: sessionId,
            name: target.name || target.address,
            address: target.address,
            port: target.port,
            username: '',
            status: 'connecting',
            protocol: 'telnet',
            logging,
          },
        ],
        activeId: sessionId,
      }));
    } catch (cause) {
      set({ connectError: (cause as Error).message });
    }
  },

  connectSerial: async (name, config) => {
    try {
      const { sessionId, logging } = await window.ns3h.session.openSerial(name, config);
      useConfig.getState().setView({ kind: 'sessions' });
      set((state) => ({
        connectError: null,
        tabs: [
          ...state.tabs,
          {
            id: sessionId,
            name: name || config.path,
            address: config.path,
            port: config.baudRate,
            username: '',
            status: 'connecting',
            protocol: 'serial',
            logging,
          },
        ],
        activeId: sessionId,
      }));
    } catch (cause) {
      set({ connectError: (cause as Error).message });
    }
  },

  sendBreak: async (sessionId) => {
    try {
      await window.ns3h.session.sendBreak(sessionId);
    } catch (cause) {
      set({ connectError: (cause as Error).message });
    }
  },

  connectHost: async (host) => {
    try {
      const { sessionId, logging } = await window.ns3h.session.openHost(host.id);
      useConfig.getState().setView({ kind: 'sessions' });
      // Counted once the session exists, so a host that cannot be opened does not climb
      // the sidebar for being tried repeatedly.
      useConfig.getState().recordConnection(host.id);
      set((state) => ({
        connectError: null,
        tabs: [
          ...state.tabs,
          {
            id: sessionId,
            name: host.name,
            address: host.protocol === 'serial' ? (host.serial?.path ?? '') : (host.address ?? ''),
            port: host.protocol === 'serial' ? (host.serial?.baudRate ?? 9600) : (host.port ?? 22),
            username: '',
            status: 'connecting',
            protocol: host.protocol,
            logging,
          },
        ],
        activeId: sessionId,
      }));
    } catch (cause) {
      set({ connectError: (cause as Error).message });
    }
  },

  connect: async (target) => {
    // Read before the connection is made, so a tab always has a name to show: a saved
    // credential is resolved in main, and the username never comes back from there.
    const { sessionId, logging } = await window.ns3h.session.openSsh(target);
    useConfig.getState().setView({ kind: 'sessions' });
    set((state) => ({
      tabs: [
        ...state.tabs,
        {
          id: sessionId,
          name: target.name || target.address,
          address: target.address,
          port: target.port,
          username: usernameFor(target),
          status: 'connecting',
          protocol: 'ssh',
          logging,
        },
      ],
      activeId: sessionId,
    }));
  },

  setActive: (id) => set({ activeId: id }),

  closeTab: (id) => {
    void window.ns3h.session.close(id);
    // A transfer riding on this session goes with it: the channel is the session's, and
    // a tab pointing at a closed session is a dead end.
    useTransfers.getState().close(id);
    const { tabs, activeId } = get();
    const remaining = tabs.filter((tab) => tab.id !== id);
    set({
      tabs: remaining,
      activeId: activeId === id ? (remaining.at(-1)?.id ?? null) : activeId,
    });
    if (remaining.length === 0) useConfig.getState().setView({ kind: 'home' });
  },

  applyStatus: (id, status, detail, summary, logPath) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              status,
              detail,
              negotiationSummary: summary ?? tab.negotiationSummary,
              logPath: logPath ?? tab.logPath,
            }
          : tab,
      ),
    })),

  applyLogging: (sessionId, logging, logPath) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === sessionId ? { ...tab, logging, logPath: logPath ?? undefined } : tab,
      ),
    })),

  setLogging: async (sessionId, logging) => {
    // Optimistic, then corrected by what main reports: the round trip includes opening
    // a file, and a toggle that does not move until the disk answers reads as broken.
    get().applyLogging(sessionId, logging, null);
    try {
      const result = await window.ns3h.session.setLogging(sessionId, logging);
      get().applyLogging(sessionId, result.logging, result.logPath);
      if (result.reason) set({ connectError: result.reason });
      return result.logging;
    } catch (cause) {
      get().applyLogging(sessionId, !logging, null);
      set({ connectError: (cause as Error).message });
      return !logging;
    }
  },

  setHostKeyPrompt: (request) => set({ hostKeyPrompt: request }),

  setAuthPrompt: (sessionId, request) =>
    set((state) => ({
      authPrompts: { ...state.authPrompts, [sessionId]: request ?? undefined },
    })),
}));
