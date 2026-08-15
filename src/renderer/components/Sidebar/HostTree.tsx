import { useEffect, useMemo, useState } from 'react';
import type { Folder, Host } from '@shared/config.js';
import { useConfig } from '@renderer/stores/config.js';
import { useSessions } from '@renderer/stores/sessions.js';
import styles from './HostTree.module.css';

interface MenuState {
  x: number;
  y: number;
  host: Host;
}

export function HostTree(): JSX.Element {
  const snapshot = useConfig((state) => state.snapshot);
  const search = useConfig((state) => state.search);
  const setSearch = useConfig((state) => state.setSearch);
  const expanded = useConfig((state) => state.expandedFolders);
  const toggleFolder = useConfig((state) => state.toggleFolder);
  const setView = useConfig((state) => state.setView);
  const deleteHost = useConfig((state) => state.deleteHost);
  const duplicateHost = useConfig((state) => state.duplicateHost);
  const deleteFolder = useConfig((state) => state.deleteFolder);
  const saveFolder = useConfig((state) => state.saveFolder);
  const connectHost = useSessions((state) => state.connectHost);

  const [menu, setMenu] = useState<MenuState | null>(null);
  // Electron does not implement window.prompt(), so folder naming is inline.
  const [newFolder, setNewFolder] = useState<string | null>(null);

  useEffect(() => {
    if (!menu) return undefined;
    const dismiss = () => setMenu(null);
    window.addEventListener('click', dismiss);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('click', dismiss);
      window.removeEventListener('resize', dismiss);
    };
  }, [menu]);

  const { folders, hosts } = snapshot.hosts;

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return hosts;
    // §6.3 — the search field filters by name and address.
    return hosts.filter(
      (host) =>
        host.name.toLowerCase().includes(needle) ||
        (host.address ?? '').toLowerCase().includes(needle),
    );
  }, [hosts, search]);

  const rootHosts = matches.filter((host) => host.folderId === null);
  const hostsIn = (folderId: string) => matches.filter((host) => host.folderId === folderId);

  const renderHost = (host: Host, indented: boolean) => (
    <button
      key={host.id}
      type="button"
      className={`${styles.host} ${indented ? styles.indent : ''}`}
      onDoubleClick={() => {
        setView({ kind: 'quick' });
        void connectHost(host);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY, host });
      }}
      title={`${host.name} — double-click to connect, right-click for more`}
    >
      <span className={styles.protocol}>{host.protocol}</span>
      <span className={styles.name}>{host.name}</span>
      {host.address && <span className={styles.address}>{host.address}</span>}
    </button>
  );

  const renderFolder = (folder: Folder) => {
    const isOpen = expanded[folder.id] ?? true;
    const contents = hostsIn(folder.id);
    // While searching, a folder with no matches is noise.
    if (search.trim() && contents.length === 0) return null;

    return (
      <div key={folder.id}>
        <button
          type="button"
          className={styles.folder}
          title={`${contents.length} host${contents.length === 1 ? '' : 's'} — right-click to delete`}
          onClick={() => toggleFolder(folder.id)}
          onContextMenu={(event) => {
            event.preventDefault();
            if (window.confirm(`Delete the folder "${folder.name}"? Its hosts are kept.`)) {
              void deleteFolder(folder.id);
            }
          }}
        >
          <span className={styles.chevron}>{isOpen ? '▾' : '▸'}</span>
          {folder.name}
        </button>
        {(isOpen || search.trim()) && contents.map((host) => renderHost(host, true))}
      </div>
    );
  };

  return (
    <div>
      <div className={styles.search}>
        <input
          value={search}
          placeholder="Filter by name or address"
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.action}
          onClick={() => setView({ kind: 'host-form', host: null })}
        >
          Add host
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={() => setNewFolder((current) => (current === null ? '' : null))}
        >
          Add folder
        </button>
      </div>

      {newFolder !== null && (
        <form
          className={styles.newFolder}
          onSubmit={(event) => {
            event.preventDefault();
            const name = newFolder.trim();
            if (!name) return;
            void saveFolder({ id: '', name, parentId: null });
            setNewFolder(null);
          }}
        >
          <input
            autoFocus
            value={newFolder}
            placeholder="Folder name"
            onChange={(event) => setNewFolder(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && setNewFolder(null)}
          />
          <div className={styles.newFolderActions}>
            <button type="button" className={styles.action} onClick={() => setNewFolder(null)}>
              Cancel
            </button>
            <button type="submit" className={`${styles.action} ${styles.confirm}`}>
              Create
            </button>
          </div>
        </form>
      )}

      {/* A folder with nothing in it still has to be visible — it is where hosts get put. */}
      {hosts.length === 0 && folders.length === 0 ? (
        <p className={styles.empty}>
          No saved hosts yet. Add one, or use Quick connect for a one-off session.
        </p>
      ) : (
        <div className={styles.tree}>
          {folders.map(renderFolder)}
          {rootHosts.map((host) => renderHost(host, false))}
          {search.trim() && matches.length === 0 && (
            <p className={styles.empty}>Nothing matches “{search.trim()}”.</p>
          )}
        </div>
      )}

      {menu && (
        <div
          className={styles.menu}
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => {
              setView({ kind: 'quick' });
              void connectHost(menu.host);
              setMenu(null);
            }}
          >
            Connect
          </button>
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => {
              setView({ kind: 'host-form', host: menu.host });
              setMenu(null);
            }}
          >
            Edit
          </button>
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => {
              void duplicateHost(menu.host);
              setMenu(null);
            }}
          >
            Duplicate
          </button>
          <div className={styles.separator} />
          <button
            type="button"
            className={`${styles.menuItem} ${styles.danger}`}
            onClick={() => {
              if (window.confirm(`Delete "${menu.host.name}"? Its logs are kept.`)) {
                void deleteHost(menu.host.id);
              }
              setMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
