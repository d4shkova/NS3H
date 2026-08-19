import { useEffect, useMemo, useState } from 'react';
import type { Host } from '@shared/config.js';
import { useConfig } from '@renderer/stores/config.js';
import { useSessions } from '@renderer/stores/sessions.js';
import { FREQUENT_LIMIT, shortcutsFor } from '@renderer/stores/shortcuts.js';
import styles from './HostShortcuts.module.css';

interface MenuState {
  x: number;
  y: number;
  host: Host;
}

/**
 * The sidebar's quick-connect column: the seven hosts connected to most often, then the
 * ones marked as favourites.
 *
 * It replaced a copy of the whole host tree, which was only ever on screen while the
 * Hosts page was open — so the one time the column had hosts in it was the one time the
 * pane already listed them, and the same devices were on screen twice. This is the other
 * way round: it is always there, it is short, and it holds the devices worth one click
 * rather than all of them. Everything else lives on the Hosts page.
 */
export function HostShortcuts(): JSX.Element | null {
  const hosts = useConfig((state) => state.snapshot.hosts.hosts);
  const usage = useConfig((state) => state.snapshot.settings.hostUsage);
  const showFrequent = useConfig((state) => state.snapshot.settings.showFrequentHosts);
  const showFavorites = useConfig((state) => state.snapshot.settings.showFavoriteHosts);
  const setView = useConfig((state) => state.setView);
  const setFavorite = useConfig((state) => state.setFavorite);
  const connectHost = useSessions((state) => state.connectHost);
  const openSection = useSessions((state) => state.openSection);

  const [menu, setMenu] = useState<MenuState | null>(null);

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

  const { frequent, favorites } = useMemo(
    () => shortcutsFor(hosts, usage, { frequent: showFrequent, favorites: showFavorites }),
    [hosts, usage, showFrequent, showFavorites],
  );

  const open = (host: Host) => {
    setView({ kind: 'sessions' });
    void connectHost(host);
  };

  const renderHost = (host: Host) => {
    const address = host.protocol === 'serial' ? (host.serial?.path ?? '') : (host.address ?? '');
    // The row carries one label at a time, as the tree did: the address takes the name's
    // place on hover rather than sitting beside it in a column this narrow.
    const swaps = address !== '' && address !== host.name;

    return (
      <div key={host.id} className={styles.row}>
        <button
          type="button"
          className={styles.host}
          onDoubleClick={() => open(host)}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu({ x: event.clientX, y: event.clientY, host });
          }}
          title={`${host.name}${swaps ? ` · ${address}` : ''} — double-click to connect, right-click for more`}
        >
          <span className={styles.protocol}>{host.protocol}</span>
          <span className={`${styles.label} ${swaps ? styles.swaps : ''}`}>
            <span className={styles.friendly}>{host.name || address}</span>
            <span className={styles.address}>{address}</span>
          </span>
        </button>
        <button
          type="button"
          className={`${styles.star} ${host.favorite ? styles.starred : ''}`}
          aria-pressed={host.favorite}
          title={host.favorite ? 'Remove from favourites' : 'Add to favourites'}
          onClick={() => void setFavorite(host, !host.favorite)}
        >
          {host.favorite ? '★' : '☆'}
        </button>
      </div>
    );
  };

  // Both lists switched off in Settings: no column, rather than an empty box with two
  // headings in it. The menu below belongs to a row, so it cannot be open either.
  if (!showFrequent && !showFavorites) return null;

  return (
    <div className={styles.panel}>
      {showFrequent && (
        <div className={styles.group}>
          <div className={styles.groupTitle}>Frequent</div>
          {frequent.length > 0 ? (
            frequent.map(renderHost)
          ) : (
            <p className={styles.empty}>
              The {FREQUENT_LIMIT} devices you connect to most appear here, busiest first.
            </p>
          )}
        </div>
      )}

      {showFavorites && (
        <div className={styles.group}>
          <div className={styles.groupTitle}>Favourites</div>
          {favorites.length > 0 ? (
            favorites.map(renderHost)
          ) : (
            <p className={styles.empty}>
              Star a device here, or tick <em>Favourite</em> when editing it, to pin it to
              this column.
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        className={styles.all}
        onClick={() => openSection('hosts')}
      >
        All hosts →
      </button>

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
              open(menu.host);
              setMenu(null);
            }}
          >
            Connect
          </button>
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => {
              void setFavorite(menu.host, !menu.host.favorite);
              setMenu(null);
            }}
          >
            {menu.host.favorite ? 'Remove from favourites' : 'Add to favourites'}
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
        </div>
      )}
    </div>
  );
}
