import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessions } from './stores/sessions.js';
import { TitleBar } from './components/TitleBar/TitleBar.js';
import { Sidebar } from './components/Sidebar/Sidebar.js';
import { ConnectForm } from './components/Forms/ConnectForm.js';
import { HostForm } from './components/Forms/HostForm.js';
import { CredentialForm } from './components/Forms/CredentialForm.js';
import { useConfig } from './stores/config.js';
import { TerminalPane } from './components/Terminal/TerminalPane.js';
import { HostKeyModal } from './components/Modals/HostKeyModal.js';
import { StatusBar } from './components/StatusBar/StatusBar.js';
import styles from './App.module.css';

const MIN_SIDEBAR = 15;
const MAX_SIDEBAR = 35;

export function App(): JSX.Element {
  const [isMac, setIsMac] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(20);
  const dragging = useRef(false);

  const tabs = useSessions((state) => state.tabs);
  const activeId = useSessions((state) => state.activeId);
  const setActive = useSessions((state) => state.setActive);
  const closeTab = useSessions((state) => state.closeTab);
  const hostKeyPrompt = useSessions((state) => state.hostKeyPrompt);
  const setHostKeyPrompt = useSessions((state) => state.setHostKeyPrompt);
  const setAuthPrompt = useSessions((state) => state.setAuthPrompt);
  const connectError = useSessions((state) => state.connectError);
  const clearConnectError = useSessions((state) => state.clearConnectError);
  const view = useConfig((state) => state.view);
  const loadConfig = useConfig((state) => state.load);

  useEffect(() => {
    void window.ns3h.platform().then(({ platform }) => setIsMac(platform === 'darwin'));
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    const offHostKey = window.ns3h.hostKey.onPrompt(setHostKeyPrompt);
    const offAuth = window.ns3h.auth.onPrompt((request) =>
      setAuthPrompt(request.sessionId, request),
    );
    return () => {
      offHostKey();
      offAuth();
    };
  }, [setHostKeyPrompt, setAuthPrompt]);

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

  return (
    <div className={styles.app}>
      <TitleBar isMac={isMac} />
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
          <div className={styles.tabs}>
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`${styles.tab} ${tab.id === activeId ? styles.tabActive : ''}`}
                onClick={() => setActive(tab.id)}
                onKeyDown={(event) => event.key === 'Enter' && setActive(tab.id)}
                role="tab"
                tabIndex={0}
                aria-selected={tab.id === activeId}
              >
                <span className={`${styles.tabDot} ${styles[tab.status] ?? ''}`} />
                {tab.name}
                <button
                  type="button"
                  className={styles.tabClose}
                  aria-label={`Close ${tab.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className={styles.newTab}
              aria-label="New connection"
              onClick={() => setActive('')}
            >
              +
            </button>
          </div>

          <div className={styles.panes}>
            {tabs.map((tab) => (
              <TerminalPane key={tab.id} tab={tab} active={tab.id === activeId} />
            ))}
            {!activeTab && (
              <>
                {connectError && (
                  <p className={styles.connectError} role="alert" onClick={clearConnectError}>
                    {connectError}
                  </p>
                )}
                {view.kind === 'quick' && <ConnectForm />}
                {view.kind === 'host-form' && <HostForm key={view.host?.id ?? 'new'} host={view.host} />}
                {view.kind === 'credential-form' && (
                  <CredentialForm
                    key={view.credential?.id ?? 'new'}
                    credential={view.credential}
                  />
                )}
              </>
            )}
          </div>
        </main>
      </div>

      <StatusBar tab={activeTab} />

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
