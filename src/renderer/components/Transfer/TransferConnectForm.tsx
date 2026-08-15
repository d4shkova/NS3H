import { useState } from 'react';
import type { FileConnection, FileProtocol, FileTargetInput } from '@shared/transfer.js';
import { useConfig } from '@renderer/stores/config.js';
import styles from './TransferConnectForm.module.css';

const DEFAULT_PORT: Record<FileProtocol, number> = { sftp: 22, scp: 22, smb: 445 };

const PROTOCOLS: { key: FileProtocol; name: string; note: string }[] = [
  { key: 'sftp', name: 'SFTP', note: 'Over SSH — servers and most modern gear' },
  { key: 'scp', name: 'SCP', note: 'Over SSH — switches and routers with no SFTP' },
  { key: 'smb', name: 'SMB', note: 'Windows and Samba shares (SMB2)' },
];

export interface OpenSession {
  id: string;
  label: string;
}

interface Props {
  onConnected: (connection: FileConnection) => void;
  onCancel: (() => void) | null;
  /** SSH sessions that are up and do not already have a transfer tab. */
  openSessions?: OpenSession[];
  onUseSession?: (session: OpenSession) => void;
}

/**
 * A transfer target with no terminal session behind it (§ phase 12).
 *
 * Nothing here is saved: the target is used for this connection and forgotten, the way
 * Quick connect works. A password can come from a saved credential instead of being
 * typed — the secret is resolved in main, so the field below is the only place a typed
 * one exists, and the renderer never receives a stored one.
 */
export function TransferConnectForm({
  onConnected,
  onCancel,
  openSessions = [],
  onUseSession,
}: Props): JSX.Element {
  const credentials = useConfig((state) => state.snapshot.credentials.credentials);

  const [protocol, setProtocol] = useState<FileProtocol>('sftp');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(DEFAULT_PORT.sftp);
  const [portTouched, setPortTouched] = useState(false);
  const [credentialId, setCredentialId] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [keyPath, setKeyPath] = useState('');
  const [share, setShare] = useState('');
  const [domain, setDomain] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usingCredential = credentialId !== '';
  // A key-based credential cannot authenticate to SMB, which is NTLM.
  const overSsh = protocol === 'sftp' || protocol === 'scp';
  const usable = credentials.filter(
    (credential) => overSsh || credential.type === 'password',
  );

  const switchProtocol = (next: FileProtocol) => {
    setProtocol(next);
    // The port follows the protocol until the user sets one of their own.
    if (!portTouched) setPort(DEFAULT_PORT[next]);
    if (next === 'smb' && usingCredential) {
      const chosen = credentials.find((credential) => credential.id === credentialId);
      if (chosen?.type === 'key') setCredentialId('');
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const target: FileTargetInput = {
      protocol,
      host: host.trim(),
      port,
      username: username.trim(),
      ...(usingCredential ? { credentialId } : {}),
      ...(!usingCredential && password ? { password } : {}),
      ...(!usingCredential && overSsh && keyPath.trim()
        ? { keyPath: keyPath.trim() }
        : {}),
      ...(protocol === 'smb' ? { share: share.trim(), domain: domain.trim() } : {}),
    };

    try {
      onConnected(await window.ns3h.transfer.connect(target));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)}>
      <div className={styles.head}>
        <h2 className={styles.heading}>Connect to a file server</h2>
        <p className={styles.sub}>
          No CLI session needed. SFTP and SCP open their own SSH connection — same
          algorithm ladder and host-key check a terminal session gets. SMB attaches a
          Windows or Samba share. Nothing here is saved.
        </p>
      </div>

      {/* Transferring over a session that is already authenticated costs no second
          login, so it is offered before the form rather than buried behind it. */}
      {openSessions.length > 0 && onUseSession && (
        <div className={styles.sessions}>
          <p className={styles.sessionsTitle}>Use a session that is already open</p>
          {openSessions.map((session) => (
            <button
              key={session.id}
              type="button"
              className={styles.session}
              onClick={() => onUseSession(session)}
            >
              {session.label}
              <span className={styles.sessionNote}>no second login</span>
            </button>
          ))}
          <p className={styles.sessionsOr}>or connect to something new</p>
        </div>
      )}

      <div className={styles.protocols} role="radiogroup" aria-label="Protocol">
        {PROTOCOLS.map((option) => (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={protocol === option.key}
            className={`${styles.protocol} ${protocol === option.key ? styles.chosen : ''}`}
            onClick={() => switchProtocol(option.key)}
          >
            <span className={styles.protocolName}>{option.name}</span>
            <span className={styles.protocolNote}>{option.note}</span>
          </button>
        ))}
      </div>

      {protocol === 'scp' && (
        <p className={styles.note}>
          SCP moves files but cannot list a directory — there is no listing operation in the
          protocol. NS3H runs <code>ls</code> to fill the right-hand pane, which works on
          anything POSIX; a switch has no <code>ls</code>, so the pane falls back to a path
          you type. Uploads and downloads work either way.
        </p>
      )}

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="transfer-host">{protocol === 'smb' ? 'Server' : 'Address'}</label>
          <input
            id="transfer-host"
            required
            autoFocus
            value={host}
            placeholder={protocol === 'smb' ? 'fileserver' : '10.1.1.5'}
            onChange={(event) => setHost(event.target.value)}
          />
        </div>
        <div className={`${styles.field} ${styles.narrow}`}>
          <label htmlFor="transfer-port">Port</label>
          <input
            id="transfer-port"
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(event) => {
              setPortTouched(true);
              setPort(Number(event.target.value));
            }}
          />
        </div>
      </div>

      {protocol === 'smb' && (
        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor="transfer-share">Share</label>
            <input
              id="transfer-share"
              required
              value={share}
              placeholder="images"
              onChange={(event) => setShare(event.target.value)}
            />
            <p className={styles.hint}>
              The share name only — the part after the host in <code>\\{host || 'server'}\…</code>,
              not a path inside it.
            </p>
          </div>
          <div className={styles.field}>
            <label htmlFor="transfer-domain">Domain</label>
            <input
              id="transfer-domain"
              value={domain}
              placeholder="WORKGROUP"
              onChange={(event) => setDomain(event.target.value)}
            />
          </div>
        </div>
      )}

      {credentials.length > 0 && (
        <div className={styles.field}>
          <label htmlFor="transfer-credential">Credential</label>
          <select
            id="transfer-credential"
            value={credentialId}
            onChange={(event) => setCredentialId(event.target.value)}
          >
            <option value="">Type one below</option>
            {usable.map((credential) => (
              <option key={credential.id} value={credential.id}>
                {credential.name} ({credential.username})
              </option>
            ))}
          </select>
          {usingCredential && (
            <p className={styles.hint}>
              Its username and secret are read in the main process — the interface never
              sees them.
            </p>
          )}
        </div>
      )}

      {!usingCredential && (
        <>
          <div className={styles.row}>
            <div className={styles.field}>
              <label htmlFor="transfer-username">Username</label>
              <input
                id="transfer-username"
                required
                value={username}
                autoComplete="off"
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="transfer-password">Password</label>
              <input
                id="transfer-password"
                type="password"
                value={password}
                autoComplete="off"
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          </div>

          {overSsh && (
            <div className={styles.field}>
              <label htmlFor="transfer-key">Private key</label>
              <input
                id="transfer-key"
                value={keyPath}
                placeholder="~/.ssh/id_ed25519 — leave empty to use the password"
                onChange={(event) => setKeyPath(event.target.value)}
              />
              <p className={styles.hint}>
                The key is read at connect time and never copied. A passphrase is asked for
                when the key needs one.
              </p>
            </div>
          )}
        </>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.actions}>
        {onCancel && (
          <button type="button" className={styles.secondary} onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className={styles.primary} disabled={busy}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </div>
    </form>
  );
}
