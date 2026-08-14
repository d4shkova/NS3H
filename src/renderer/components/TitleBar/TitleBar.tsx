import styles from './TitleBar.module.css';

interface Props {
  isMac: boolean;
}

/**
 * macOS gets `hiddenInset` chrome with room for the traffic lights; Windows and
 * Linux get a matching custom bar so the app reads the same everywhere (§6.1).
 */
export function TitleBar({ isMac }: Props): JSX.Element {
  return (
    <div className={`${styles.bar} ${isMac ? styles.mac : ''}`}>
      <span className={styles.title}>NS3H</span>
      {!isMac && (
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.control}
            aria-label="Minimize"
            onClick={() => void window.ns3h.window.minimize()}
          >
            &#x2013;
          </button>
          <button
            type="button"
            className={styles.control}
            aria-label="Maximize"
            onClick={() => void window.ns3h.window.toggleMaximize()}
          >
            &#x25a1;
          </button>
          <button
            type="button"
            className={`${styles.control} ${styles.close}`}
            aria-label="Close"
            onClick={() => void window.ns3h.window.close()}
          >
            &#x2715;
          </button>
        </div>
      )}
    </div>
  );
}
