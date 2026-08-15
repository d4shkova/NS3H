import { useConfig } from '@renderer/stores/config.js';
import styles from '../Forms/form.module.css';
import own from './SettingsView.module.css';

export function SettingsView(): JSX.Element {
  const snapshot = useConfig((state) => state.snapshot);
  const chooseLogDirectory = useConfig((state) => state.chooseLogDirectory);
  const setView = useConfig((state) => state.setView);

  const { logDirectory } = snapshot.settings;

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <h1 className={styles.heading}>Settings</h1>
        <p className={styles.sub}>
          Config lives in plain JSON you can hand-edit. Secrets are held by the OS keychain,
          never in those files.
        </p>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Session logs</div>

          <div className={styles.field}>
            <label htmlFor="logDirectory">Log directory</label>
            <div className={own.pathRow}>
              <code className={`${own.path} ${logDirectory ? '' : own.unset}`}>
                {logDirectory ?? 'Not set — sessions are not being logged'}
              </code>
              <button type="button" className={own.choose} onClick={() => void chooseLogDirectory()}>
                {logDirectory ? 'Change' : 'Choose'}
              </button>
            </div>
          </div>

          {/*
            §5.4 — surfaced once, here, in plain language. Not repeated per session.
          */}
          <p className={own.warning}>
            <strong>Session logs contain whatever the device printed.</strong> A{' '}
            <code>show running-config</code> puts password hashes, SNMP community strings, and
            pre-shared keys into these files in plain text. Keep the log directory somewhere you
            would be comfortable keeping a copy of your configs, and think before sharing one.
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

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Secret storage</div>
          <p className={own.status}>
            {snapshot.secrets.available
              ? 'The OS keychain is available. Saved passwords and key passphrases are encrypted by it.'
              : snapshot.secrets.reason}
          </p>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => setView({ kind: 'quick' })}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
