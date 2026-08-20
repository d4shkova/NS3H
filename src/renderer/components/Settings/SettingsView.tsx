import { useEffect, useState } from 'react';
import { useConfig } from '@renderer/stores/config.js';
import { ThemePicker } from './ThemePicker.js';
import { BackupSection } from './BackupSection.js';
import { LaunchPassword } from './LaunchPassword.js';
import { SidebarSection } from './SidebarSection.js';
import styles from '../Forms/form.module.css';
import own from './SettingsView.module.css';

/**
 * Settings is grouped rather than stacked (§6.3).
 *
 * Every section used to sit in one 520px column, which meant finding one control was a
 * scroll past everything above it — and the theme picker alone is twenty-three previews
 * tall. The groups below are chosen so that each one fits a window without scrolling; the
 * rail says what is in each, so the answer to "where is that setting" is on screen
 * instead of somewhere down the page.
 */
type GroupKey =
  | 'logs'
  | 'appearance'
  | 'sidebar'
  | 'terminal'
  | 'security'
  | 'backup'
  | 'about';

const GROUPS: { key: GroupKey; label: string; note: string }[] = [
  { key: 'logs', label: 'Session logs', note: 'Where sessions are recorded' },
  { key: 'appearance', label: 'Appearance', note: 'Theme, interface and terminal' },
  { key: 'sidebar', label: 'Sidebar', note: 'Frequent and favourite hosts' },
  { key: 'terminal', label: 'Terminal', note: 'Copy, paste and warnings' },
  { key: 'security', label: 'Security', note: 'Keychain and launch password' },
  { key: 'backup', label: 'Backup', note: 'Export and import configuration' },
  { key: 'about', label: 'About', note: 'Version and author' },
];

export function SettingsView(): JSX.Element {
  const snapshot = useConfig((state) => state.snapshot);
  const chooseLogDirectory = useConfig((state) => state.chooseLogDirectory);
  const saveSettings = useConfig((state) => state.saveSettings);
  const setView = useConfig((state) => state.setView);
  const [group, setGroup] = useState<GroupKey>('logs');
  /**
   * Asked of main rather than read from an import of package.json, so a packaged build
   * reports the version it was actually built as. Empty until the answer arrives — a
   * placeholder version would be a wrong one.
   */
  const [version, setVersion] = useState('');

  useEffect(() => {
    void window.ns3h
      .platform()
      .then((info) => setVersion(info.version))
      .catch(() => setVersion(''));
  }, []);

  const { logDirectory } = snapshot.settings;

  return (
    <div className={own.wrap}>
      <div className={own.screen}>
        <div className={own.header}>
          <h1 className={styles.heading}>Settings</h1>
          <p className={styles.sub}>
            Config lives in plain JSON you can hand-edit. Secrets are held by the OS keychain,
            never in those files.
          </p>
        </div>

        <div className={own.layout}>
          <nav className={own.rail} aria-label="Settings sections">
            {GROUPS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className={`${own.railItem} ${group === entry.key ? own.railActive : ''}`}
                aria-current={group === entry.key}
                onClick={() => setGroup(entry.key)}
              >
                <span className={own.railLabel}>{entry.label}</span>
                <span className={own.railNote}>{entry.note}</span>
              </button>
            ))}
          </nav>

          <div className={own.panel}>
            {group === 'logs' && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Session logs</div>

                <div className={styles.field}>
                  <label htmlFor="logDirectory">Log directory</label>
                  <div className={own.pathRow}>
                    <code className={`${own.path} ${logDirectory ? '' : own.unset}`}>
                      {logDirectory ?? 'Not set — sessions are not being logged'}
                    </code>
                    <button
                      type="button"
                      className={own.choose}
                      onClick={() => void chooseLogDirectory()}
                    >
                      {logDirectory ? 'Change' : 'Choose'}
                    </button>
                  </div>
                </div>

                {/*
                  §5.4 — surfaced once, here, in plain language. Not repeated per session.
                */}
                <p className={own.warning}>
                  <strong>Session logs contain whatever the device printed.</strong> A{' '}
                  <code>show running-config</code> puts password hashes, SNMP community strings,
                  and pre-shared keys into these files in plain text. Keep the log directory
                  somewhere you would be comfortable keeping a copy of your configs, and think
                  before sharing one.
                </p>

                {logDirectory && (
                  <button
                    type="button"
                    className={own.reveal}
                    onClick={() => void window.ns3h.shell.reveal(logDirectory)}
                  >
                    Reveal in file manager
                  </button>
                )}
              </div>
            )}

            {group === 'appearance' && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Theme</div>
                <p className={own.status}>
                  Applies to the interface and to the session output — the palette a device's
                  colours are rendered with.
                </p>
                <ThemePicker />
              </div>
            )}

            {group === 'sidebar' && <SidebarSection />}

            {group === 'terminal' && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Terminal</div>
                <p className={own.status}>
                  Selecting text in a session copies it. Right-click pastes.
                </p>
                <label className={own.toggle}>
                  <input
                    type="checkbox"
                    checked={snapshot.settings.pasteWarnMultiline}
                    onChange={(event) =>
                      void saveSettings({ pasteWarnMultiline: event.target.checked })
                    }
                  />
                  Warn before pasting more than one line
                </label>
                <p className={own.hint}>
                  A multi-line paste runs each line as it arrives. With the warning off, it is
                  sent straight to the device.
                </p>
              </div>
            )}

            {group === 'security' && (
              <>
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Secret storage</div>
                  <p className={own.status}>
                    {snapshot.secrets.available
                      ? 'The OS keychain is available. Saved passwords and key passphrases are encrypted by it.'
                      : snapshot.secrets.reason}
                  </p>
                </div>
                <LaunchPassword />
              </>
            )}

            {group === 'backup' && <BackupSection />}

            {group === 'about' && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>About</div>
                <p className={own.about}>
                  NS3H{version && ` v.${version}`}
                  <br />A complete and free ssh client
                </p>
                <p className={own.about}>W.H. Finein</p>
              </div>
            )}
          </div>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => setView({ kind: 'home' })}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
