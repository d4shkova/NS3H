import { useState } from 'react';
import type { ImportPreview } from '@shared/transfer.js';
import { useConfig } from '@renderer/stores/config.js';
import formStyles from '../Forms/form.module.css';
import styles from './BackupSection.module.css';

type Stage =
  | { kind: 'idle' }
  | { kind: 'passphrase-export' }
  | { kind: 'review'; path: string; preview: ImportPreview; passphrase: string };

/** §7 — export and import, as two separate actions with different consequences. */
export function BackupSection(): JSX.Element {
  const setSnapshot = useConfig((state) => state.replaceSnapshot);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [passphrase, setPassphrase] = useState('');
  const [resolutions, setResolutions] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const exportConfig = () =>
    run(async () => {
      const path = await window.ns3h.backup.exportConfig();
      setStatus(path ? `Configuration written to ${path}` : null);
    });

  const exportBundle = () =>
    run(async () => {
      const path = await window.ns3h.backup.exportBundle(passphrase);
      setStatus(path ? `Backup written to ${path}` : null);
      setStage({ kind: 'idle' });
      setPassphrase('');
    });

  const choose = () =>
    run(async () => {
      const chosen = await window.ns3h.backup.choose();
      if (!chosen) return;
      setResolutions({});
      setStage({ kind: 'review', path: chosen.path, preview: chosen.preview, passphrase: '' });
    });

  const unlock = (stagePath: string, secret: string) =>
    run(async () => {
      const preview = await window.ns3h.backup.preview(stagePath, secret);
      setStage({ kind: 'review', path: stagePath, preview, passphrase: secret });
    });

  const apply = (current: Extract<Stage, { kind: 'review' }>) =>
    run(async () => {
      const snapshot = await window.ns3h.backup.apply({
        path: current.path,
        passphrase: current.passphrase || undefined,
        resolutions,
      });
      setSnapshot(snapshot);
      const kept = current.preview.collisions.length - Object.values(resolutions).filter(Boolean).length;
      setStatus(
        `Imported. ${current.preview.added.hosts} host(s), ` +
          `${current.preview.added.credentials} credential(s) added; ${kept} existing item(s) kept.`,
      );
      setStage({ kind: 'idle' });
    });

  return (
    <div className={formStyles.section}>
      <div className={formStyles.sectionTitle}>Backup and transfer</div>

      <div className={styles.actions}>
        <button type="button" className={styles.button} disabled={busy} onClick={exportConfig}>
          Export configuration
        </button>
        <button
          type="button"
          className={styles.button}
          disabled={busy}
          onClick={() => setStage({ kind: 'passphrase-export' })}
        >
          Export with credentials
        </button>
        <button type="button" className={styles.button} disabled={busy} onClick={choose}>
          Import…
        </button>
      </div>

      <p className={styles.note}>
        <strong>Export configuration</strong> writes hosts, folders and settings as readable JSON —
        no credentials, no secrets, no known-hosts. Safe to email or commit.{' '}
        <strong>Export with credentials</strong> adds the credential list and its secrets, encrypted
        under a passphrase with Argon2id and AES-256-GCM. Private keys are never included; only the
        path to them travels.
      </p>

      {stage.kind === 'passphrase-export' && (
        <form
          className={styles.panel}
          onSubmit={(event) => {
            event.preventDefault();
            void exportBundle();
          }}
        >
          <label htmlFor="bundle-passphrase">Passphrase for this backup</label>
          <input
            id="bundle-passphrase"
            type="password"
            autoFocus
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
          <p className={styles.warning}>
            There is no recovery for this passphrase. Without it the backup cannot be read.
          </p>
          <div className={styles.panelActions}>
            <button type="button" onClick={() => setStage({ kind: 'idle' })}>
              Cancel
            </button>
            <button type="submit" className={styles.primary} disabled={!passphrase || busy}>
              Export
            </button>
          </div>
        </form>
      )}

      {stage.kind === 'review' && stage.preview.needsPassphrase && (
        <form
          className={styles.panel}
          onSubmit={(event) => {
            event.preventDefault();
            void unlock(stage.path, passphrase);
          }}
        >
          <label htmlFor="unlock-passphrase">This backup is encrypted</label>
          <input
            id="unlock-passphrase"
            type="password"
            autoFocus
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
          <div className={styles.panelActions}>
            <button type="button" onClick={() => setStage({ kind: 'idle' })}>
              Cancel
            </button>
            <button type="submit" className={styles.primary} disabled={!passphrase || busy}>
              Unlock
            </button>
          </div>
        </form>
      )}

      {stage.kind === 'review' && !stage.preview.needsPassphrase && (
        <div className={styles.panel}>
          <p className={styles.summary}>
            {stage.preview.added.hosts} host(s), {stage.preview.added.folders} folder(s) and{' '}
            {stage.preview.added.credentials} credential(s) would be added.
          </p>

          {stage.preview.collisions.length > 0 && (
            <>
              <p className={styles.summary}>
                {stage.preview.collisions.length} item(s) already exist here. Nothing is replaced
                unless you tick it.
              </p>
              <div className={styles.collisions}>
                {stage.preview.collisions.map((collision) => (
                  <label key={collision.id} className={styles.collision}>
                    <input
                      type="checkbox"
                      checked={resolutions[collision.id] ?? false}
                      onChange={(event) =>
                        setResolutions((current) => ({
                          ...current,
                          [collision.id]: event.target.checked,
                        }))
                      }
                    />
                    <span className={styles.collisionText}>
                      <span className={styles.kind}>{collision.kind}</span>
                      <span className={styles.existing}>keep: {collision.existing}</span>
                      <span className={styles.incoming}>replace with: {collision.incoming}</span>
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}

          {stage.preview.missingKeys.length > 0 && (
            <div className={styles.missing}>
              <strong>Key files not found on this machine:</strong>
              {stage.preview.missingKeys.map((entry) => (
                <div key={entry.id} className={styles.missingRow}>
                  {entry.name} — <code>{entry.keyPath}</code>
                </div>
              ))}
              <p className={styles.note}>
                Private keys are never carried in a backup. Edit the credential to point at the key
                on this machine.
              </p>
            </div>
          )}

          <div className={styles.panelActions}>
            <button type="button" onClick={() => setStage({ kind: 'idle' })}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.primary}
              disabled={busy}
              onClick={() => void apply(stage)}
            >
              Import
            </button>
          </div>
        </div>
      )}

      {status && <p className={styles.status}>{status}</p>}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
