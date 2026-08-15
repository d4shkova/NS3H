import { useEffect, useState } from 'react';
import type { SerialConfig } from '@shared/config.js';
import type { SerialPortInfo } from '@shared/types.js';
import styles from './form.module.css';

export const BAUD_RATES = [2400, 4800, 9600, 19200, 38400, 57600, 115200];

export const DEFAULT_SERIAL: SerialConfig = {
  path: '',
  baudRate: 9600,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  flowControl: 'none',
};

interface Props {
  value: SerialConfig;
  onChange: (config: SerialConfig) => void;
  error?: string;
  idPrefix?: string;
}

/**
 * The serial block from §3.6, shared by Quick connect and the host form.
 *
 * The port list is re-enumerated every time this mounts and on demand, because USB
 * adapters get plugged in mid-session. Free text is always allowed — the list is a
 * convenience, not a constraint.
 */
export function SerialFields({ value, onChange, error, idPrefix = '' }: Props): JSX.Element {
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      setPorts(await window.ns3h.serial.list());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const id = (name: string) => `${idPrefix}${name}`;

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Serial</div>

      <div className={`${styles.field} ${error ? styles.errored : ''}`}>
        <label htmlFor={id('serialPath')}>Port</label>
        <div className={styles.row}>
          <select
            id={id('serialPath')}
            value={ports.some((port) => port.path === value.path) ? value.path : ''}
            onChange={(event) => onChange({ ...value, path: event.target.value })}
          >
            <option value="">
              {loading
                ? 'Looking for ports…'
                : ports.length === 0
                  ? 'No ports detected — type one below'
                  : 'Choose a port'}
            </option>
            {ports.map((port) => (
              <option key={port.path} value={port.path}>
                {port.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void refresh()}
            title="Adapters get plugged in mid-session"
          >
            Refresh
          </button>
        </div>
        <input
          className={styles.freeText}
          value={value.path}
          placeholder="/dev/ttyUSB0"
          aria-label="Serial port path"
          onChange={(event) => onChange({ ...value, path: event.target.value })}
        />
        {error ? (
          <p className={styles.fieldError}>{error}</p>
        ) : (
          <p className={styles.hint}>Pick a detected port, or type a path directly.</p>
        )}
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor={id('baud')}>Baud</label>
          <select
            id={id('baud')}
            value={value.baudRate}
            onChange={(event) => onChange({ ...value, baudRate: Number(event.target.value) })}
          >
            {BAUD_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={id('dataBits')}>Data bits</label>
          <select
            id={id('dataBits')}
            value={value.dataBits}
            onChange={(event) =>
              onChange({ ...value, dataBits: Number(event.target.value) as 7 | 8 })
            }
          >
            <option value={8}>8</option>
            <option value={7}>7</option>
          </select>
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor={id('parity')}>Parity</label>
          <select
            id={id('parity')}
            value={value.parity}
            onChange={(event) =>
              onChange({ ...value, parity: event.target.value as SerialConfig['parity'] })
            }
          >
            <option value="none">none</option>
            <option value="even">even</option>
            <option value="odd">odd</option>
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={id('stopBits')}>Stop bits</label>
          <select
            id={id('stopBits')}
            value={value.stopBits}
            onChange={(event) =>
              onChange({ ...value, stopBits: Number(event.target.value) as 1 | 2 })
            }
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={id('flowControl')}>Flow control</label>
          <select
            id={id('flowControl')}
            value={value.flowControl}
            onChange={(event) =>
              onChange({
                ...value,
                flowControl: event.target.value as SerialConfig['flowControl'],
              })
            }
          >
            <option value="none">none</option>
            <option value="rtscts">RTS/CTS</option>
            <option value="xonxoff">XON/XOFF</option>
          </select>
        </div>
      </div>
    </div>
  );
}
