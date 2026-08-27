import { useEffect, useState } from 'react';
import styles from './FileMenu.module.css';

export interface FileDialogState {
  title: string;
  body?: string;
  /** Absent for a plain confirmation — deleting asks nothing, it only warns. */
  input?: {
    label: string;
    value: string;
    placeholder?: string;
    hint?: string;
    /** Why the typed value cannot be used, or null. Checked as the user types. */
    validate?: (value: string) => string | null;
  };
  confirmLabel: string;
  danger?: boolean;
  /** Rejecting keeps the dialog open with the failure shown inside it. */
  onConfirm: (value: string) => Promise<void>;
}

/**
 * The one dialog behind every menu item that needs an answer: rename, new folder,
 * permissions, and the delete confirmation.
 *
 * The failure is shown in here rather than on the pane's error strip, because the answer
 * that caused it is still on screen and usually only needs a word changed — a name that
 * is taken, a directory that is not empty.
 */
export function FileDialog({
  dialog,
  onClose,
}: {
  dialog: FileDialogState;
  onClose: () => void;
}): JSX.Element {
  const [value, setValue] = useState(dialog.input?.value ?? '');
  const [failure, setFailure] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const problem = dialog.input?.validate?.(value) ?? null;

  // On the window rather than on the dialog: the backdrop is a plain div and takes no
  // focus, so a key pressed before anything inside has been clicked would go nowhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (problem || working) return;
    setWorking(true);
    setFailure(null);
    try {
      await dialog.onConfirm(value.trim());
      onClose();
    } catch (cause) {
      setFailure((cause as Error).message);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <form
        className={styles.dialog}
        onSubmit={(event) => void submit(event)}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className={styles.dialogTitle}>{dialog.title}</h2>
        {dialog.body && <p className={styles.dialogBody}>{dialog.body}</p>}

        {dialog.input && (
          <label className={styles.field}>
            <span>{dialog.input.label}</span>
            <input
              value={value}
              autoFocus
              spellCheck={false}
              placeholder={dialog.input.placeholder}
              onChange={(event) => setValue(event.target.value)}
            />
            {dialog.input.hint && <small className={styles.fieldHint}>{dialog.input.hint}</small>}
          </label>
        )}

        {/* Only once something has been typed: a box that opens already complaining is
            telling the user off for not having started. */}
        {problem && value !== (dialog.input?.value ?? '') && (
          <p className={styles.dialogProblem}>{problem}</p>
        )}
        {failure && <p className={styles.dialogFailure}>{failure}</p>}

        <div className={styles.dialogActions}>
          <button type="button" className={styles.cancel} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={dialog.danger ? styles.confirmDanger : styles.confirm}
            disabled={problem !== null || working}
            autoFocus={!dialog.input}
          >
            {working ? 'Working…' : dialog.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
