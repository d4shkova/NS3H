import { useState } from 'react';
import type { SshAuth } from '@shared/types.js';
import { useSessions } from '@renderer/stores/sessions.js';
import styles from './ConnectForm.module.css';

type AuthMode = 'password' | 'key' | 'prompt';

export function ConnectForm(): JSX.Element {
  const connect = useSessions((state) => state.connect);
  const [address, setAddress] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [mode, setMode] = useState<AuthMode>('password');
  const [password, setPassword] = useState('');
  const [keyPath, setKeyPath] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!address.trim()) return setError('Enter an address.');
    if (!username.trim()) return setError('Enter a username.');
    const portNumber = Number(port);
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      return setError('Port must be between 1 and 65535.');
    }
    if (mode === 'key' && !keyPath.trim()) return setError('Enter the path to a private key.');

    const auth: SshAuth =
      mode === 'key'
        ? { kind: 'key', username: username.trim(), keyPath: keyPath.trim(), passphrase }
        : mode === 'password'
          ? { kind: 'password', username: username.trim(), password }
          : { kind: 'prompt', username: username.trim() };

    try {
      await connect({ name: address.trim(), address: address.trim(), port: portNumber, auth });
      setPassword('');
      setPassphrase('');
    } catch (cause) {
      setError((cause as Error).message);
    }
    return undefined;
  };

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={submit}>
        <h1 className={styles.heading}>Quick connect</h1>
        <p className={styles.sub}>
          Nothing here is saved. NS3H offers every algorithm it has, in a fixed order — there is
          nothing to configure.
        </p>

        <div className={styles.toggle}>
          <button type="button" className={`${styles.toggleItem} ${styles.toggleActive}`}>
            SSH
          </button>
          <button type="button" className={styles.toggleItem} disabled title="Arrives in phase 5">
            Telnet
          </button>
          <button type="button" className={styles.toggleItem} disabled title="Arrives in phase 5">
            Serial
          </button>
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor="address">Address</label>
            <input
              id="address"
              value={address}
              placeholder="10.1.1.5"
              onChange={(event) => setAddress(event.target.value)}
            />
          </div>
          <div className={`${styles.field} ${styles.port}`}>
            <label htmlFor="port">Port</label>
            <input id="port" value={port} onChange={(event) => setPort(event.target.value)} />
          </div>
        </div>

        <div className={styles.field}>
          <label htmlFor="username">Username</label>
          <input
            id="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="mode">Authentication</label>
          <select
            id="mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as AuthMode)}
          >
            <option value="password">Password</option>
            <option value="key">SSH key</option>
            <option value="prompt">Ask me at connect time</option>
          </select>
        </div>

        {mode === 'password' && (
          <div className={styles.field}>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        )}

        {mode === 'key' && (
          <>
            <div className={styles.field}>
              <label htmlFor="keyPath">Private key path</label>
              <input
                id="keyPath"
                value={keyPath}
                placeholder="~/.ssh/id_ed25519"
                onChange={(event) => setKeyPath(event.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="passphrase">Passphrase (optional)</label>
              <input
                id="passphrase"
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
              />
            </div>
          </>
        )}

        {error && <p className={styles.error}>{error}</p>}

        <button type="submit" className={styles.submit}>
          Connect
        </button>

        <p className={styles.note}>
          Keyboard-interactive prompts (TACACS+, RADIUS) appear inside the session pane. A failed
          credential re-prompts there rather than dropping the session.
        </p>
      </form>
    </div>
  );
}
