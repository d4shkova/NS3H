import { useState } from 'react';
import type { Protocol, SshAuth } from '@shared/types.js';
import type { SerialConfig } from '@shared/config.js';
import { useSessions } from '@renderer/stores/sessions.js';
import { DEFAULT_SERIAL, SerialFields } from './SerialFields.js';
import styles from './ConnectForm.module.css';

type AuthMode = 'password' | 'key' | 'prompt';

const DEFAULT_PORT: Record<Protocol, string> = { ssh: '22', telnet: '23', serial: '' };

export function ConnectForm(): JSX.Element {
  const connect = useSessions((state) => state.connect);
  const connectTelnet = useSessions((state) => state.connectTelnet);
  const connectSerial = useSessions((state) => state.connectSerial);
  const [protocol, setProtocol] = useState<Protocol>('ssh');
  const [serial, setSerial] = useState<SerialConfig>(DEFAULT_SERIAL);
  const [address, setAddress] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [mode, setMode] = useState<AuthMode>('password');
  const [password, setPassword] = useState('');
  const [keyPath, setKeyPath] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);

  const changeProtocol = (next: Protocol) => {
    setProtocol(next);
    setError(null);
    if (DEFAULT_PORT[next]) setPort(DEFAULT_PORT[next]);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (protocol === 'serial') {
      if (!serial.path.trim()) return setError('Choose or type a port, e.g. /dev/ttyUSB0.');
      await connectSerial(serial.path.trim(), { ...serial, path: serial.path.trim() });
      return undefined;
    }

    if (!address.trim()) return setError('Enter an address.');
    const portNumber = Number(port);
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      return setError('Port must be between 1 and 65535.');
    }

    if (protocol === 'telnet') {
      // Telnet has no protocol-level auth; the device prompts in-band.
      await connectTelnet({ name: address.trim(), address: address.trim(), port: portNumber });
      return undefined;
    }

    if (!username.trim()) return setError('Enter a username.');
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
          {(['ssh', 'telnet', 'serial'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`${styles.toggleItem} ${protocol === option ? styles.toggleActive : ''}`}
              onClick={() => changeProtocol(option)}
            >
              {option === 'ssh' ? 'SSH' : option === 'telnet' ? 'Telnet' : 'Serial'}
            </button>
          ))}
        </div>

        {protocol === 'serial' && (
          <SerialFields value={serial} onChange={setSerial} idPrefix="quick-" />
        )}

        {protocol !== 'serial' && (
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
        )}

        {protocol === 'ssh' && (<>
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

        </>)}

        {error && <p className={styles.error}>{error}</p>}

        <button type="submit" className={styles.submit}>
          Connect
        </button>

        <p className={styles.note}>
          {protocol === 'ssh' &&
            'Keyboard-interactive prompts (TACACS+, RADIUS) appear inside the session pane. A failed credential re-prompts there rather than dropping the session.'}
          {protocol === 'telnet' &&
            'Telnet has no authentication of its own and no encryption — the device prompts in-band, and everything including your password crosses the network in clear text.'}
          {protocol === 'serial' &&
            'A console line has no carrier signal, so a blank screen is normal — press Enter. Send Break is in the session toolbar for password recovery.'}
        </p>
      </form>
    </div>
  );
}
