import { useEffect, useId, useRef, useState } from 'react';
import styles from './SecretInput.module.css';

/** How long a revealed secret stays on screen before it masks itself again. */
const REVEAL_MS = 15_000;

interface Props {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  /** Marks the field when a form has flagged it. */
  invalid?: boolean;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * A password field that can be read.
 *
 * Every secret in this app is typed blind, which is how a wrong character gets saved to a
 * device's credential and stays wrong. The eye shows it; the second button copies it,
 * because a masked field cannot be copied from at all — Chromium blocks it, so revealing
 * is the only way to get a password back out of one.
 *
 * It re-masks itself after fifteen seconds. A password left legible on a screen in an
 * office is the failure this is guarding against, and nobody remembers to click twice.
 */
export function SecretInput({
  id,
  value,
  onChange,
  placeholder,
  required,
  autoFocus,
  invalid,
  onKeyDown,
}: Props): JSX.Element {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const generated = useId();
  const inputId = id ?? generated;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!shown) return undefined;
    timer.current = setTimeout(() => setShown(false), REVEAL_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [shown]);

  // A field that is emptied or replaced should not stay revealed from a previous value.
  useEffect(() => {
    if (value === '') setShown(false);
  }, [value]);

  const copy = async () => {
    if (!value) return;
    await window.ns3h.clipboard.write(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={`${styles.wrap} ${invalid ? styles.invalid : ''}`}>
      <input
        id={inputId}
        className={styles.input}
        type={shown ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />

      <button
        type="button"
        className={styles.action}
        aria-pressed={shown}
        aria-controls={inputId}
        title={shown ? 'Hide' : 'Show — hides itself again after 15 seconds'}
        aria-label={shown ? 'Hide the secret' : 'Show the secret'}
        // Buttons inside a form default to submitting; these must not.
        onClick={() => setShown((current) => !current)}
      >
        {shown ? EyeOff : Eye}
      </button>

      <button
        type="button"
        className={styles.action}
        disabled={!value}
        title={value ? 'Copy to the clipboard' : 'Nothing to copy yet'}
        aria-label="Copy the secret to the clipboard"
        onClick={() => void copy()}
      >
        {copied ? <span className={styles.copied}>✓</span> : Copy}
      </button>
    </div>
  );
}

/* Inline so the icons carry the theme's currentColor and need no asset pipeline. */
const Eye = (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none">
    <path
      d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8Z"
      stroke="currentColor"
      strokeWidth="1.3"
    />
    <circle cx="8" cy="8" r="1.9" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

const EyeOff = (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none">
    <path
      d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8Z"
      stroke="currentColor"
      strokeWidth="1.3"
    />
    <circle cx="8" cy="8" r="1.9" stroke="currentColor" strokeWidth="1.3" />
    <path d="M3 13 13 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

const Copy = (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none">
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    <path
      d="M10.5 3.5a1.5 1.5 0 0 0-1.5-1.5H4a1.5 1.5 0 0 0-1.5 1.5V9A1.5 1.5 0 0 0 4 10.5"
      stroke="currentColor"
      strokeWidth="1.3"
    />
  </svg>
);
