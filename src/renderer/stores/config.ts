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

/** Open unless the user has folded it — the shape the setting is stored in. */
export function folderIsOpen(collapsed: string[], folderId: string): boolean {
  return !collapsed.includes(folderId);
}

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
  | { kind: 'log-viewer'; path: string; title: string }
  | { kind: 'transfer' }
  | { kind: 'host-form'; host: Host | null }
  | { kind: 'credential-form'; credential: Credential | null }
  | { kind: 'settings' };

interface ConfigState {
  snapshot: ConfigSnapshot;
  loaded: boolean;
  error: string | null;
  view: MainView;
  search: string;

  load: () => Promise<void>;
  setView: (view: MainView) => void;
  setSearch: (search: string) => void;
  /** Folds a host folder, and remembers it — the state outlives the launch. */
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
  /** Used after an import, which returns the whole snapshot from main. */
  replaceSnapshot: (snapshot: ConfigSnapshot) => void;
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
    search: '',

    load: async () => {
      await apply(() => window.ns3h.config.load());
      set({ loaded: true });
    },

    setView: (view) => set({ view }),
    setSearch: (search) => set({ search }),
    clearError: () => set({ error: null }),

    toggleFolder: (folderId) => {
      const collapsed = new Set(get().snapshot.settings.collapsedFolders);
      if (!collapsed.delete(folderId)) collapsed.add(folderId);
      const next = [...collapsed];

      // Applied here before it is written, for two reasons: the fold should follow the
      // click rather than a file round trip, and a second click landing before the first
      // write returns would otherwise compute its answer from stale state and undo it.
      set((state) => ({
        snapshot: { ...state.snapshot, settings: { ...state.snapshot.settings, collapsedFolders: next } },
      }));

      void window.ns3h.config
        .saveSettings({ collapsedFolders: next })
        .catch((cause: Error) => set({ error: cause.message }));
    },

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

    replaceSnapshot: (snapshot) => set({ snapshot, error: null }),

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
