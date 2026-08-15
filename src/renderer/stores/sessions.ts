import { create } from 'zustand';
import type {
  AuthPromptRequest,
  HostKeyPromptRequest,
  Protocol,
  SessionStatus,
  SshTarget,
} from '@shared/types.js';
import type { Host, SerialConfig } from '@shared/config.js';
import { useConfig } from './config.js';

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
}

export type SidebarSection = 'hosts' | 'credentials' | 'logs' | 'quick';

interface SessionState {
  tabs: SessionTab[];
  activeId: string | null;
  section: SidebarSection;
  hostKeyPrompt: HostKeyPromptRequest | null;
  authPrompts: Record<string, AuthPromptRequest | undefined>;

  setSection: (section: SidebarSection) => void;
  connect: (target: SshTarget) => Promise<void>;
  connectTelnet: (target: { name: string; address: string; port: number }) => Promise<void>;
  connectSerial: (name: string, config: SerialConfig) => Promise<void>;
  connectHost: (host: Host) => Promise<void>;
  sendBreak: (sessionId: string) => Promise<void>;
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
  setLogPath: (sessionId: string, logPath: string) => void;
  setHostKeyPrompt: (request: HostKeyPromptRequest | null) => void;
  setAuthPrompt: (sessionId: string, request: AuthPromptRequest | null) => void;
}

export const useSessions = create<SessionState>((set, get) => ({
  tabs: [],
  activeId: null,
  section: 'quick',
  hostKeyPrompt: null,
  authPrompts: {},
  connectError: null,

  setSection: (section) => set({ section }),
  clearConnectError: () => set({ connectError: null }),

  connectTelnet: async (target) => {
    try {
      const { sessionId } = await window.ns3h.session.openTelnet(target);
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
      const { sessionId } = await window.ns3h.session.openSerial(name, config);
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
      const { sessionId } = await window.ns3h.session.openHost(host.id);
      useConfig.getState().setView({ kind: 'sessions' });
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
          },
        ],
        activeId: sessionId,
      }));
    } catch (cause) {
      set({ connectError: (cause as Error).message });
    }
  },

  connect: async (target) => {
    const { sessionId } = await window.ns3h.session.openSsh(target);
    useConfig.getState().setView({ kind: 'sessions' });
    set((state) => ({
      tabs: [
        ...state.tabs,
        {
          id: sessionId,
          name: target.name || target.address,
          address: target.address,
          port: target.port,
          username: target.auth.username,
          status: 'connecting',
          protocol: 'ssh',
        },
      ],
      activeId: sessionId,
    }));
  },

  setActive: (id) => set({ activeId: id }),

  closeTab: (id) => {
    void window.ns3h.session.close(id);
    const { tabs, activeId } = get();
    const remaining = tabs.filter((tab) => tab.id !== id);
    set({
      tabs: remaining,
      activeId: activeId === id ? (remaining.at(-1)?.id ?? null) : activeId,
    });
    if (remaining.length === 0) useConfig.getState().setView({ kind: 'quick' });
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

  setLogPath: (sessionId, logPath) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === sessionId ? { ...tab, logPath } : tab)),
    })),

  setHostKeyPrompt: (request) => set({ hostKeyPrompt: request }),

  setAuthPrompt: (sessionId, request) =>
    set((state) => ({
      authPrompts: { ...state.authPrompts, [sessionId]: request ?? undefined },
    })),
}));
