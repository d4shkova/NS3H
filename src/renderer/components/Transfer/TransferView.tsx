import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  FileConnection,
  LocalEntry,
  RemoteEntry,
  TransferEvent,
} from '@shared/transfer.js';
import { useConfig } from '@renderer/stores/config.js';
import { useSessions } from '@renderer/stores/sessions.js';
import { TransferConnectForm } from './TransferConnectForm.js';
import styles from './TransferView.module.css';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Either side of the picker: a live session, or a connection of the pane's own. */
interface Source {
  id: string;
  label: string;
  /** Standalone connections can be disconnected here; a session's is closed with it. */
  standalone: boolean;
}

/**
 * Dual-pane file transfer: the local filesystem on the left, the remote side on the right.
 *
 * The remote side is whichever source is picked — an SSH session that is already open,
 * whose SFTP channel is reused at no second authentication, or a connection this pane
 * made itself (§ phase 12): SFTP to a device with no session open, or SMB to a share.
 */
export function TransferView(): JSX.Element {
  const setView = useConfig((state) => state.setView);
  const tabs = useSessions((state) => state.tabs);
  const activeId = useSessions((state) => state.activeId);

  const [connections, setConnections] = useState<FileConnection[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [sourceId, setSourceId] = useState('');

  const [local, setLocal] = useState<{ path: string; entries: LocalEntry[] }>({
    path: '',
    entries: [],
  });
  const [remotePath, setRemotePath] = useState('');
  const [remote, setRemote] = useState<RemoteEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [transfers, setTransfers] = useState<TransferEvent[]>([]);

  const sources: Source[] = useMemo(
    () => [
      ...tabs
        .filter((tab) => tab.protocol === 'ssh' && tab.status === 'connected')
        .map((tab) => ({
          id: tab.id,
          label: `${tab.name} (${tab.address}) — open session`,
          standalone: false,
        })),
      ...connections.map((connection) => ({
        id: connection.id,
        label: `${connection.label} — ${connection.protocol.toUpperCase()}`,
        standalone: true,
      })),
    ],
    [tabs, connections],
  );

  // Pick something sensible on arrival, and never keep pointing at a source that has
  // gone — a session that closed, or a connection that was disconnected.
  useEffect(() => {
    if (sources.some((source) => source.id === sourceId)) return;
    const preferred = sources.find((source) => source.id === activeId) ?? sources[0];
    setSourceId(preferred?.id ?? '');
    if (!preferred) {
      setRemote([]);
      setRemotePath('');
    }
  }, [sources, sourceId, activeId]);

  useEffect(() => {
    void window.ns3h.transfer.connections().then(setConnections).catch(() => setConnections([]));
  }, []);

  const loadLocal = useCallback(async (path: string) => {
    try {
      setLocal(await window.ns3h.transfer.localList(path));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, []);

  const loadRemote = useCallback(async (id: string, path: string) => {
    try {
      setRemote(await window.ns3h.transfer.remoteList(id, path));
      setRemotePath(path);
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadLocal('');
  }, [loadLocal]);

  useEffect(() => {
    if (!sourceId) return undefined;
    setError(null);
    // StrictMode runs this twice in development, and switching sources quickly can leave
    // an earlier lookup in flight; a stale result must not overwrite the pane or report
    // an error for a source the user has already navigated away from.
    let current = true;
    void window.ns3h.transfer
      .remoteHome(sourceId)
      .then((home) => {
        if (current) void loadRemote(sourceId, home);
      })
      .catch((cause: Error) => {
        if (current) setError(cause.message);
      });
    return () => {
      current = false;
    };
  }, [sourceId, loadRemote]);

  useEffect(() => {
    return window.ns3h.transfer.onProgress((event) => {
      setTransfers((current) => {
        const rest = current.filter((entry) => entry.id !== event.id);
        // Finished transfers linger briefly so the result is readable.
        return [...rest, event].slice(-4);
      });
      if (event.status === 'done') {
        void loadLocal(local.path);
        if (sourceId && remotePath) void loadRemote(sourceId, remotePath);
      }
    });
  }, [loadLocal, loadRemote, local.path, remotePath, sourceId]);

  const download = async (entry: RemoteEntry) => {
    setBusy(true);
    setError(null);
    try {
      await window.ns3h.transfer.download(sourceId, entry.path, local.path);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (entry: LocalEntry) => {
    setBusy(true);
    setError(null);
    try {
      await window.ns3h.transfer.upload(sourceId, entry.path, remotePath);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const connected = (connection: FileConnection) => {
    setConnections((current) => [...current, connection]);
    setSourceId(connection.id);
    setConnecting(false);
  };

  const disconnect = async (id: string) => {
    await window.ns3h.transfer.disconnect(id);
    setConnections((current) => current.filter((connection) => connection.id !== id));
  };

  // Nothing to browse and nothing open: the form is the screen, not an empty state.
  if (sources.length === 0 || connecting) {
    return (
      <div className={styles.wrap}>
        <div className={styles.bar}>
          <button
            type="button"
            className={styles.back}
            onClick={() => setView({ kind: sources.length > 0 ? 'transfer' : 'home' })}
          >
            ←
          </button>
          <h1 className={styles.heading}>File transfer</h1>
        </div>
        <div className={styles.formHost}>
          <TransferConnectForm
            onConnected={connected}
            onCancel={sources.length > 0 ? () => setConnecting(false) : null}
          />
          {sources.length === 0 && (
            <p className={styles.formFoot}>
              Already have an SSH session open? It appears here as a source on its own —
              transferring over it costs no second login.
            </p>
          )}
        </div>
      </div>
    );
  }

  const source = sources.find((entry) => entry.id === sourceId) ?? null;

  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        <button type="button" className={styles.back} onClick={() => setView({ kind: 'sessions' })}>
          ← Session
        </button>
        <h1 className={styles.heading}>File transfer</h1>
        <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
          {sources.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
        <button type="button" className={styles.back} onClick={() => setConnecting(true)}>
          New connection
        </button>
        {source?.standalone && (
          <button type="button" className={styles.back} onClick={() => void disconnect(source.id)}>
            Disconnect
          </button>
        )}
        <span className={styles.hint}>
          {source?.standalone
            ? 'A connection of its own — nothing about it is saved.'
            : 'Runs over the open session — no second login, same negotiated crypto.'}
        </span>
      </div>

      {error && (
        <p className={styles.error} onClick={() => setError(null)} role="alert">
          {error}
        </p>
      )}

      <div className={styles.panes}>
        <section className={styles.pane}>
          <header className={styles.paneHead}>
            <span className={styles.paneTitle}>This computer</span>
            <button
              type="button"
              onClick={async () => {
                const chosen = await window.ns3h.transfer.chooseDirectory();
                if (chosen) void loadLocal(chosen);
              }}
            >
              Change
            </button>
          </header>
          <div className={styles.path}>{local.path}</div>
          <div className={styles.list}>
            {local.entries.map((entry) => (
              <div
                key={entry.path}
                className={styles.row}
                onDoubleClick={() => entry.directory && void loadLocal(entry.path)}
              >
                <span className={styles.name}>
                  {entry.directory ? '▸ ' : '   '}
                  {entry.name}
                </span>
                <span className={styles.size}>{entry.directory ? '' : formatBytes(entry.size)}</span>
                {!entry.directory && (
                  <button
                    type="button"
                    className={styles.send}
                    disabled={busy}
                    title={`Upload to ${remotePath}`}
                    onClick={() => void upload(entry)}
                  >
                    →
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className={styles.pane}>
          <header className={styles.paneHead}>
            <span className={styles.paneTitle}>{source?.standalone ? 'Remote' : 'Device'}</span>
            <button
              type="button"
              disabled={!remotePath || remotePath === '/'}
              onClick={() => void loadRemote(sourceId, remotePath.replace(/\/[^/]+\/?$/, '') || '/')}
            >
              Up
            </button>
          </header>
          <div className={styles.path}>{remotePath || '…'}</div>
          <div className={styles.list}>
            {remote.map((entry) => (
              <div
                key={entry.path}
                className={styles.row}
                onDoubleClick={() => entry.directory && void loadRemote(sourceId, entry.path)}
              >
                {!entry.directory && (
                  <button
                    type="button"
                    className={styles.send}
                    disabled={busy}
                    title={`Download to ${local.path}`}
                    onClick={() => void download(entry)}
                  >
                    ←
                  </button>
                )}
                <span className={styles.name}>
                  {entry.directory ? '▸ ' : '   '}
                  {entry.name}
                </span>
                <span className={styles.perms}>{entry.permissions}</span>
                <span className={styles.size}>
                  {entry.directory ? '' : formatBytes(entry.size)}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {transfers.length > 0 && (
        <div className={styles.transfers}>
          {transfers.map((entry) => (
            <div key={entry.id} className={styles.transfer}>
              <span className={styles.transferName}>
                {entry.direction === 'download' ? '←' : '→'} {entry.name}
              </span>
              {entry.status === 'running' && (
                <span className={styles.progress}>
                  <span
                    className={styles.bar_}
                    style={{
                      width: `${entry.total ? Math.min(100, (entry.transferred / entry.total) * 100) : 0}%`,
                    }}
                  />
                </span>
              )}
              <span className={styles.transferState}>
                {entry.status === 'done'
                  ? 'done'
                  : entry.status === 'error'
                    ? (entry.detail ?? 'failed')
                    : `${formatBytes(entry.transferred)} / ${formatBytes(entry.total)}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
