import { useState } from 'react';
import { useConfig } from '@renderer/stores/config.js';
import { FREQUENT_LIMIT } from '@renderer/stores/shortcuts.js';
import styles from '../Forms/form.module.css';
import own from './SettingsView.module.css';

/**
 * What the sidebar's shortcut column shows, and how to make it forget.
 *
 * Two cards rather than one: switching a list off and erasing the history behind it are
 * different sizes of decision, and the second is not undoable.
 */
export function SidebarSection(): JSX.Element {
  const settings = useConfig((state) => state.snapshot.settings);
  const hosts = useConfig((state) => state.snapshot.hosts.hosts);
  const saveSettings = useConfig((state) => state.saveSettings);
  const resetHostUsage = useConfig((state) => state.resetHostUsage);
  const [confirming, setConfirming] = useState(false);

  const counted = Object.keys(settings.hostUsage).length;
  const starred = hosts.filter((host) => host.favorite).length;
  const bothOff = !settings.showFrequentHosts && !settings.showFavoriteHosts;

  return (
    <>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Sidebar</div>
        <p className={own.status}>
          The column under the navigation: the devices you connect to most, and the ones you
          have starred. Either list can be switched off; with both off the column is not
          there at all, and the Hosts screen is where devices live.
        </p>

        <label className={own.toggle}>
          <input
            type="checkbox"
            checked={settings.showFrequentHosts}
            onChange={(event) => void saveSettings({ showFrequentHosts: event.target.checked })}
          />
          Show the {FREQUENT_LIMIT} most frequent connections
        </label>

        <label className={own.toggle}>
          <input
            type="checkbox"
            checked={settings.showFavoriteHosts}
            onChange={(event) => void saveSettings({ showFavoriteHosts: event.target.checked })}
          />
          Show favourites
        </label>

        <p className={own.hint}>
          {bothOff
            ? 'Both are off — the sidebar shows no hosts.'
            : `${counted} device${counted === 1 ? '' : 's'} counted, ${starred} starred. A favourite that is already in the frequent list is not repeated.`}
        </p>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Reset the frequent list</div>
        <p className={own.hint}>
          Forgets every connection count and starts again from nothing — useful after a spell
          of work on devices you do not normally touch. Favourites are not affected: a list
          you curated by hand is not history. Nothing else changes, and no session or log is
          touched.
        </p>

        {confirming ? (
          <div className={own.confirmRow}>
            <span className={own.status}>
              Forget {counted} connection count{counted === 1 ? '' : 's'}?
            </span>
            <button type="button" className={styles.secondary} onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.danger}
              onClick={() => {
                void resetHostUsage();
                setConfirming(false);
              }}
            >
              Reset it
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={own.reveal}
            disabled={counted === 0}
            onClick={() => setConfirming(true)}
          >
            {counted === 0 ? 'Nothing counted yet' : 'Reset the frequent list'}
          </button>
        )}
      </div>
    </>
  );
}
