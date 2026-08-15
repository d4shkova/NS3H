import { useConfig } from '@renderer/stores/config.js';
import styles from './list.module.css';

export function CredentialsList(): JSX.Element {
  const snapshot = useConfig((state) => state.snapshot);
  const setView = useConfig((state) => state.setView);
  const deleteCredential = useConfig((state) => state.deleteCredential);

  const { credentials } = snapshot.credentials;
  const usedBy = (credentialId: string) =>
    snapshot.hosts.hosts.filter((host) => host.credentialId === credentialId).length;

  return (
    <div className={styles.wrap}>
      <div className={styles.inner}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.heading}>Credentials</h1>
            <p className={styles.sub}>
              Shared across hosts. Passwords and passphrases live in the OS keychain and are
              never displayed back.
            </p>
          </div>
          <button
            type="button"
            className={styles.primary}
            onClick={() => setView({ kind: 'credential-form', credential: null })}
          >
            Add credential
          </button>
        </div>

        {!snapshot.secrets.available && (
          <p className={styles.warning}>{snapshot.secrets.reason}</p>
        )}

        {credentials.length === 0 ? (
          <p className={styles.empty}>
            No credentials yet. Add one to reuse it across hosts, or set one on an individual
            host instead.
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Username</th>
                <th>Key path</th>
                <th>Used by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {credentials.map((credential) => (
                <tr
                  key={credential.id}
                  onDoubleClick={() => setView({ kind: 'credential-form', credential })}
                >
                  <td className={styles.name}>{credential.name}</td>
                  <td>
                    <span className={styles.badge}>{credential.type}</span>
                  </td>
                  <td className={styles.mono}>{credential.username || '—'}</td>
                  <td className={styles.mono}>{credential.keyPath ?? '—'}</td>
                  <td>
                    {usedBy(credential.id)} host{usedBy(credential.id) === 1 ? '' : 's'}
                  </td>
                  <td className={styles.actions}>
                    <button
                      type="button"
                      onClick={() => setView({ kind: 'credential-form', credential })}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={styles.danger}
                      onClick={() => {
                        const count = usedBy(credential.id);
                        const warning = count
                          ? ` ${count} host${count === 1 ? '' : 's'} using it will fall back to prompting.`
                          : '';
                        if (window.confirm(`Delete "${credential.name}"?${warning}`)) {
                          void deleteCredential(credential.id);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
