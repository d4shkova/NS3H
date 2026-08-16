import { useEffect, useState } from 'react';
import { useConfig } from '@renderer/stores/config.js';
import styles from './HomeView.module.css';

interface Card {
  key: string;
  icon: string;
  title: string;
  description: string;
  detail: (counts: Counts) => string;
  onOpen?: () => void;
  disabled?: boolean;
}

interface Counts {
  hosts: number;
  folders: number;
  credentials: number;
  logFolders: number;
  logSessions: number;
}

/** The landing screen: everything the app does, one click away. */
export function HomeView(): JSX.Element {
  const snapshot = useConfig((state) => state.snapshot);
  const setView = useConfig((state) => state.setView);
  const [logCounts, setLogCounts] = useState({ folders: 0, sessions: 0 });

  useEffect(() => {
    void window.ns3h.logs
      .folders()
      .then((folders) =>
        setLogCounts({
          folders: folders.length,
          sessions: folders.reduce((total, folder) => total + folder.sessions, 0),
        }),
      )
      .catch(() => setLogCounts({ folders: 0, sessions: 0 }));
  }, [snapshot.settings.logDirectory]);

  const counts: Counts = {
    hosts: snapshot.hosts.hosts.length,
    folders: snapshot.hosts.folders.length,
    credentials: snapshot.credentials.credentials.length,
    logFolders: logCounts.folders,
    logSessions: logCounts.sessions,
  };

  const cards: Card[] = [
    {
      key: 'quick',
      icon: '⚡',
      title: 'Quick connect',
      description: 'Connect to something once, without saving it.',
      detail: () => 'SSH, telnet, or serial',
      onOpen: () => setView({ kind: 'quick' }),
    },
    {
      key: 'hosts',
      icon: '▤',
      title: 'Hosts',
      description: 'Saved devices, with their credentials and folders.',
      detail: (c) =>
        c.hosts === 0
          ? 'Nothing saved yet'
          : `${c.hosts} host${c.hosts === 1 ? '' : 's'}` +
            (c.folders ? ` in ${c.folders} folder${c.folders === 1 ? '' : 's'}` : ''),
      onOpen: () => setView({ kind: 'hosts' }),
    },
    {
      key: 'credentials',
      icon: '⚿',
      title: 'Credentials',
      description: 'Reusable logins, with secrets held by the OS keychain.',
      detail: (c) =>
        c.credentials === 0 ? 'None yet' : `${c.credentials} saved`,
      onOpen: () => setView({ kind: 'credentials' }),
    },
    {
      key: 'logs',
      icon: '≡',
      title: 'Logs',
      description: 'Every session, written to disk and cleaned for reading.',
      detail: (c) =>
        !snapshot.settings.logDirectory
          ? 'No log directory chosen'
          : c.logSessions === 0
            ? 'No sessions recorded yet'
            : `${c.logSessions} session${c.logSessions === 1 ? '' : 's'} across ${c.logFolders} device${c.logFolders === 1 ? '' : 's'}`,
      onOpen: () => setView({ kind: 'logs' }),
    },
    {
      key: 'transfer',
      icon: '⇅',
      title: 'File transfer',
      description: 'Move files to and from a device or a file server.',
      detail: () => 'SFTP, SCP, or SMB — an open session, or its own connection',
      onOpen: () => setView({ kind: 'transfer' }),
    },
  ];

  return (
    <div className={styles.wrap}>
      <div className={styles.inner}>
        <h1 className={styles.heading}>NS3H</h1>
        <p className={styles.sub}>
          Connects to anything — modern hosts, ancient switches, console cables — and logs
          every session.
        </p>

        <div className={styles.grid}>
          {cards.map((card) => (
            <button
              key={card.key}
              type="button"
              className={`${styles.card} ${card.disabled ? styles.disabled : ''}`}
              disabled={card.disabled}
              onClick={card.onOpen}
            >
              <span className={styles.icon} aria-hidden="true">
                {card.icon}
              </span>
              <span className={styles.title}>{card.title}</span>
              <span className={styles.description}>{card.description}</span>
              <span className={styles.detail}>{card.detail(counts)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
