import { useState } from 'react';
import { SecretInput } from '../Forms/SecretInput.js';
import styles from './LockScreen.module.css';

interface Props {
  /** Called once main has accepted the password, or the reset has run. */
  onUnlocked: () => void;
}

/**
 * The launch password (§ phase 15).
 *
 * Nothing else is on screen until this is satisfied, and nothing else is answered either
 * — main refuses every channel but this one while it is locked, so the gate is not
 * something the interface is trusted to enforce.
 */
export function LockScreen({ onUnlocked }: Props): JSX.Element {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmation, setConfirmation] = useState('');

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (await window.ns3h.lock.unlock(password)) onUnlocked();
      else setError('That is not the launch password.');
    } finally {
      setBusy(false);
      setPassword('');
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await window.ns3h.lock.reset();
      onUnlocked();
    } finally {
      setBusy(false);
    }
  };

  if (resetting) {
    return (
      <div className={styles.wrap}>
        <div className={styles.card}>
          <h1 className={styles.heading}>Reset</h1>
          <p className={styles.sub}>
            There is no way to recover a forgotten launch password — it is stored as a hash,
            and nothing can turn that back into the password. Starting again is the only way
            in, and it costs the credentials.
          </p>

          <div className={styles.consequences}>
            <p className={styles.goes}>
              <strong>Removed:</strong> every saved credential, every stored password and key
              passphrase, and the launch password itself.
            </p>
            <p className={styles.stays}>
              <strong>Kept:</strong> your hosts — names, addresses, ports, folders and logging
              settings. They will ask for credentials when you connect, as an unsaved host does.
            </p>
            <p className={styles.stays}>
              <strong>Untouched:</strong> session logs, known host keys, and private key files
              on disk. NS3H only ever recorded where a key was, never a copy of it.
            </p>
          </div>

          <label htmlFor="reset-confirm" className={styles.confirmLabel}>
            Type <code>RESET</code> to confirm
          </label>
          <input
            id="reset-confirm"
            className={styles.confirmInput}
            value={confirmation}
            autoFocus
            autoComplete="off"
            onChange={(event) => setConfirmation(event.target.value)}
          />

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                setResetting(false);
                setConfirmation('');
              }}
            >
              Back
            </button>
            <button
              type="button"
              className={styles.danger}
              disabled={busy || confirmation !== 'RESET'}
              onClick={() => void reset()}
            >
              {busy ? 'Resetting…' : 'Erase credentials and let me in'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={(event) => void unlock(event)}>
        <h1 className={styles.heading}>NS3H is locked</h1>
        <p className={styles.sub}>
          Enter the launch password to open it. Saved passwords can be read back inside the
          app, which is what this is here to stand in front of.
        </p>

        <label htmlFor="launch-password" className={styles.label}>
          Launch password
        </label>
        <SecretInput id="launch-password" value={password} onChange={setPassword} autoFocus />

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.link} onClick={() => setResetting(true)}>
            Forgotten it?
          </button>
          <button type="submit" className={styles.primary} disabled={busy || !password}>
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </div>
      </form>
    </div>
  );
}
