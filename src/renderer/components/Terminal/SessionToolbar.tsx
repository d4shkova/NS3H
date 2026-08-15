import { useState } from 'react';
import { useSessions, type SessionTab } from '@renderer/stores/sessions.js';
import styles from './SessionToolbar.module.css';

interface Props {
  tab: SessionTab;
  onClear: () => void;
}

/** §6.4 — right-aligned and minimal. Send Break appears for serial sessions only. */
export function SessionToolbar({ tab, onClear }: Props): JSX.Element {
  const sendBreak = useSessions((state) => state.sendBreak);
  const closeTab = useSessions((state) => state.closeTab);
  const [breaking, setBreaking] = useState(false);

  return (
    <div className={styles.toolbar}>
      {tab.protocol === 'serial' && (
        <button
          type="button"
          className={styles.button}
          disabled={breaking || tab.status !== 'connected'}
          title="Assert break for 250 ms — used for Cisco password recovery"
          onClick={async () => {
            setBreaking(true);
            try {
              await sendBreak(tab.id);
            } finally {
              setBreaking(false);
            }
          }}
        >
          {breaking ? 'Sending…' : 'Send break'}
        </button>
      )}
      <button type="button" className={styles.button} onClick={onClear} title="Clear the screen">
        Clear
      </button>
      <button
        type="button"
        className={`${styles.button} ${styles.close}`}
        onClick={() => closeTab(tab.id)}
        title="Close this session"
      >
        Close
      </button>
    </div>
  );
}
