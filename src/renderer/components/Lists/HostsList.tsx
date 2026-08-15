import { Fragment, useMemo, useState } from 'react';
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

  /**
   * The same grouping the sidebar tree uses, so a device is in the same place in both
   * (§6.3). Folder order follows the hosts file; ungrouped devices come last under a
   * heading of their own rather than being scattered through the table.
   *
   * An empty folder still gets its heading — that is where hosts are put — but not
   * while a filter is running, when a folder with no matches is just noise.
   */
  const groups = useMemo(() => {
    const filtering = filter.trim().length > 0;
    const inFolder = (id: string | null) => shown.filter((host) => host.folderId === id);

    const grouped = folders
      .map((folder) => ({ id: folder.id, name: folder.name, hosts: inFolder(folder.id) }))
      .filter((group) => !filtering || group.hosts.length > 0);

    // A folder id that no longer resolves — an import can carry one — would otherwise
    // hide the host entirely, so anything unplaced lands in Ungrouped.
    const known = new Set(folders.map((folder) => folder.id));
    const loose = shown.filter((host) => !host.folderId || !known.has(host.folderId));
    return loose.length > 0
      ? [...grouped, { id: '', name: 'Ungrouped', hosts: loose }]
      : grouped;
  }, [shown, folders, filter]);

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
                <th>Credential</th>
                <th>Logging</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group.id || '_ungrouped'}>
                  <tr className={styles.groupRow}>
                    <th className={styles.groupName} colSpan={6} scope="colgroup">
                      {group.name}
                      <span className={styles.groupCount}>
                        {group.hosts.length} host{group.hosts.length === 1 ? '' : 's'}
                      </span>
                    </th>
                  </tr>

                  {group.hosts.length === 0 ? (
                    <tr>
                      <td className={styles.groupEmpty} colSpan={6}>
                        Empty — assign a host to this folder when you edit it.
                      </td>
                    </tr>
                  ) : (
                    group.hosts.map((host) => (
                      <tr key={host.id} onDoubleClick={() => void connectHost(host)}>
                        <td className={`${styles.name} ${styles.grouped}`}>{host.name}</td>
                        <td className={styles.mono}>{host.protocol}</td>
                        <td className={styles.mono}>
                          {host.protocol === 'serial'
                            ? `${host.serial?.path ?? '—'} @ ${host.serial?.baudRate ?? ''}`
                            : `${host.address ?? '—'}:${host.port ?? ''}`}
                        </td>
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
                    ))
                  )}
                </Fragment>
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
