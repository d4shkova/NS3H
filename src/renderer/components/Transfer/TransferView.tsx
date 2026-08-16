import { useEffect, useRef, useState } from 'react';
import type { FileConnection } from '@shared/transfer.js';
import { useConfig } from '@renderer/stores/config.js';
import { useSessions } from '@renderer/stores/sessions.js';
import {
  sessionTab,
  standaloneTab,
  useTransfers,
  type TransferTab,
} from '@renderer/stores/transfers.js';
import { TransferConnectForm } from './TransferConnectForm.js';
import { TransferPane } from './TransferPane.js';
import styles from './TransferView.module.css';

/**
 * File transfer (§ phase 14): one tab per open transfer, the way sessions get one pane per
 * connection.
 *
 * Each tab is a live transfer — an SSH session's own channel, or a connection this pane
 * made itself — and every one of them is on screen, selectable, and closable. It replaced
 * a single dropdown, which could hold a connection that was open and paid for in the main
 * process while showing no sign of it: leaving the pane re-selected the session on the way
 * back, and nothing offered to close the other.
 */
export function TransferView(): JSX.Element {
  const setView = useConfig((state) => state.setView);
  const sessionTabs = useSessions((state) => state.tabs);
  const activeSessionId = useSessions((state) => state.activeId);

  const tabs = useTransfers((state) => state.tabs);
  const activeKey = useTransfers((state) => state.activeKey);
  const open = useTransfers((state) => state.open);
  const close = useTransfers((state) => state.close);
  const setActive = useTransfers((state) => state.setActive);
  const patch = useTransfers((state) => state.patch);
  const reconcile = useTransfers((state) => state.reconcile);

  const [connecting, setConnecting] = useState(false);
  const [ready, setReady] = useState(false);

  const sshSessions = sessionTabs.filter(
    (tab) => tab.protocol === 'ssh' && tab.status === 'connected',
  );

  /**
   * Square the tabs against what is really open, every time this screen appears. A
   * connection that survived in the main process but lost its tab is adopted here rather
   * than left unreachable, and a tab whose session or connection has gone is dropped.
   */
  useEffect(() => {
    let current = true;
    void window.ns3h.transfer
      .connections()
      .then((connections) => {
        if (!current) return;
        reconcile(
          connections,
          useSessions
            .getState()
            .tabs.filter((tab) => tab.protocol === 'ssh')
            .map((tab) => tab.id),
        );
      })
      .catch(() => {})
      .finally(() => current && setReady(true));
    return () => {
      current = false;
    };
  }, [reconcile]);

  /**
   * Arriving with nothing open and a session running opens that session's transfer — the
   * one-click path from a terminal to its files. It only fires once the real state is
   * known, so it cannot race the reconcile above and open a duplicate.
   *
   * Once per visit, and no more: without the latch, closing the last tab drops the count
   * back to zero and this immediately opens it again, which makes the close button on a
   * lone session tab do nothing at all.
   */
  const autoOpened = useRef(false);

  useEffect(() => {
    if (!ready || autoOpened.current || tabs.length > 0 || sshSessions.length === 0) return;
    autoOpened.current = true;
    const chosen =
      sshSessions.find((session) => session.id === activeSessionId) ?? sshSessions[0];
    open(sessionTab(chosen.id, `${chosen.name} (${chosen.address})`));
  }, [ready, tabs.length, sshSessions, activeSessionId, open]);

  const closeTab = async (tab: TransferTab) => {
    // A standalone connection is this pane's to end; a session's channel belongs to the
    // session and goes when it does.
    if (tab.kind === 'standalone') {
      await window.ns3h.transfer.disconnect(tab.key).catch(() => {});
    }
    close(tab.key);
  };

  const connected = (connection: FileConnection) => {
    open(standaloneTab(connection));
    setConnecting(false);
  };

  /** Back to the sessions if there are any, and to the home screen if there are not. */
  const leave = () => setView({ kind: sessionTabs.length > 0 ? 'sessions' : 'home' });

  const active = tabs.find((tab) => tab.key === activeKey) ?? null;
  const showForm = connecting || tabs.length === 0;

  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        <button type="button" className={styles.back} onClick={leave}>
          {sessionTabs.length > 0 ? '← Session' : '← Home'}
        </button>
        <h1 className={styles.heading}>File transfer</h1>

        <div className={styles.tabs} role="tablist" aria-label="Open transfers">
          {tabs.map((tab) => (
            <div
              key={tab.key}
              className={`${styles.tab} ${tab.key === activeKey && !connecting ? styles.tabOn : ''}`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab.key === activeKey && !connecting}
                className={styles.tabName}
                onClick={() => {
                  setActive(tab.key);
                  setConnecting(false);
                }}
                title={tab.label}
              >
                <span className={styles.tabProtocol}>
                  {(tab.kind === 'session' ? tab.mode : tab.protocol).toUpperCase()}
                </span>
                {tab.label}
              </button>
              <button
                type="button"
                className={styles.tabClose}
                title={
                  tab.kind === 'standalone'
                    ? 'Disconnect and close'
                    : 'Close — the session itself keeps running'
                }
                onClick={() => void closeTab(tab)}
              >
                ✕
              </button>
            </div>
          ))}

          <button
            type="button"
            className={`${styles.tab} ${styles.tabAdd} ${connecting ? styles.tabOn : ''}`}
            title="Open another transfer"
            onClick={() => setConnecting(true)}
          >
            ＋
          </button>
        </div>

        {/* A session can carry either, and which one works is the device's decision — so
            the choice is one click away rather than a reconnect. */}
        {active?.kind === 'session' && !connecting && (
          <span className={styles.modes} role="radiogroup" aria-label="Transfer protocol">
            {(['sftp', 'scp'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={active.mode === mode}
                className={`${styles.mode} ${active.mode === mode ? styles.modeOn : ''}`}
                onClick={() => patch(active.key, { mode, path: '', browsable: true })}
              >
                {mode.toUpperCase()}
              </button>
            ))}
          </span>
        )}
      </div>

      {showForm ? (
        <div className={styles.formHost}>
          <TransferConnectForm
            onConnected={connected}
            onCancel={tabs.length > 0 ? () => setConnecting(false) : null}
            openSessions={sshSessions
              .filter((session) => !tabs.some((tab) => tab.key === session.id))
              .map((session) => ({
                id: session.id,
                label: `${session.name} (${session.address})`,
              }))}
            onUseSession={(session) => {
              open(sessionTab(session.id, session.label));
              setConnecting(false);
            }}
          />
        </div>
      ) : (
        // Keyed on the tab: each gets its own pane state, and switching tabs does not
        // hand one tab's listing to another.
        active && <TransferPane key={active.key} tab={active} />
      )}
    </div>
  );
}
