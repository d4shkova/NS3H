import type { HostKeyPromptRequest } from '@shared/types.js';
import styles from './HostKeyModal.module.css';

interface Props {
  request: HostKeyPromptRequest;
  onRespond: (accepted: boolean) => void;
}

export function HostKeyModal({ request, onRespond }: Props): JSX.Element {
  const changed = Boolean(request.previous);

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <div className={styles.dialog}>
        <h2 className={`${styles.title} ${changed ? styles.changed : ''}`}>
          {changed ? 'Host key has changed' : 'Unknown host key'}
        </h2>

        {changed ? (
          <p className={styles.body}>
            The key presented by <strong>{request.address}</strong> is not the one NS3H accepted on{' '}
            {formatDate(request.previous!.acceptedAt)}. This is expected after an RMA or an OS
            upgrade — it is also exactly what a man-in-the-middle looks like. Accept only if you
            know why the key changed.
          </p>
        ) : (
          <p className={styles.body}>
            NS3H has not connected to <strong>{request.address}</strong> before. Check the
            fingerprint against the device console before accepting.
          </p>
        )}

        <div className={styles.keys}>
          {request.previous && (
            <div className={styles.key}>
              <div className={styles.keyLabel}>Previously accepted · {request.previous.keyType}</div>
              <div className={styles.fingerprint}>{request.previous.fingerprint}</div>
            </div>
          )}
          <div className={`${styles.key} ${changed ? styles.new : ''}`}>
            <div className={styles.keyLabel}>
              {changed ? 'Now offered' : 'Offered'} · {request.keyType} ·{' '}
              {request.address}:{request.port}
            </div>
            <div className={styles.fingerprint}>{request.fingerprint}</div>
          </div>
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.reject} onClick={() => onRespond(false)}>
            Reject
          </button>
          <button type="button" className={styles.accept} onClick={() => onRespond(true)}>
            {changed ? 'Accept new key' : 'Accept and connect'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}
