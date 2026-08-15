import { useConfig } from '@renderer/stores/config.js';
import styles from './PasteConfirmModal.module.css';

interface Props {
  text: string;
  onRespond: (paste: boolean) => void;
}

const PREVIEW_LINES = 8;

/**
 * A multi-line paste into a live device executes every line as it arrives — there is
 * no undo on a router. So the lines are shown before they are sent.
 */
export function PasteConfirmModal({ text, onRespond }: Props): JSX.Element {
  const saveSettings = useConfig((state) => state.saveSettings);

  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const trailing = lines.length > 0 && lines.at(-1) === '' ? lines.slice(0, -1) : lines;
  const preview = trailing.slice(0, PREVIEW_LINES);
  const hidden = trailing.length - preview.length;

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <div className={styles.dialog}>
        <h2 className={styles.title}>
          Paste {trailing.length} lines into this session?
        </h2>
        <p className={styles.body}>
          Each line runs as it arrives. On a device with no commit model, that takes
          effect immediately.
        </p>

        <pre className={styles.preview}>
          {preview.join('\n')}
          {hidden > 0 && `\n… and ${hidden} more line${hidden === 1 ? '' : 's'}`}
        </pre>

        <label className={styles.suppress}>
          <input
            type="checkbox"
            onChange={(event) => {
              if (event.target.checked) void saveSettings({ pasteWarnMultiline: false });
            }}
          />
          Do not warn me again (changeable in Settings)
        </label>

        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={() => onRespond(false)}>
            Cancel
          </button>
          <button type="button" className={styles.confirm} onClick={() => onRespond(true)} autoFocus>
            Paste
          </button>
        </div>
      </div>
    </div>
  );
}
