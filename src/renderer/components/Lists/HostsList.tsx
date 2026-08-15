import { useMemo, useState } from 'react';
import type { Host } from '@shared/config.js';
import { useConfig } from '@renderer/stores/config.js';
import { useSessions } from '@renderer/stores/sessions.js';
import styles from './list.module.css';

export function HostsList(): JSX.Element {
  const snapshot = useConfig((state) => state.snapshot);
  const setView = useConfig((state) => state.setView);
  const deleteHost = useConfig((state) => state.deleteHost);
  const connectHost = useSessions((state) => state.connectHost);
  const [filter, setFilter] = useState('');

  const { hosts, folders } = snapshot.hosts;
  const folderName = (id: string | null) =>
    folders.find((folder) => folder.id === id)?.name ?? '—';

  const credentialName = (host: Host) => {
    if (host.inlineCredential) return `${host.inlineCredential.username} (this device)`;
    const credential = snapshot.credentials.credentials.find(
      (entry) => entry.id === host.credentialId,
    );
    return credential ? credential.name : 'Prompt at connect';
  };

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return hosts;
    return hosts.filter(
      (host) =>
        host.name.toLowerCase().includes(needle) ||
        (host.address ?? '').toLowerCase().includes(needle) ||
        (host.serial?.path ?? '').toLowerCase().includes(needle),
    );
  }, [hosts, filter]);

  return (
    <div className={styles.wrap}>
      <div className={styles.inner}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.heading}>Hosts</h1>
            <p className={styles.sub}>
              Double-click a row to connect. Credentials are resolved in the main process —
              the interface never sees a secret.
            </p>
          </div>
          <button
            type="button"
            className={styles.primary}
            onClick={() => setView({ kind: 'host-form', host: null })}
          >
            Add host
          </button>
        </div>

        <input
          className={styles.filter}
          value={filter}
          placeholder="Filter by name, address, or port"
          onChange={(event) => setFilter(event.target.value)}
        />

        {hosts.length === 0 ? (
          <p className={styles.empty}>
            No saved hosts yet. Add one, or use Quick connect for a session you do not want
            to keep.
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Protocol</th>
                <th>Address</th>
                <th>Folder</th>
                <th>Credential</th>
                <th>Logging</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((host) => (
                <tr key={host.id} onDoubleClick={() => void connectHost(host)}>
                  <td className={styles.name}>{host.name}</td>
                  <td className={styles.mono}>{host.protocol}</td>
                  <td className={styles.mono}>
                    {host.protocol === 'serial'
                      ? `${host.serial?.path ?? '—'} @ ${host.serial?.baudRate ?? ''}`
                      : `${host.address ?? '—'}:${host.port ?? ''}`}
                  </td>
                  <td>{folderName(host.folderId)}</td>
                  <td>{credentialName(host)}</td>
                  <td>
                    <span className={host.logging ? styles.on : styles.off}>
                      {host.logging ? 'on' : 'off'}
                    </span>
                  </td>
                  <td className={styles.actions}>
                    <button type="button" onClick={() => void connectHost(host)}>
                      Connect
                    </button>
                    <button
                      type="button"
                      onClick={() => setView({ kind: 'host-form', host })}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={styles.danger}
                      onClick={() => {
                        if (window.confirm(`Delete "${host.name}"? Its logs are kept.`)) {
                          void deleteHost(host.id);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {hosts.length > 0 && shown.length === 0 && (
          <p className={styles.empty}>Nothing matches “{filter.trim()}”.</p>
        )}
      </div>
    </div>
  );
}
