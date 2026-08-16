import { useState } from 'react';
import { useSessions } from '@renderer/stores/sessions.js';
import { useConfig } from '@renderer/stores/config.js';
import { sessionTab, useTransfers } from '@renderer/stores/transfers.js';
import { terminals } from '@renderer/terminals/registry.js';
import { SecretInput } from '../Forms/SecretInput.js';
import styles from './SessionOverlays.module.css';

/**
 * Controls that belong to the focused session rather than to a pane.
 *
 * Panes are dockview's now — a session's terminal can be dragged into a split at any
 * moment — so anything that would have to move with it lives here instead, anchored to
 * the session area and acting on whichever session is active.
 */
export function SessionOverlays({ showToolbar }: { showToolbar: boolean }): JSX.Element | null {
  const tabs = useSessions((state) => state.tabs);
  const activeId = useSessions((state) => state.activeId);
  const prompt = useSessions((state) => (activeId ? state.authPrompts[activeId] : undefined));
  const setAuthPrompt = useSessions((state) => state.setAuthPrompt);
  const sendBreak = useSessions((state) => state.sendBreak);
  const setView = useConfig((state) => state.setView);
  const [breaking, setBreaking] = useState(false);

  const tab = tabs.find((entry) => entry.id === activeId) ?? null;
  if (!tab) return null;

  return (
    <>
      {showToolbar && (
      <div className={styles.toolbar}>
        {tab.protocol === 'serial' && (
          <button
            type="button"
            className={styles.button}
            disabled={breaking || tab.status !== 'connected'}
            title="Assert break for 250 ms — used for Cisco password recovery"
            onClick={async () => {
              setBreaking(true);
              try {
                await sendBreak(tab.id);
              } finally {
                setBreaking(false);
              }
            }}
          >
            {breaking ? 'Sending…' : 'Send break'}
          </button>
        )}
        {tab.protocol === 'ssh' && (
          <button
            type="button"
            className={styles.button}
            title="Transfer files over this session"
            onClick={() => {
              // Opens this session's transfer, or focuses the tab it already has, so the
              // button always lands on the right one rather than on whatever was last
              // looked at.
              useTransfers.getState().open(sessionTab(tab.id, `${tab.name} (${tab.address})`));
              setView({ kind: 'transfer' });
            }}
          >
            Files
          </button>
        )}
        <button
          type="button"
          className={styles.button}
          title="Clear the screen"
          onClick={() => terminals.get(tab.id)?.terminal.clear()}
        >
          Clear
        </button>
      </div>
      )}

      {prompt && (
        <AuthPromptForm
          key={prompt.id}
          title={prompt.title}
          instructions={prompt.instructions}
          fields={prompt.fields}
          onSubmit={(values) => {
            void window.ns3h.auth.respond(prompt.id, values);
            setAuthPrompt(tab.id, null);
          }}
          onCancel={() => {
            void window.ns3h.auth.respond(prompt.id, null);
            setAuthPrompt(tab.id, null);
          }}
        />
      )}
    </>
  );
}

interface AuthFormProps {
  title: string;
  instructions?: string;
  fields: { key: string; label: string; echo: boolean }[];
  onSubmit: (values: string[]) => void;
  onCancel: () => void;
}

function AuthPromptForm({
  title,
  instructions,
  fields,
  onSubmit,
  onCancel,
}: AuthFormProps): JSX.Element {
  const [values, setValues] = useState<string[]>(() => fields.map(() => ''));

  return (
    <form
      className={styles.prompt}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(values);
      }}
    >
      <div className={styles.promptTitle}>{title}</div>
      {instructions && <div className={styles.promptInstructions}>{instructions}</div>}
      {fields.map((field, index) => (
        <div key={field.key} className={styles.field}>
          <label htmlFor={`${field.key}-${index}`}>{field.label}</label>
          {/* A masked prompt gets the reveal; one the device asked to echo is not a
              secret and stays a plain field. */}
          {field.echo ? (
            <input
              id={`${field.key}-${index}`}
              type="text"
              autoFocus={index === 0}
              value={values[index]}
              onChange={(event) =>
                setValues((current) =>
                  current.map((value, position) =>
                    position === index ? event.target.value : value,
                  ),
                )
              }
            />
          ) : (
            <SecretInput
              id={`${field.key}-${index}`}
              autoFocus={index === 0}
              value={values[index]}
              onChange={(next) =>
                setValues((current) =>
                  current.map((value, position) => (position === index ? next : value)),
                )
              }
            />
          )}
        </div>
      ))}
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={styles.primary}>
          Authenticate
        </button>
      </div>
    </form>
  );
}
