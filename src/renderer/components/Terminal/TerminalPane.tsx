import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { useSessions, type SessionTab } from '@renderer/stores/sessions.js';
import { ansi, toCrlf, xtermTheme } from './theme.js';
import styles from './TerminalPane.module.css';

interface Props {
  tab: SessionTab;
  active: boolean;
}

export function TerminalPane({ tab, active }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const prompt = useSessions((state) => state.authPrompts[tab.id]);
  const setAuthPrompt = useSessions((state) => state.setAuthPrompt);
  const applyStatus = useSessions((state) => state.applyStatus);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Cascadia Mono', monospace",
      fontSize: 13,
      scrollback: 10000,
      cursorBlink: true,
      allowProposedApi: true,
      theme: xtermTheme,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new SearchAddon());
    term.open(host);

    try {
      // §2 — the WebGL renderer is required; large dumps chug without it.
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      term.writeln(ansi.warn('WebGL renderer unavailable — falling back to the DOM renderer.'));
    }

    termRef.current = term;
    fitRef.current = fit;
    fit.fit();
    void window.ns3h.session.resize(tab.id, term.cols, term.rows);

    const typing = term.onData((data) => void window.ns3h.session.write(tab.id, data));

    const offData = window.ns3h.session.onData((event) => {
      if (event.sessionId === tab.id) term.write(event.data);
    });

    const offNotice = window.ns3h.session.onNotice((event) => {
      if (event.sessionId !== tab.id) return;
      const paint = event.level === 'error' ? ansi.error : event.level === 'warn' ? ansi.warn : ansi.info;
      term.writeln(paint(toCrlf(event.text)));
    });

    const offStatus = window.ns3h.session.onStatus((event) => {
      if (event.sessionId !== tab.id) return;
      const summary = event.negotiation
        ? `${event.negotiation.kex} · ${event.negotiation.cipher} · ${event.negotiation.mac}`
        : undefined;
      applyStatus(tab.id, event.status, event.detail, summary);
      if (event.status === 'connected' && summary) {
        term.writeln(ansi.ok(`Connected — ${summary}`));
      }
      if (event.detail && (event.status === 'error' || event.status === 'closed')) {
        const paint = event.status === 'error' ? ansi.error : ansi.info;
        term.writeln('');
        term.writeln(paint(toCrlf(event.detail)));
      }
    });

    const observer = new ResizeObserver(() => {
      if (!hostRef.current?.isConnected || hostRef.current.clientWidth === 0) return;
      fit.fit();
      void window.ns3h.session.resize(tab.id, term.cols, term.rows);
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      typing.dispose();
      offData();
      offNotice();
      offStatus();
      term.dispose();
      termRef.current = null;
    };
  }, [tab.id, applyStatus]);

  useEffect(() => {
    if (active) {
      fitRef.current?.fit();
      termRef.current?.focus();
    }
  }, [active]);

  return (
    <div className={`${styles.pane} ${active ? '' : styles.hidden}`}>
      <div ref={hostRef} className={styles.surface} />
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
    </div>
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
          <input
            id={`${field.key}-${index}`}
            type={field.echo ? 'text' : 'password'}
            autoFocus={index === 0}
            value={values[index]}
            onChange={(event) =>
              setValues((current) =>
                current.map((value, position) => (position === index ? event.target.value : value)),
              )
            }
          />
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
