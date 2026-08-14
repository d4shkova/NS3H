import { useSessions, type SidebarSection } from '@renderer/stores/sessions.js';
import styles from './Sidebar.module.css';

const SECTIONS: { key: SidebarSection; label: string; icon: string }[] = [
  { key: 'hosts', label: 'Hosts', icon: '▤' },
  { key: 'credentials', label: 'Credentials', icon: '⚿' },
  { key: 'logs', label: 'Logs', icon: '≡' },
  { key: 'quick', label: 'Quick connect', icon: '⚡' },
];

/** Phases 2–8 fill these in; the shell and its states exist now. */
const PENDING: Record<Exclude<SidebarSection, 'quick'>, string> = {
  hosts: 'Saved hosts and folders arrive with the config store (phases 2–3).',
  credentials: 'Credential entries arrive with the safeStorage keychain (phases 2–3).',
  logs: 'The log browser arrives once sessions are being written to disk (phases 4, 7).',
};

export function Sidebar(): JSX.Element {
  const section = useSessions((state) => state.section);
  const setSection = useSessions((state) => state.setSection);

  return (
    <aside className={styles.sidebar}>
      <nav className={styles.nav}>
        {SECTIONS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`${styles.item} ${section === item.key ? styles.active : ''}`}
            onClick={() => setSection(item.key)}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
      <div className={styles.body}>
        {section === 'quick' ? (
          <p className={styles.placeholder}>
            Connect to anything without saving it. The form is in the main pane; sessions log to{' '}
            <code>_quick/</code> once logging lands.
          </p>
        ) : (
          <p className={styles.placeholder}>{PENDING[section]}</p>
        )}
      </div>
    </aside>
  );
}
