import type { SessionTab } from '@renderer/stores/sessions.js';
import styles from './StatusBar.module.css';

interface Props {
  tab: SessionTab | null;
}

const LABEL: Record<SessionTab['status'], string> = {
  connecting: 'connecting',
  connected: 'connected',
  closed: 'disconnected',
  error: 'failed',
};

export function StatusBar({ tab }: Props): JSX.Element {
  if (!tab) {
    return (
      <div className={styles.bar}>
        <span className={styles.left}>No session</span>
        <span className={styles.right} />
      </div>
    );
  }

  return (
    <div className={styles.bar}>
      <span className={styles.left}>
        <span className={`${styles.dot} ${styles[tab.status] ?? ''}`} />
        {tab.name}
        <span className={styles.sep}>·</span>
        ssh
        <span className={styles.sep}>·</span>
        {LABEL[tab.status]}
        {tab.negotiationSummary && (
          <>
            <span className={styles.sep}>·</span>
            <span className={styles.crypto}>{tab.negotiationSummary}</span>
          </>
        )}
      </span>
      <span className={styles.right}>
        {tab.address}:{tab.port}
      </span>
    </div>
  );
}
