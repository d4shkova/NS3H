import { create } from 'zustand';
import {
  EMPTY_CREDENTIALS,
  EMPTY_HOSTS,
  DEFAULT_SETTINGS,
  type ConfigSnapshot,
  type Credential,
  type Folder,
  type Host,
  type Settings,
} from '@shared/config.js';
import type { CredentialSecrets } from '@shared/api.js';

/** What the main pane is showing when no session tab is active. */
export type MainView =
  /** The landing screen: a card per thing the app does. */
  | { kind: 'home' }
  /** The session dock. Anything else covers it until dismissed. */
  | { kind: 'sessions' }
  | { kind: 'quick' }
  | { kind: 'hosts' }
  | { kind: 'credentials' }
  | { kind: 'logs' }
  | { kind: 'host-form'; host: Host | null }
  | { kind: 'credential-form'; credential: Credential | null }
  | { kind: 'settings' };

interface ConfigState {
  snapshot: ConfigSnapshot;
  loaded: boolean;
  error: string | null;
  view: MainView;
  expandedFolders: Record<string, boolean>;
  search: string;

  load: () => Promise<void>;
  setView: (view: MainView) => void;
  setSearch: (search: string) => void;
  toggleFolder: (folderId: string) => void;
  clearError: () => void;

  saveHost: (host: Host, secrets?: CredentialSecrets) => Promise<void>;
  deleteHost: (hostId: string) => Promise<void>;
  duplicateHost: (host: Host) => Promise<void>;
  saveFolder: (folder: Folder) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<void>;
  saveCredential: (credential: Credential, secrets?: CredentialSecrets) => Promise<void>;
  deleteCredential: (credentialId: string) => Promise<void>;
  chooseLogDirectory: () => Promise<void>;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
}

const EMPTY_SNAPSHOT: ConfigSnapshot = {
  hosts: EMPTY_HOSTS,
  credentials: EMPTY_CREDENTIALS,
  settings: DEFAULT_SETTINGS,
  secrets: { available: true },
};

export const useConfig = create<ConfigState>((set, get) => {
  /** Every mutation returns the fresh snapshot, so state never drifts from disk. */
  const apply = async (operation: () => Promise<ConfigSnapshot>) => {
    try {
      set({ snapshot: await operation(), error: null });
    } catch (cause) {
      set({ error: (cause as Error).message });
    }
  };

  return {
    snapshot: EMPTY_SNAPSHOT,
    loaded: false,
    error: null,
    view: { kind: 'home' },
    expandedFolders: {},
    search: '',

    load: async () => {
      await apply(() => window.ns3h.config.load());
      set({ loaded: true });
    },

    setView: (view) => set({ view }),
    setSearch: (search) => set({ search }),
    clearError: () => set({ error: null }),

    toggleFolder: (folderId) =>
      set((state) => ({
        expandedFolders: {
          ...state.expandedFolders,
          [folderId]: !(state.expandedFolders[folderId] ?? true),
        },
      })),

    saveHost: async (host, secrets) => {
      await apply(() => window.ns3h.config.saveHost(host, secrets));
      if (!get().error) set({ view: { kind: 'hosts' } });
    },

    deleteHost: (hostId) => apply(() => window.ns3h.config.deleteHost(hostId)),

    duplicateHost: (host) =>
      apply(() =>
        window.ns3h.config.saveHost({
          ...host,
          id: '',
          name: `${host.name} copy`,
          createdAt: new Date().toISOString(),
        }),
      ),

    saveFolder: (folder) => apply(() => window.ns3h.config.saveFolder(folder)),
    deleteFolder: (folderId) => apply(() => window.ns3h.config.deleteFolder(folderId)),

    saveCredential: async (credential, secrets) => {
      await apply(() => window.ns3h.config.saveCredential(credential, secrets));
      if (!get().error) set({ view: { kind: 'credentials' } });
    },

    deleteCredential: (credentialId) =>
      apply(() => window.ns3h.config.deleteCredential(credentialId)),

    saveSettings: (patch) => apply(() => window.ns3h.config.saveSettings(patch)),

    chooseLogDirectory: async () => {
      try {
        // Null means the user cancelled the picker — not an error, and not a change.
        const next = await window.ns3h.config.chooseLogDirectory();
        if (next) set({ snapshot: next, error: null });
      } catch (cause) {
        set({ error: (cause as Error).message });
      }
    },
  };
});
