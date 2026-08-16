import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessions } from './stores/sessions.js';
import { TitleBar } from './components/TitleBar/TitleBar.js';
import { Sidebar } from './components/Sidebar/Sidebar.js';
import { ConnectForm } from './components/Forms/ConnectForm.js';
import { HostForm } from './components/Forms/HostForm.js';
import { CredentialForm } from './components/Forms/CredentialForm.js';
import { SettingsView } from './components/Settings/SettingsView.js';
import { HomeView } from './components/Home/HomeView.js';
import { HostsList } from './components/Lists/HostsList.js';
import { CredentialsList } from './components/Lists/CredentialsList.js';
import { LogsList } from './components/Lists/LogsList.js';
import { LogViewer } from './components/Lists/LogViewer.js';
import { TransferView } from './components/Transfer/TransferView.js';
import { useConfig } from './stores/config.js';
import { SessionDock } from './components/Terminal/SessionDock.js';
import { SessionOverlays } from './components/Terminal/SessionOverlays.js';
import { HostKeyModal } from './components/Modals/HostKeyModal.js';
import { PasteConfirmModal } from './components/Modals/PasteConfirmModal.js';
import { usePaste } from './stores/paste.js';
import { paneLayout } from './stores/pane.js';
import { LockScreen } from './components/Lock/LockScreen.js';
import { StatusBar } from './components/StatusBar/StatusBar.js';
import { terminals } from './terminals/registry.js';
import { applyTheme } from './theme/apply.js';
import { ansi, toCrlf } from './components/Terminal/theme.js';
import styles from './App.module.css';

const MIN_SIDEBAR = 15;
const MAX_SIDEBAR = 35;

export function App(): JSX.Element {
  /**
   * Null until main has been asked. Nothing is rendered in the meantime — a flash of the
   * app before the lock appears would show the host list to someone who has not got in.
   */
  const [locked, setLocked] = useState<boolean | null>(null);
  const [isMac, setIsMac] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(20);
  const dragging = useRef(false);

  const tabs = useSessions((state) => state.tabs);
  const activeId = useSessions((state) => state.activeId);
  const hostKeyPrompt = useSessions((state) => state.hostKeyPrompt);
  const setHostKeyPrompt = useSessions((state) => state.setHostKeyPrompt);
  const setAuthPrompt = useSessions((state) => state.setAuthPrompt);
  const applyStatus = useSessions((state) => state.applyStatus);
  const setLogPath = useSessions((state) => state.setLogPath);
  const connectError = useSessions((state) => state.connectError);
  const clearConnectError = useSessions((state) => state.clearConnectError);
  const view = useConfig((state) => state.view);
  const setView = useConfig((state) => state.setView);
  const loadConfig = useConfig((state) => state.load);
  const configLoaded = useConfig((state) => state.loaded);
  const logDirectory = useConfig((state) => state.snapshot.settings.logDirectory);
  const themeId = useConfig((state) => state.snapshot.settings.theme);
  const pendingPaste = usePaste((state) => state.pending);

  useEffect(() => {
    void window.ns3h.lock
      .status()
      .then((status) => {
        setLocked(status.locked);
        // The lock screen is themed from main's answer: settings are not readable yet.
        if (status.locked) applyTheme(status.theme);
      })
      .catch(() => setLocked(false));
  }, []);

  useEffect(() => {
    if (locked !== false) return;
    void window.ns3h.platform().then(({ platform }) => setIsMac(platform === 'darwin'));
    void loadConfig();

    // The registry asks the app whether a multi-line paste should go ahead; the
    // preference is read at paste time so a change in Settings takes effect at once.
    terminals.configure({
      confirmPaste: (text) => usePaste.getState().request(text),
      warnOnMultilinePaste: () => useConfig.getState().snapshot.settings.pasteWarnMultiline,
    });
  }, [loadConfig, locked]);

  useEffect(() => {
    const offHostKey = window.ns3h.hostKey.onPrompt(setHostKeyPrompt);
    const offAuth = window.ns3h.auth.onPrompt((request) => {
      setAuthPrompt(request.sessionId, request);
      // A prompt on a backgrounded session would otherwise wait unseen.
      useSessions.getState().setActive(request.sessionId);
      useConfig.getState().setView({ kind: 'sessions' });
    });

    // Session-wide, not per-pane: a session keeps its state while its pane is being
    // dragged between groups, or while a form covers the dock entirely.
    const offStatus = window.ns3h.session.onStatus((event) => {
      const summary = event.negotiation
        ? `${event.negotiation.kex} · ${event.negotiation.cipher} · ${event.negotiation.mac}`
        : undefined;
      // Read before applying: applyStatus writes the summary, so checking afterwards
      // would always look like the banner had already been printed.
      const previous = useSessions.getState().tabs.find((tab) => tab.id === event.sessionId);
      const alreadyAnnounced = Boolean(previous?.negotiationSummary);

      applyStatus(event.sessionId, event.status, event.detail, summary, event.logPath);

      // A closing session emits a final status after its tab has gone. Writing that
      // would build a terminal for a pane that no longer exists — it would never be
      // attached, and never disposed of.
      if (!useSessions.getState().tabs.some((tab) => tab.id === event.sessionId)) return;

      if (event.status === 'connected' && summary && !alreadyAnnounced) {
        terminals.write(event.sessionId, ansi.ok(`Connected — ${summary}`));
      }
      if (event.detail && (event.status === 'error' || event.status === 'closed')) {
        const paint = event.status === 'error' ? ansi.error : ansi.info;
        terminals.write(event.sessionId, '');
        terminals.write(event.sessionId, paint(toCrlf(event.detail)));
      }
    });

    const offLog = window.ns3h.session.onLog((event) =>
      setLogPath(event.sessionId, event.logPath),
    );

    return () => {
      offHostKey();
      offAuth();
      offStatus();
      offLog();
    };
  }, [setHostKeyPrompt, setAuthPrompt, applyStatus, setLogPath]);

  useEffect(() => {
    if (locked === false) applyTheme(themeId);
  }, [themeId, locked]);

  /**
   * A file dropped anywhere that is not a drop target makes Chromium navigate to it —
   * the window is replaced by the file's contents, with no way back and every session
   * still running behind it. The transfer pane cancels these events for its own drops;
   * this catches everything else.
   */
  useEffect(() => {
    const swallow = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      // Both events have to be cancelled: without `dragover`, the drop is never
      // dispatched to the page at all and the navigation just happens.
      event.preventDefault();
      // Captured, so this runs before the drop targets — which then set `copy` over
      // themselves, leaving the rest of the window showing "no drop" rather than
      // promising something it will not do.
      if (event.type === 'dragover') event.dataTransfer.dropEffect = 'none';
    };
    window.addEventListener('dragover', swallow, { capture: true });
    window.addEventListener('drop', swallow, { capture: true });
    return () => {
      window.removeEventListener('dragover', swallow, { capture: true });
      window.removeEventListener('drop', swallow, { capture: true });
    };
  }, []);

  const onDragMove = useCallback((event: MouseEvent) => {
    if (!dragging.current) return;
    const percent = (event.clientX / window.innerWidth) * 100;
    setSidebarWidth(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, percent)));
  }, []);

  useEffect(() => {
    const stop = () => {
      dragging.current = false;
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', stop);
    return () => {
      window.removeEventListener('mousemove', onDragMove);
      window.removeEventListener('mouseup', stop);
    };
  }, [onDragMove]);

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null;
  /**
   * A form takes over the main pane even while a session is open — the session keeps
   * running in its tab (and, from phase 4, keeps logging), and clicking the tab
   * returns to it.
   */
  const { showDock, showHome } = paneLayout(view, tabs.length);
  const showForm = !showDock;

  // Nothing of the app exists for the renderer until main says it is open.
  if (locked === null) return <div className={styles.app} />;
  if (locked) return <LockScreen onUnlocked={() => setLocked(false)} />;

  return (
    <div className={styles.app}>
      <TitleBar isMac={isMac} onOpenSettings={() => setView({ kind: 'settings' })} />
      {/* §4.3 — first run has no log directory; say so loudly rather than silently not logging. */}
      {configLoaded && !logDirectory && view.kind !== 'settings' && (
        <div className={styles.logBanner}>
          <span>
            Sessions are <strong>not being logged</strong> — no log directory has been chosen yet.
          </span>
          <button type="button" onClick={() => setView({ kind: 'settings' })}>
            Choose a directory
          </button>
        </div>
      )}

      <div className={styles.body}>
        <div style={{ width: `${sidebarWidth}%`, display: 'flex', minWidth: 0 }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
            <Sidebar />
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            style={{ width: 4, cursor: 'col-resize' }}
            onMouseDown={() => {
              dragging.current = true;
              document.body.style.cursor = 'col-resize';
            }}
          />
        </div>

        <main className={styles.main}>
          <div className={styles.panes}>
            <div className={showForm ? styles.hidden : styles.dockHost}>
              <SessionDock />
            </div>

            {showForm && (
              <>
                {/* Full-pane views carry their own navigation, so the floating
                    control would land on top of their header. */}
                {tabs.length > 0 && view.kind !== 'log-viewer' && view.kind !== 'transfer' && (
                  <div className={styles.backBar}>
                    <button type="button" onClick={() => setView({ kind: 'sessions' })}>
                      ← Back to {tabs.length} session{tabs.length === 1 ? '' : 's'}
                    </button>
                  </div>
                )}
                {connectError && (
                  <p className={styles.connectError} role="alert" onClick={clearConnectError}>
                    {connectError}
                  </p>
                )}
                {showHome && <HomeView />}
                {view.kind === 'quick' && <ConnectForm />}
                {view.kind === 'hosts' && <HostsList />}
                {view.kind === 'credentials' && <CredentialsList />}
                {view.kind === 'logs' && <LogsList />}
                {view.kind === 'transfer' && <TransferView />}
                {view.kind === 'log-viewer' && (
                  <LogViewer key={view.path} path={view.path} title={view.title} />
                )}
                {view.kind === 'settings' && <SettingsView />}
                {view.kind === 'host-form' && (
                  <HostForm key={view.host?.id ?? 'new'} host={view.host} />
                )}
                {view.kind === 'credential-form' && (
                  <CredentialForm key={view.credential?.id ?? 'new'} credential={view.credential} />
                )}
              </>
            )}
          </div>

          {/* Send break, Files, Clear act on the active terminal, so they belong to the
              dock and not over whatever else is using the pane. The prompt inside stays
              mounted either way — a session waiting on a password must not be silenced
              by navigating elsewhere. */}
          <SessionOverlays showToolbar={showDock} />
        </main>
      </div>

      <StatusBar tab={activeTab} />

      {pendingPaste && (
        <PasteConfirmModal
          text={pendingPaste.text}
          onRespond={(paste) => usePaste.getState().respond(paste)}
        />
      )}

      {hostKeyPrompt && (
        <HostKeyModal
          request={hostKeyPrompt}
          onRespond={(accepted) => {
            void window.ns3h.hostKey.respond(hostKeyPrompt.id, accepted);
            setHostKeyPrompt(null);
          }}
        />
      )}
    </div>
  );
}
