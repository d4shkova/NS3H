import { create } from 'zustand';
import type {
  AuthPromptRequest,
  HostKeyPromptRequest,
  SessionStatus,
  SshTarget,
} from '@shared/types.js';

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

  setSection: (section) => set({ section }),

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
