import { useState } from 'react';
import type { Host, SerialConfig } from '@shared/config.js';
import type { Protocol } from '@shared/types.js';
import { useConfig } from '@renderer/stores/config.js';
import styles from './form.module.css';

interface Props {
  host: Host | null;
}

const PROTOCOLS: { value: Protocol; label: string; note?: string }[] = [
  { value: 'ssh', label: 'SSH' },
  { value: 'telnet', label: 'Telnet', note: 'Saved now, connects in phase 5' },
  { value: 'serial', label: 'Serial', note: 'Saved now, connects in phase 5' },
];

const BAUD_RATES = [2400, 4800, 9600, 19200, 38400, 57600, 115200];

const DEFAULT_SERIAL: SerialConfig = {
  path: '',
  baudRate: 9600,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  flowControl: 'none',
};

const NEW_CREDENTIAL = '__inline__';

export function HostForm({ host }: Props): JSX.Element {
  const snapshot = useConfig((state) => state.snapshot);
  const saveHost = useConfig((state) => state.saveHost);
  const deleteHost = useConfig((state) => state.deleteHost);
  const setView = useConfig((state) => state.setView);

  const [name, setName] = useState(host?.name ?? '');
  const [protocol, setProtocol] = useState<Protocol>(host?.protocol ?? 'ssh');
  const [folderId, setFolderId] = useState(host?.folderId ?? '');
  const [address, setAddress] = useState(host?.address ?? '');
  const [port, setPort] = useState(String(host?.port ?? 22));
  const [credentialId, setCredentialId] = useState(
    host?.inlineCredential ? NEW_CREDENTIAL : (host?.credentialId ?? ''),
  );
  const [inlineType, setInlineType] = useState<'password' | 'key'>(
    host?.inlineCredential?.type ?? 'password',
  );
  const [inlineUser, setInlineUser] = useState(host?.inlineCredential?.username ?? '');
  const [inlineKeyPath, setInlineKeyPath] = useState(host?.inlineCredential?.keyPath ?? '');
  const [secret, setSecret] = useState('');
  const [logging, setLogging] = useState(host?.logging ?? true);
  const [serial, setSerial] = useState<SerialConfig>(host?.serial ?? DEFAULT_SERIAL);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isEdit = host !== null;
  const usesInline = credentialId === NEW_CREDENTIAL;
  const needsAddress = protocol === 'ssh' || protocol === 'telnet';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const found: Record<string, string> = {};

    if (!name.trim()) found.name = 'Give this device a name.';
    if (needsAddress && !address.trim()) found.address = 'Enter an address.';
    if (needsAddress) {
      const portNumber = Number(port);
      if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
        found.port = 'Port must be between 1 and 65535.';
      }
    }
    if (protocol === 'serial' && !serial.path.trim()) {
      found.serialPath = 'Choose or type a port, e.g. /dev/ttyUSB0.';
    }
    if (usesInline && !inlineUser.trim()) found.inlineUser = 'Enter a username.';
    if (usesInline && inlineType === 'key' && !inlineKeyPath.trim()) {
      found.inlineKeyPath = 'Enter the path to a private key.';
    }

    setErrors(found);
    if (Object.keys(found).length > 0) return;

    await saveHost(
      {
        id: host?.id ?? '',
        name: name.trim(),
        protocol,
        folderId: folderId || null,
        address: needsAddress ? address.trim() : null,
        port: needsAddress ? Number(port) : null,
        credentialId: usesInline ? null : credentialId || null,
        inlineCredential: usesInline
          ? {
              type: inlineType,
              username: inlineUser.trim(),
              keyPath: inlineType === 'key' ? inlineKeyPath.trim() : null,
              hasPassphrase: inlineType === 'key' && secret.length > 0,
            }
          : null,
        logging,
        serial: protocol === 'serial' ? { ...serial, path: serial.path.trim() } : null,
        createdAt: host?.createdAt ?? new Date().toISOString(),
      },
      // An untouched secret field means "unchanged" (§6.3).
      usesInline && secret ? { [inlineType === 'key' ? 'passphrase' : 'password']: secret } : undefined,
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

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={submit}>
        <h1 className={styles.heading}>{isEdit ? 'Edit host' : 'Add host'}</h1>
        <p className={styles.sub}>
          {isEdit
            ? 'Renaming a host keeps its trust and its existing logs where they are.'
            : 'Saved hosts appear in the sidebar. Double-click one to connect.'}
        </p>

        {field(
          'name',
          'Friendly name',
          <input
            id="name"
            value={name}
            placeholder="core-sw-01"
            onChange={(event) => setName(event.target.value)}
          />,
        )}

        {field(
          'protocol',
          'Protocol',
          <select
            id="protocol"
            value={protocol}
            onChange={(event) => setProtocol(event.target.value as Protocol)}
          >
            {PROTOCOLS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>,
          PROTOCOLS.find((option) => option.value === protocol)?.note,
        )}

        {field(
          'folder',
          'Folder',
          <select
            id="folder"
            value={folderId}
            onChange={(event) => setFolderId(event.target.value)}
          >
            <option value="">No folder</option>
            {snapshot.hosts.folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>,
        )}

        {needsAddress && (
          <div className={styles.row}>
            {field(
              'address',
              'Address',
              <input
                id="address"
                value={address}
                placeholder="10.1.1.5"
                onChange={(event) => setAddress(event.target.value)}
              />,
            )}
            <div className={styles.narrow}>
              {field(
                'port',
                'Port',
                <input id="port" value={port} onChange={(event) => setPort(event.target.value)} />,
              )}
            </div>
          </div>
        )}

        {protocol === 'serial' && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Serial</div>
            {field(
              'serialPath',
              'Port',
              <input
                id="serialPath"
                value={serial.path}
                placeholder="/dev/ttyUSB0"
                onChange={(event) => setSerial({ ...serial, path: event.target.value })}
              />,
              'Port enumeration with manufacturer names arrives in phase 5.',
            )}
            <div className={styles.row}>
              {field(
                'baud',
                'Baud',
                <select
                  id="baud"
                  value={serial.baudRate}
                  onChange={(event) =>
                    setSerial({ ...serial, baudRate: Number(event.target.value) })
                  }
                >
                  {BAUD_RATES.map((rate) => (
                    <option key={rate} value={rate}>
                      {rate}
                    </option>
                  ))}
                </select>,
              )}
              {field(
                'dataBits',
                'Data bits',
                <select
                  id="dataBits"
                  value={serial.dataBits}
                  onChange={(event) =>
                    setSerial({ ...serial, dataBits: Number(event.target.value) as 7 | 8 })
                  }
                >
                  <option value={8}>8</option>
                  <option value={7}>7</option>
                </select>,
              )}
            </div>
            <div className={styles.row}>
              {field(
                'parity',
                'Parity',
                <select
                  id="parity"
                  value={serial.parity}
                  onChange={(event) =>
                    setSerial({ ...serial, parity: event.target.value as SerialConfig['parity'] })
                  }
                >
                  <option value="none">none</option>
                  <option value="even">even</option>
                  <option value="odd">odd</option>
                </select>,
              )}
              {field(
                'stopBits',
                'Stop bits',
                <select
                  id="stopBits"
                  value={serial.stopBits}
                  onChange={(event) =>
                    setSerial({ ...serial, stopBits: Number(event.target.value) as 1 | 2 })
                  }
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>,
              )}
              {field(
                'flowControl',
                'Flow control',
                <select
                  id="flowControl"
                  value={serial.flowControl}
                  onChange={(event) =>
                    setSerial({
                      ...serial,
                      flowControl: event.target.value as SerialConfig['flowControl'],
                    })
                  }
                >
                  <option value="none">none</option>
                  <option value="rtscts">RTS/CTS</option>
                  <option value="xonxoff">XON/XOFF</option>
                </select>,
              )}
            </div>
          </div>
        )}

        {protocol !== 'serial' && (
          <>
            {field(
              'credential',
              'Credential',
              <select
                id="credential"
                value={credentialId}
                onChange={(event) => setCredentialId(event.target.value)}
              >
                <option value="">Ask me at connect time</option>
                {snapshot.credentials.credentials.map((credential) => (
                  <option key={credential.id} value={credential.id}>
                    {credential.name} ({credential.type})
                  </option>
                ))}
                <option value={NEW_CREDENTIAL}>Specify for this device</option>
              </select>,
            )}

            {usesInline && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Credential for this device</div>
                {field(
                  'inlineType',
                  'Type',
                  <select
                    id="inlineType"
                    value={inlineType}
                    onChange={(event) => setInlineType(event.target.value as 'password' | 'key')}
                  >
                    <option value="password">Password</option>
                    <option value="key">SSH key</option>
                  </select>,
                )}
                {field(
                  'inlineUser',
                  'Username',
                  <input
                    id="inlineUser"
                    value={inlineUser}
                    onChange={(event) => setInlineUser(event.target.value)}
                  />,
                )}
                {inlineType === 'key' &&
                  field(
                    'inlineKeyPath',
                    'Private key path',
                    <input
                      id="inlineKeyPath"
                      value={inlineKeyPath}
                      placeholder="~/.ssh/id_ed25519"
                      onChange={(event) => setInlineKeyPath(event.target.value)}
                    />,
                    'The key stays where it is — NS3H never copies key material.',
                  )}
                {field(
                  'secret',
                  inlineType === 'key' ? 'Passphrase' : 'Password',
                  <input
                    id="secret"
                    type="password"
                    value={secret}
                    placeholder={isEdit ? 'Unchanged' : ''}
                    onChange={(event) => setSecret(event.target.value)}
                  />,
                  snapshot.secrets.available
                    ? undefined
                    : 'No keychain available — this will not be stored, and the session will prompt.',
                )}
              </div>
            )}
          </>
        )}

        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            checked={logging}
            onChange={(event) => setLogging(event.target.checked)}
          />
          Log all sessions with this device
        </label>

        <div className={styles.actions}>
          <button type="submit" className={styles.primary}>
            {isEdit ? 'Save changes' : 'Add host'}
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
                  if (window.confirm(`Delete "${host.name}"? Its logs are kept.`)) {
                    void deleteHost(host.id);
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
