import { useEffect, useState } from 'react';
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

  useEffect(() => {
    setLoading(true);
    void window.ns3h.logs
      .folders()
      .then(setFolders)
      .catch(() => setFolders([]))
      .finally(() => setLoading(false));
  }, [logDirectory]);

  const openFolder = async (name: string) => {
    if (open === name) {
      setOpen(null);
      setSessions([]);
      return;
    }
    setOpen(name);
    setSessions(await window.ns3h.logs.sessions(name).catch(() => []));
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
              One folder per device, under <code>{logDirectory}</code>. Reading a session
              Open one to read it here — virtualised and searchable, so a
              <code> show tech-support</code> of tens of megabytes opens without a pause.
            </p>
          </div>
        </div>

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
                <>
                  <tr key={folder.name} onClick={() => void openFolder(folder.name)}>
                    <td className={styles.name}>
                      <span className={styles.chevron}>{open === folder.name ? '▾' : '▸'}</span>
                      {folder.displayName}
                    </td>
                    <td>{folder.sessions}</td>
                    <td className={styles.mono}>{formatBytes(folder.totalBytes)}</td>
                    <td>{formatWhen(folder.lastSession)}</td>
                    <td className={styles.actions} />
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
                        </td>
                      </tr>
                    ))}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
