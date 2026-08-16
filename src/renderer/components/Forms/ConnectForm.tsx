import { useState } from 'react';
import type { Protocol, SshAuth, SshTargetInput } from '@shared/types.js';
import type { SerialConfig } from '@shared/config.js';
import { useSessions } from '@renderer/stores/sessions.js';
import { useConfig } from '@renderer/stores/config.js';
import { DEFAULT_SERIAL, SerialFields } from './SerialFields.js';
import styles from './ConnectForm.module.css';
import { SecretInput } from './SecretInput.js';

type AuthMode = 'password' | 'key' | 'prompt';

const DEFAULT_PORT: Record<Protocol, string> = { ssh: '22', telnet: '23', serial: '' };

/** The "type it below" row of the credential picker, which is not a credential id. */
const TYPE_BELOW = '';

export function ConnectForm(): JSX.Element {
  const connect = useSessions((state) => state.connect);
  const connectTelnet = useSessions((state) => state.connectTelnet);
  const connectSerial = useSessions((state) => state.connectSerial);
  const [protocol, setProtocol] = useState<Protocol>('ssh');
  const [serial, setSerial] = useState<SerialConfig>(DEFAULT_SERIAL);
  const [address, setAddress] = useState('');
  const [port, setPort] = useState('22');
  const credentials = useConfig((state) => state.snapshot.credentials.credentials);
  const [credentialId, setCredentialId] = useState(TYPE_BELOW);
  const [username, setUsername] = useState('');
  const [mode, setMode] = useState<AuthMode>('password');
  const [password, setPassword] = useState('');
  const [keyPath, setKeyPath] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);

  const usingCredential = credentialId !== TYPE_BELOW;

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

    if (!usingCredential) {
      if (!username.trim()) return setError('Enter a username.');
      if (mode === 'key' && !keyPath.trim()) return setError('Enter the path to a private key.');
    }

    // A saved credential travels as its id: main resolves the username and the secret, so
    // neither is read here and neither has to be typed again.
    const auth: SshTargetInput['auth'] = usingCredential
      ? { kind: 'saved', credentialId }
      : ((mode === 'key'
          ? { kind: 'key', username: username.trim(), keyPath: keyPath.trim(), passphrase }
          : mode === 'password'
            ? { kind: 'password', username: username.trim(), password }
            : { kind: 'prompt', username: username.trim() }) satisfies SshAuth);

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
        {/* A saved credential is offered before the fields it replaces: re-typing a
            username and password that are already stored is the thing this avoids. */}
        {credentials.length > 0 && (
          <div className={styles.field}>
            <label htmlFor="credential">Credential</label>
            <select
              id="credential"
              value={credentialId}
              onChange={(event) => setCredentialId(event.target.value)}
            >
              <option value={TYPE_BELOW}>Type one below</option>
              {credentials.map((credential) => (
                <option key={credential.id} value={credential.id}>
                  {credential.name} ({credential.username})
                </option>
              ))}
            </select>
            {usingCredential && (
              <p className={styles.hint}>
                Its username and secret are read in the main process — the interface never
                sees them. The connection itself is still not saved.
              </p>
            )}
          </div>
        )}

        {!usingCredential && (<>
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
            <SecretInput id="password" value={password} onChange={setPassword} />
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
              <SecretInput id="passphrase" value={passphrase} onChange={setPassphrase} />
            </div>
          </>
        )}
        </>)}

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
