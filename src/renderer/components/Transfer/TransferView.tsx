import { useCallback, useEffect, useState } from 'react';
import type { LocalEntry, RemoteEntry, TransferEvent } from '@shared/transfer.js';
import { useConfig } from '@renderer/stores/config.js';
import { useSessions } from '@renderer/stores/sessions.js';
import styles from './TransferView.module.css';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Dual-pane SFTP (phase 9): the local filesystem on the left, the device on the right,
 * for whichever SSH session is selected. The transfer runs over the session that is
 * already open, so it costs no second authentication.
 */
export function TransferView(): JSX.Element {
  const setView = useConfig((state) => state.setView);
  const tabs = useSessions((state) => state.tabs);
  const activeId = useSessions((state) => state.activeId);

  const sshSessions = tabs.filter(
    (tab) => tab.protocol === 'ssh' && tab.status === 'connected',
  );
  const [sessionId, setSessionId] = useState(
    () => sshSessions.find((tab) => tab.id === activeId)?.id ?? sshSessions[0]?.id ?? '',
  );

  const [local, setLocal] = useState<{ path: string; entries: LocalEntry[] }>({
    path: '',
    entries: [],
  });
  const [remotePath, setRemotePath] = useState('');
  const [remote, setRemote] = useState<RemoteEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [transfers, setTransfers] = useState<TransferEvent[]>([]);

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
    if (!sessionId) return undefined;
    setError(null);
    // StrictMode runs this twice in development, and switching sessions quickly can
    // leave an earlier lookup in flight; a stale result must not overwrite the pane or
    // report an error for a session the user has already navigated away from.
    let current = true;
    void window.ns3h.transfer
      .remoteHome(sessionId)
      .then((home) => {
        if (current) void loadRemote(sessionId, home);
      })
      .catch((cause: Error) => {
        if (current) setError(cause.message);
      });
    return () => {
      current = false;
    };
  }, [sessionId, loadRemote]);

  useEffect(() => {
    return window.ns3h.transfer.onProgress((event) => {
      setTransfers((current) => {
        const rest = current.filter((entry) => entry.id !== event.id);
        // Finished transfers linger briefly so the result is readable.
        return [...rest, event].slice(-4);
      });
      if (event.status === 'done') {
        void loadLocal(local.path);
        if (sessionId && remotePath) void loadRemote(sessionId, remotePath);
      }
    });
  }, [loadLocal, loadRemote, local.path, remotePath, sessionId]);

  const download = async (entry: RemoteEntry) => {
    setBusy(true);
    setError(null);
    try {
      await window.ns3h.transfer.download(sessionId, entry.path, local.path);
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
      await window.ns3h.transfer.upload(sessionId, entry.path, remotePath);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (sshSessions.length === 0) {
    return (
      <div className={styles.empty}>
        <h1 className={styles.heading}>SFTP</h1>
        <p>
          File transfer runs over a connected SSH session. Open one first — telnet and
          serial cannot carry it.
        </p>
        <button type="button" className={styles.primary} onClick={() => setView({ kind: 'quick' })}>
          Connect to something
        </button>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        <button type="button" className={styles.back} onClick={() => setView({ kind: 'sessions' })}>
          ← Session
        </button>
        <h1 className={styles.heading}>SFTP</h1>
        <select value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
          {sshSessions.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.name} ({tab.address})
            </option>
          ))}
        </select>
        <span className={styles.hint}>
          Runs over the open session — no second login, same negotiated crypto.
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
            <span className={styles.paneTitle}>Device</span>
            <button
              type="button"
              disabled={!remotePath || remotePath === '/'}
              onClick={() => void loadRemote(sessionId, remotePath.replace(/\/[^/]+\/?$/, '') || '/')}
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
                onDoubleClick={() => entry.directory && void loadRemote(sessionId, entry.path)}
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
