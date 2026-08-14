import { create } from 'zustand';
import type {
  AuthPromptRequest,
  HostKeyPromptRequest,
  SessionStatus,
  SshTarget,
} from '@shared/types.js';
import type { Host } from '@shared/config.js';

export interface SessionTab {
  id: string;
  name: string;
  address: string;
  port: number;
  username: string;
  status: SessionStatus;
  detail?: string;
  negotiationSummary?: string;
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
  connectHost: (host: Host) => Promise<void>;
  connectError: string | null;
  clearConnectError: () => void;
  setActive: (id: string) => void;
  closeTab: (id: string) => void;
  applyStatus: (id: string, status: SessionStatus, detail?: string, summary?: string) => void;
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

  connectHost: async (host) => {
    if (host.protocol !== 'ssh') {
      set({
        connectError: `${host.name} is a ${host.protocol} host. Telnet and serial connect in phase 5 — the host is saved and ready for it.`,
      });
      return;
    }
    try {
      const { sessionId } = await window.ns3h.session.openHost(host.id);
      set((state) => ({
        connectError: null,
        tabs: [
          ...state.tabs,
          {
            id: sessionId,
            name: host.name,
            address: host.address ?? '',
            port: host.port ?? 22,
            username: '',
            status: 'connecting',
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
  },

  applyStatus: (id, status, detail, summary) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? { ...tab, status, detail, negotiationSummary: summary ?? tab.negotiationSummary }
          : tab,
      ),
    })),

  setHostKeyPrompt: (request) => set({ hostKeyPrompt: request }),

  setAuthPrompt: (sessionId, request) =>
    set((state) => ({
      authPrompts: { ...state.authPrompts, [sessionId]: request ?? undefined },
    })),
}));
