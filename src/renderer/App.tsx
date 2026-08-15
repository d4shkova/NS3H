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
import { StatusBar } from './components/StatusBar/StatusBar.js';
import { terminals } from './terminals/registry.js';
import { applyTheme } from './theme/apply.js';
import { ansi, toCrlf } from './components/Terminal/theme.js';
import styles from './App.module.css';

const MIN_SIDEBAR = 15;
const MAX_SIDEBAR = 35;

export function App(): JSX.Element {
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
    void window.ns3h.platform().then(({ platform }) => setIsMac(platform === 'darwin'));
    void loadConfig();

    // The registry asks the app whether a multi-line paste should go ahead; the
    // preference is read at paste time so a change in Settings takes effect at once.
    terminals.configure({
      confirmPaste: (text) => usePaste.getState().request(text),
      warnOnMultilinePaste: () => useConfig.getState().snapshot.settings.pasteWarnMultiline,
    });
  }, [loadConfig]);

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
    applyTheme(themeId);
  }, [themeId]);

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
  const showForm = view.kind !== 'sessions';

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
                {view.kind === 'home' && <HomeView />}
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

          <SessionOverlays />
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
