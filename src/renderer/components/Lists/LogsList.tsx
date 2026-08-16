import { Fragment, useCallback, useEffect, useState } from 'react';
import type { LogFileInfo, LogFolderInfo } from '@shared/logs.js';
import { useConfig } from '@renderer/stores/config.js';
import styles from './list.module.css';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export function LogsList(): JSX.Element {
  const logDirectory = useConfig((state) => state.snapshot.settings.logDirectory);
  const setView = useConfig((state) => state.setView);
  const [folders, setFolders] = useState<LogFolderInfo[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [sessions, setSessions] = useState<LogFileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Re-reads the folder summaries. The spinner is only for the first read: showing it
   * again after a delete would tear the table down and rebuild it under the cursor.
   */
  const reload = useCallback(async (spinner = false) => {
    if (spinner) setLoading(true);
    try {
      setFolders(await window.ns3h.logs.folders());
    } catch {
      setFolders([]);
    } finally {
      if (spinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload(true);
  }, [logDirectory, reload]);

  const openFolder = async (name: string) => {
    if (open === name) {
      setOpen(null);
      setSessions([]);
      return;
    }
    setOpen(name);
    setSessions(await window.ns3h.logs.sessions(name).catch(() => []));
  };

  const deleteFolder = async (folder: LogFolderInfo) => {
    const count = folder.sessions === 1 ? '1 session log' : `${folder.sessions} session logs`;
    const confirmed = window.confirm(
      `Delete every log for "${folder.displayName}"? ${count} will be removed, ` +
        'and this cannot be undone.',
    );
    if (!confirmed) return;
    try {
      await window.ns3h.logs.deleteFolder(folder.name);
      setError(null);
      if (open === folder.name) {
        setOpen(null);
        setSessions([]);
      }
      await reload();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const deleteSession = async (folder: LogFolderInfo, session: LogFileInfo) => {
    if (!window.confirm(`Delete "${session.name}"? This cannot be undone.`)) return;
    try {
      await window.ns3h.logs.deleteSession(folder.name, session.name);
      setError(null);
      // The row goes at once; the folder's totals are re-read so its count and size
      // do not keep claiming a session that is no longer there.
      setSessions((current) => current.filter((entry) => entry.path !== session.path));
      await reload();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  if (!logDirectory) {
    return (
      <div className={styles.wrap}>
        <div className={styles.inner}>
          <h1 className={styles.heading}>Logs</h1>
          <p className={styles.empty}>
            No log directory has been chosen, so nothing is being recorded.{' '}
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setView({ kind: 'settings' })}
            >
              Choose one in Settings
            </button>
            .
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.inner}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.heading}>Logs</h1>
            <p className={styles.sub}>
              One folder per device, under <code>{logDirectory}</code>. Open a session to
              read it here — virtualised and searchable, so a{' '}
              <code>show tech-support</code> of tens of megabytes opens without a pause.
            </p>
          </div>
        </div>

        {error && <p className={styles.warning}>{error}</p>}

        {loading ? (
          <p className={styles.empty}>Reading the log directory…</p>
        ) : folders.length === 0 ? (
          <p className={styles.empty}>
            Nothing recorded yet. Connect to something and the session will appear here.
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Device</th>
                <th>Sessions</th>
                <th>Size</th>
                <th>Most recent</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {folders.map((folder) => (
                // Keyed on the fragment, not the row: a bare <> in a map has no key,
                // which React reports as a warning on every render of this screen.
                <Fragment key={folder.name}>
                  <tr onClick={() => void openFolder(folder.name)}>
                    <td className={styles.name}>
                      <span className={styles.chevron}>{open === folder.name ? '▾' : '▸'}</span>
                      {folder.displayName}
                    </td>
                    <td>{folder.sessions}</td>
                    <td className={styles.mono}>{formatBytes(folder.totalBytes)}</td>
                    <td>{formatWhen(folder.lastSession)}</td>
                    <td className={styles.actions}>
                      {/* Hidden until the row is hovered or focused: removing every log
                          for a device is not something to leave sitting under the cursor. */}
                      <button
                        type="button"
                        className={`${styles.rowDelete} ${styles.danger}`}
                        title={`Delete every log for ${folder.displayName}`}
                        aria-label={`Delete every log for ${folder.displayName}`}
                        onClick={(event) => {
                          // The row itself folds the device open.
                          event.stopPropagation();
                          void deleteFolder(folder);
                        }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                  {open === folder.name &&
                    sessions.map((session) => (
                      <tr
                        key={session.path}
                        className={styles.child}
                        onDoubleClick={() =>
                          setView({
                            kind: 'log-viewer',
                            path: session.path,
                            title: `${folder.displayName} · ${session.name}`,
                          })
                        }
                      >
                        <td className={styles.mono}>{session.name}</td>
                        <td />
                        <td className={styles.mono}>{formatBytes(session.bytes)}</td>
                        <td>{formatWhen(session.modified)}</td>
                        <td className={styles.actions}>
                          <button
                            type="button"
                            onClick={() =>
                              setView({
                                kind: 'log-viewer',
                                path: session.path,
                                title: `${folder.displayName} · ${session.name}`,
                              })
                            }
                          >
                            Open
                          </button>
                          <button
                            type="button"
                            onClick={() => void window.ns3h.shell.reveal(session.path)}
                          >
                            Reveal
                          </button>
                          <button
                            type="button"
                            className={styles.danger}
                            title={`Delete ${session.name}`}
                            aria-label={`Delete ${session.name}`}
                            onClick={() => void deleteSession(folder, session)}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
