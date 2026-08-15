import { useConfig } from '@renderer/stores/config.js';
import styles from './CredentialList.module.css';

export function CredentialList(): JSX.Element {
  const snapshot = useConfig((state) => state.snapshot);
  const setView = useConfig((state) => state.setView);
  const deleteCredential = useConfig((state) => state.deleteCredential);

  const { credentials } = snapshot.credentials;
  const hostsUsing = (credentialId: string) =>
    snapshot.hosts.hosts.filter((host) => host.credentialId === credentialId).length;

  return (
    <div>
      {!snapshot.secrets.available && (
        <p className={styles.warning}>{snapshot.secrets.reason}</p>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.action}
          onClick={() => setView({ kind: 'credential-form', credential: null })}
        >
          Add credential
        </button>
      </div>

      {credentials.length === 0 ? (
        <p className={styles.empty}>
          No credentials yet. Add one to reuse it across hosts, or specify one per device on the
          host itself.
        </p>
      ) : (
        <div className={styles.list}>
          {credentials.map((credential) => (
            <button
              key={credential.id}
              type="button"
              className={styles.item}
              onClick={() => setView({ kind: 'credential-form', credential })}
              onContextMenu={(event) => {
                event.preventDefault();
                const inUse = hostsUsing(credential.id);
                const warning = inUse
                  ? ` ${inUse} host${inUse === 1 ? '' : 's'} using it will fall back to prompting.`
                  : '';
                if (window.confirm(`Delete "${credential.name}"?${warning}`)) {
                  void deleteCredential(credential.id);
                }
              }}
              title="Click to edit, right-click to delete"
            >
              <span className={styles.name}>{credential.name}</span>
              {credential.username && (
                <span className={styles.username}>{credential.username}</span>
              )}
              <span className={styles.badge}>{credential.type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
