import { useSessions, type SidebarSection } from '@renderer/stores/sessions.js';
import { useConfig } from '@renderer/stores/config.js';
import { HostTree } from './HostTree.js';
import { CredentialList } from './CredentialList.js';
import styles from './Sidebar.module.css';

const SECTIONS: { key: SidebarSection; label: string; icon: string }[] = [
  { key: 'hosts', label: 'Hosts', icon: '▤' },
  { key: 'credentials', label: 'Credentials', icon: '⚿' },
  { key: 'logs', label: 'Logs', icon: '≡' },
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
              if (item.key === 'quick') setView({ kind: 'quick' });
              else if (item.key === 'logs') setView({ kind: 'sessions' });
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

        {section === 'hosts' && <HostTree />}
        {section === 'credentials' && <CredentialList />}
        {section === 'logs' && (
          <p className={styles.placeholder}>
            Sessions are being written to disk now. The browser for reading them back —
            device tree, virtualised viewer, search — arrives in phase 7.
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
