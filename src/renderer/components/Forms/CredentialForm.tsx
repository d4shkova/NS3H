import { useState } from 'react';
import type { Credential } from '@shared/config.js';
import { useConfig } from '@renderer/stores/config.js';
import styles from './form.module.css';
import { SecretInput } from './SecretInput.js';

interface Props {
  credential: Credential | null;
}

export function CredentialForm({ credential }: Props): JSX.Element {
  const snapshot = useConfig((state) => state.snapshot);
  const saveCredential = useConfig((state) => state.saveCredential);
  const deleteCredential = useConfig((state) => state.deleteCredential);
  const setView = useConfig((state) => state.setView);

  const [name, setName] = useState(credential?.name ?? '');
  const [type, setType] = useState<'password' | 'key'>(credential?.type ?? 'password');
  const [username, setUsername] = useState(credential?.username ?? '');
  const [keyPath, setKeyPath] = useState(credential?.keyPath ?? '');
  const [secret, setSecret] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isEdit = credential !== null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = 'Give this credential a name.';
    if (!username.trim()) found.username = 'Enter a username.';
    if (type === 'key' && !keyPath.trim()) found.keyPath = 'Enter the path to a private key.';

    setErrors(found);
    if (Object.keys(found).length > 0) return;

    await saveCredential(
      {
        id: credential?.id ?? '',
        name: name.trim(),
        type,
        username: username.trim(),
        keyPath: type === 'key' ? keyPath.trim() : null,
        hasPassphrase: type === 'key' && (secret.length > 0 || (credential?.hasPassphrase ?? false)),
      },
      // Left blank on an edit means "unchanged"; there is no way to read the old one back.
      secret ? { [type === 'key' ? 'passphrase' : 'password']: secret } : undefined,
    );
  };

  const field = (key: string, label: string, node: JSX.Element, hint?: string) => (
    <div className={`${styles.field} ${errors[key] ? styles.errored : ''}`}>
      <label htmlFor={key}>{label}</label>
      {node}
      {hint && !errors[key] && <p className={styles.hint}>{hint}</p>}
      {errors[key] && <p className={styles.fieldError}>{errors[key]}</p>}
    </div>
  );

  const inUse = credential
    ? snapshot.hosts.hosts.filter((host) => host.credentialId === credential.id).length
    : 0;

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={submit}>
        <h1 className={styles.heading}>{isEdit ? 'Edit credential' : 'Add credential'}</h1>
        <p className={styles.sub}>
          Reusable across hosts. Secrets go to the OS keychain — never to a config file, and never
          shown back to you.
        </p>

        {!snapshot.secrets.available && (
          <p className={styles.banner}>{snapshot.secrets.reason}</p>
        )}

        {field(
          'name',
          'Name',
          <input
            id="name"
            value={name}
            placeholder="Network admin"
            onChange={(event) => setName(event.target.value)}
          />,
        )}

        {field(
          'type',
          'Type',
          <select
            id="type"
            value={type}
            onChange={(event) => setType(event.target.value as 'password' | 'key')}
          >
            <option value="password">Password</option>
            <option value="key">SSH key</option>
          </select>,
        )}

        {field(
          'username',
          'Username',
          <input
            id="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />,
        )}

        {type === 'key' &&
          field(
            'keyPath',
            'Private key path',
            <input
              id="keyPath"
              value={keyPath}
              placeholder="~/.ssh/id_ed25519"
              onChange={(event) => setKeyPath(event.target.value)}
            />,
            'The key stays where it is — NS3H never copies key material.',
          )}

        {field(
          'secret',
          type === 'key' ? 'Passphrase' : 'Password',
          <SecretInput
            id="secret"
            value={secret}
            placeholder={isEdit ? 'Unchanged' : ''}
            onChange={setSecret}
          />,
          type === 'key' ? 'Leave blank if the key has no passphrase.' : undefined,
        )}

        <div className={styles.actions}>
          <button type="submit" className={styles.primary}>
            {isEdit ? 'Save changes' : 'Add credential'}
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => setView({ kind: 'quick' })}
          >
            Cancel
          </button>
          {isEdit && (
            <>
              <span className={styles.spacer} />
              <button
                type="button"
                className={styles.danger}
                onClick={() => {
                  const warning = inUse
                    ? ` ${inUse} host${inUse === 1 ? '' : 's'} using it will fall back to prompting.`
                    : '';
                  if (window.confirm(`Delete "${credential.name}"?${warning}`)) {
                    void deleteCredential(credential.id);
                    setView({ kind: 'quick' });
                  }
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
