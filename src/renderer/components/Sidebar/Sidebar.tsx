import { useSessions, type SidebarSection } from '@renderer/stores/sessions.js';
import { useConfig } from '@renderer/stores/config.js';
import { HostTree } from './HostTree.js';
import { CredentialList } from './CredentialList.js';
import styles from './Sidebar.module.css';

const SECTIONS: { key: SidebarSection; label: string; icon: string }[] = [
  { key: 'home', label: 'Home', icon: '⌂' },
  { key: 'hosts', label: 'Hosts', icon: '▤' },
  { key: 'credentials', label: 'Credentials', icon: '⚿' },
  { key: 'logs', label: 'Logs', icon: '≡' },
  { key: 'transfer', label: 'File transfer', icon: '⇅' },
  { key: 'quick', label: 'Quick connect', icon: '⚡' },
];

export function Sidebar(): JSX.Element {
  const section = useSessions((state) => state.section);
  const setSection = useSessions((state) => state.setSection);
  const setView = useConfig((state) => state.setView);
  const configError = useConfig((state) => state.error);
  const clearError = useConfig((state) => state.clearError);

  return (
    <aside className={styles.sidebar}>
      <nav className={styles.nav}>
        {SECTIONS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`${styles.item} ${section === item.key ? styles.active : ''}`}
            onClick={() => {
              setSection(item.key);
              // The sidebar and the main pane show the same thing (§6.3).
              setView({ kind: item.key });
            }}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className={styles.body}>
        {configError && (
          <p className={styles.error} onClick={clearError} role="alert">
            {configError}
          </p>
        )}

        {section === 'home' && (
          <p className={styles.placeholder}>
            Everything the app does, one click away. Sessions keep running while you are here.
          </p>
        )}
        {section === 'hosts' && <HostTree />}
        {section === 'credentials' && <CredentialList />}
        {section === 'logs' && (
          <p className={styles.placeholder}>
            One folder per device. Open a session to read it here — virtualised and
            searchable, however large it is.
          </p>
        )}
        {section === 'transfer' && (
          <p className={styles.placeholder}>
            SFTP or SMB. An open SSH session can be used as-is; anything else is a
            connection the pane makes itself, with no CLI session and nothing saved.
          </p>
        )}
        {section === 'quick' && (
          <p className={styles.placeholder}>
            Connect to anything without saving it. The form is in the main pane; sessions log
            to <code>_quick/&lt;address&gt;/</code>.
          </p>
        )}
      </div>
    </aside>
  );
}
