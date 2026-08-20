import { useSessions, type SidebarSection } from '@renderer/stores/sessions.js';
import { useConfig } from '@renderer/stores/config.js';
import { HostShortcuts } from './HostShortcuts.js';
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
  const openSection = useSessions((state) => state.openSection);
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
            // The sidebar and the main pane show the same thing (§6.3).
            onClick={() => openSection(item.key)}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      {/* Always on screen, whatever the section. This used to be the host tree, and only
          while the Hosts page was open — which meant the same devices were in the column
          and in the pane at once, and the column was empty the rest of the time. */}
      <HostShortcuts />

      <div className={styles.body}>
        {configError && (
          <p className={styles.error} onClick={clearError} role="alert">
            {configError}
          </p>
        )}

        {section === 'home' && (
          <p className={styles.placeholder}>
            Everything the app does, one click away. With sessions open this returns to
            them; they keep running whatever else is on screen.
          </p>
        )}
        {section === 'hosts' && (
          <p className={styles.placeholder}>
            The full tree — folders, search, and every saved device — is in the main pane.
            This column keeps the ones you reach for.
          </p>
        )}
        {section === 'credentials' && <CredentialList />}
        {section === 'logs' && (
          <p className={styles.placeholder}>
            One folder per device. Open a session to read it here — virtualised and
            searchable, however large it is.
          </p>
        )}
        {section === 'transfer' && (
          <p className={styles.placeholder}>
            SFTP, SCP, or SMB. An open SSH session can be used as-is — over either SFTP
            or SCP, since gear with no SFTP subsystem usually has an SCP server. Anything
            else is a connection the pane makes itself, with nothing saved.
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
