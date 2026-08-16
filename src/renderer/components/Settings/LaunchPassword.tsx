import { useEffect, useState } from 'react';
import { SecretInput } from '../Forms/SecretInput.js';
import styles from '../Forms/form.module.css';
import own from './SettingsView.module.css';

/**
 * Turning the launch password on, off, or changing it (§ phase 15).
 *
 * The honesty here matters more than the feature: this locks the app, it does not encrypt
 * anything, and saying so is the difference between a useful control and a false one.
 */
export function LaunchPassword(): JSX.Element {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.ns3h.lock.status().then((status) => setEnabled(status.enabled));
  }, []);

  const reset = () => {
    setOpen(false);
    setCurrent('');
    setNext('');
    setAgain('');
    setError(null);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (next !== again) {
      setError('Those two do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await window.ns3h.lock.set(next, enabled ? current : null);
      if (!result.ok) {
        setError(result.reason ?? 'That could not be saved.');
        return;
      }
      setEnabled(true);
      reset();
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.ns3h.lock.set(null, current);
      if (!result.ok) {
        setError(result.reason ?? 'That could not be saved.');
        return;
      }
      setEnabled(false);
      reset();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Launch password</div>

      <p className={own.hint}>
        With this on, NS3H asks for a password before it opens, and the main process
        refuses to hand over a saved secret until it has one. Off by default.
      </p>
      <p className={own.hint}>
        <strong>It locks the app; it does not encrypt anything.</strong> Your passwords stay
        where they were, in the OS keychain, protected by the OS. This stops someone sitting
        down at your unlocked machine and reading them out of the forms. It does not stop
        someone who can read the keychain itself — nothing NS3H does could.
      </p>
      <p className={own.hint}>
        There is no recovery. Forgetting it means using <strong>Reset</strong> on the launch
        screen, which erases every saved credential and secret. Hosts survive.
      </p>

      {!open && (
        <div className={own.pathRow}>
          <span className={own.status}>
            {enabled ? 'On — NS3H asks at launch' : 'Off — NS3H opens straight away'}
          </span>
          <button type="button" className={own.choose} onClick={() => setOpen(true)}>
            {enabled ? 'Change or turn off' : 'Set a launch password'}
          </button>
        </div>
      )}

      {open && (
        <form onSubmit={(event) => void save(event)}>
          {enabled && (
            <div className={styles.field}>
              <label htmlFor="lock-current">Current launch password</label>
              <SecretInput id="lock-current" value={current} onChange={setCurrent} autoFocus />
            </div>
          )}

          <div className={styles.field}>
            <label htmlFor="lock-new">New launch password</label>
            <SecretInput
              id="lock-new"
              value={next}
              onChange={setNext}
              autoFocus={!enabled}
              placeholder="At least 8 characters"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="lock-again">And again</label>
            <SecretInput id="lock-again" value={again} onChange={setAgain} />
          </div>

          {error && (
            <p className={styles.fieldError} role="alert">
              {error}
            </p>
          )}

          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={reset}>
              Cancel
            </button>
            {enabled && (
              <button
                type="button"
                className={styles.danger}
                disabled={busy || !current}
                onClick={() => void turnOff()}
              >
                Turn off
              </button>
            )}
            <button type="submit" className={styles.primary} disabled={busy || next.length < 8}>
              {busy ? 'Saving…' : enabled ? 'Change it' : 'Turn it on'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
