import { create } from 'zustand';
import type { FileConnection, FileProtocol, SessionTransferMode } from '@shared/transfer.js';

/**
 * One open file transfer, shown as a tab (§ phase 14).
 *
 * These live in a store rather than in the pane, because the pane is unmounted every time
 * the user looks at anything else. Holding them in component state meant a second
 * connection was still open in the main process but had no visible presence on the way
 * back: the picker silently re-selected the session, and nothing offered to close it.
 */
export interface TransferTab {
  /** Stable identity: the session id for a session tab, the connection id otherwise. */
  key: string;
  kind: 'session' | 'standalone';
  label: string;
  protocol: FileProtocol;
  /** Session tabs only — which channel carries the transfer. */
  mode: SessionTransferMode;
  /** The directory last shown, so returning to a tab returns to where you were. */
  path: string;
  /** False once a device has told us it cannot list; the tab works from typed paths. */
  browsable: boolean;
}

/**
 * What the IPC layer takes. A session tab carries its mode in the id — the main process
 * reads `ses_ab12:scp` as "that session, over SCP".
 */
export function sourceIdFor(tab: TransferTab): string {
  return tab.kind === 'session' && tab.mode === 'scp' ? `${tab.key}:scp` : tab.key;
}

export function sessionTab(sessionId: string, label: string): TransferTab {
  return {
    key: sessionId,
    kind: 'session',
    label,
    protocol: 'sftp',
    mode: 'sftp',
    path: '',
    browsable: true,
  };
}

export function standaloneTab(connection: FileConnection): TransferTab {
  return {
    key: connection.id,
    kind: 'standalone',
    label: connection.label,
    protocol: connection.protocol,
    mode: connection.protocol === 'scp' ? 'scp' : 'sftp',
    path: connection.home,
    browsable: true,
  };
}

export interface Reconciled {
  tabs: TransferTab[];
  activeKey: string | null;
  /** Standalone connections that were open in main with no tab of their own. */
  adopted: string[];
}

/**
 * Squares the tabs against what is actually open.
 *
 * Both directions matter. A tab whose connection or session has gone must not linger as a
 * dead end — but equally, a connection that is live in the main process and has no tab is
 * a leak the user cannot see or close, so it is adopted rather than ignored. That is the
 * case that started this: a second connection, open and paid for, with nothing on screen
 * to reach it by.
 */
export function reconcileTabs(
  tabs: TransferTab[],
  connections: FileConnection[],
  liveSessionIds: string[],
  activeKey: string | null,
): Reconciled {
  const live = new Set(connections.map((connection) => connection.id));
  const sessions = new Set(liveSessionIds);

  const kept = tabs.filter((tab) =>
    tab.kind === 'standalone' ? live.has(tab.key) : sessions.has(tab.key),
  );

  const known = new Set(kept.map((tab) => tab.key));
  const orphans = connections.filter((connection) => !known.has(connection.id));
  const next = [...kept, ...orphans.map(standaloneTab)];

  return {
    tabs: next,
    activeKey:
      activeKey && next.some((tab) => tab.key === activeKey)
        ? activeKey
        : (next.at(-1)?.key ?? null),
    adopted: orphans.map((connection) => connection.id),
  };
}

interface TransferState {
  tabs: TransferTab[];
  activeKey: string | null;

  /** Adds a tab, or focuses the one that is already there. */
  open: (tab: TransferTab) => void;
  close: (key: string) => void;
  setActive: (key: string) => void;
  patch: (key: string, changes: Partial<TransferTab>) => void;
  reconcile: (connections: FileConnection[], liveSessionIds: string[]) => string[];
}

export const useTransfers = create<TransferState>((set, get) => ({
  tabs: [],
  activeKey: null,

  open: (tab) =>
    set((state) => ({
      tabs: state.tabs.some((entry) => entry.key === tab.key)
        ? state.tabs
        : [...state.tabs, tab],
      activeKey: tab.key,
    })),

  close: (key) =>
    set((state) => {
      const remaining = state.tabs.filter((tab) => tab.key !== key);
      return {
        tabs: remaining,
        // Focus moves to the neighbour, the way closing a browser tab does.
        activeKey:
          state.activeKey === key ? (remaining.at(-1)?.key ?? null) : state.activeKey,
      };
    }),

  setActive: (key) => set({ activeKey: key }),

  patch: (key, changes) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.key === key ? { ...tab, ...changes } : tab)),
    })),

  reconcile: (connections, liveSessionIds) => {
    const { tabs, activeKey } = get();
    const result = reconcileTabs(tabs, connections, liveSessionIds, activeKey);
    set({ tabs: result.tabs, activeKey: result.activeKey });
    return result.adopted;
  },
}));
