import { useCallback, useEffect, useState } from 'react';
import type { LocalEntry, RemoteEntry, TransferEvent } from '@shared/transfer.js';
import { sourceIdFor, useTransfers, type TransferTab } from '@renderer/stores/transfers.js';
import styles from './TransferView.module.css';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * A remote side that cannot be listed is still usable: SCP has no listing operation, and
 * the `ls` NS3H falls back to does not exist on a switch. The pane then works from a path
 * the user types, which is how anyone moves a firmware image anyway.
 */
function isNotBrowsable(message: string): boolean {
  return /cannot list|not a directory listing/i.test(message);
}

/**
 * The dual pane for one open transfer: this computer on the left, the remote side on the
 * right. One of these per tab, and the tab is what remembers where it was — a pane is
 * remounted every time the user looks at another tab or another screen.
 */
export function TransferPane({ tab }: { tab: TransferTab }): JSX.Element {
  const patch = useTransfers((state) => state.patch);
  const sourceId = sourceIdFor(tab);

  const [local, setLocal] = useState<{ path: string; entries: LocalEntry[] }>({
    path: '',
    entries: [],
  });
  const [remote, setRemote] = useState<RemoteEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [manualPath, setManualPath] = useState('');
  const [transfers, setTransfers] = useState<TransferEvent[]>([]);
  /**
   * How many transfers are in flight, not whether one is. Dropping a second batch while
   * the first is still going is legitimate, and a plain boolean would let whichever
   * finished first re-enable the arrows under the one still running.
   */
  const [active, setActive] = useState(0);
  const busy = active > 0;
  const started = () => setActive((count) => count + 1);
  const finished = () => setActive((count) => count - 1);

  const loadLocal = useCallback(async (path: string) => {
    try {
      setLocal(await window.ns3h.transfer.localList(path));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, []);

  const loadRemote = useCallback(
    async (path: string) => {
      try {
        setRemote(await window.ns3h.transfer.remoteList(sourceId, path));
        patch(tab.key, { path, browsable: true });
        setError(null);
      } catch (cause) {
        const message = (cause as Error).message;
        if (isNotBrowsable(message)) {
          // Not a failure to report as one: the pane switches to typed paths, keeps the
          // path the user asked for, and both directions still work.
          setRemote([]);
          patch(tab.key, { path, browsable: false });
          setError(null);
          return;
        }
        setError(message);
      }
    },
    [sourceId, patch, tab.key],
  );

  useEffect(() => {
    void loadLocal('');
  }, [loadLocal]);

  // The tab remembers where it was; only a tab that has never been opened asks the far
  // end where to start.
  useEffect(() => {
    let current = true;

    if (tab.path) {
      void loadRemote(tab.path);
      return () => {
        current = false;
      };
    }

    void window.ns3h.transfer
      .remoteHome(sourceId)
      .then((home) => {
        if (current) void loadRemote(home);
      })
      .catch((cause: Error) => {
        if (current) setError(cause.message);
      });
    return () => {
      current = false;
    };
    // Deliberately keyed on the source alone: re-running this on every path change would
    // fight the user's own navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId]);

  useEffect(() => {
    return window.ns3h.transfer.onProgress((event) => {
      // Every pane hears every transfer; only its own belong on its strip.
      if (event.sessionId !== sourceId) return;
      setTransfers((current) => {
        const rest = current.filter((entry) => entry.id !== event.id);
        // Finished transfers linger briefly so the result is readable.
        return [...rest, event].slice(-4);
      });
      if (event.status === 'done') {
        void loadLocal(local.path);
        if (tab.path) void loadRemote(tab.path);
      }
    });
  }, [loadLocal, loadRemote, local.path, sourceId, tab.path]);

  const download = async (entry: RemoteEntry) => {
    started();
    setError(null);
    try {
      await window.ns3h.transfer.download(sourceId, entry.path, local.path);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      finished();
    }
  };

  /**
   * Sends files to whatever directory the remote pane is showing. One at a time: the
   * progress strip holds a handful of rows, and a device being handed four firmware
   * images at once is not faster for it.
   */
  const uploadPaths = async (paths: string[]) => {
    if (paths.length === 0 || !tab.path) return;
    started();
    setError(null);
    const failures: string[] = [];

    for (const path of paths) {
      try {
        await window.ns3h.transfer.upload(sourceId, path, tab.path);
      } catch (cause) {
        // One file failing does not cancel the rest — a folder among the dropped files
        // is the usual reason, and the others are still worth sending.
        failures.push(`${path.split(/[\\/]/).pop()}: ${(cause as Error).message}`);
      }
    }

    if (failures.length > 0) setError(failures.join('\n'));
    finished();
  };

  /**
   * A drop from outside the app. Electron 32 removed `File.path`, so the preload resolves
   * each one through `webUtils`; anything without a path on disk — dragged text, a URL,
   * an image from a web page — has nothing to send and says so.
   */
  const dropFiles = async (event: React.DragEvent) => {
    event.preventDefault();
    setDropping(false);

    const dropped = [...event.dataTransfer.files];
    if (dropped.length === 0) return;

    const paths = dropped.map((file) => window.ns3h.transfer.pathForFile(file)).filter(Boolean);
    if (paths.length === 0) {
      setError(
        'That drop carried no file from disk — dragged text, a link, or an image from a ' +
          'web page has nothing to upload. Drag a file from a file manager instead.',
      );
      return;
    }

    await uploadPaths(paths);
  };

  return (
    <>
      {error && (
        <p className={styles.error} onClick={() => setError(null)} role="alert">
          {error}
          {/* The failure the SFTP error was hiding: the device has no SFTP subsystem, but
              very likely does have an SCP server. */}
          {tab.kind === 'session' && /SFTP channel/i.test(error) && (
            <button
              type="button"
              className={styles.errorAction}
              onClick={(event) => {
                event.stopPropagation();
                patch(tab.key, { mode: 'scp', path: '', browsable: true });
              }}
            >
              Try SCP instead
            </button>
          )}
        </p>
      )}

      <div className={styles.panes}>
        <section className={styles.pane}>
          <header className={styles.paneHead}>
            <span className={styles.paneTitle}>This computer</span>
            <button
              type="button"
              onClick={async () => {
                const chosen = await window.ns3h.transfer.chooseDirectory();
                if (chosen) void loadLocal(chosen);
              }}
            >
              Change
            </button>
          </header>
          <div className={styles.path}>{local.path}</div>
          <div className={styles.list}>
            {local.entries.map((entry) => (
              <div
                key={entry.path}
                className={styles.row}
                onDoubleClick={() => entry.directory && void loadLocal(entry.path)}
              >
                <span className={styles.name}>
                  {entry.directory ? '▸ ' : '   '}
                  {entry.name}
                </span>
                <span className={styles.size}>{entry.directory ? '' : formatBytes(entry.size)}</span>
                {!entry.directory && (
                  <button
                    type="button"
                    className={styles.send}
                    disabled={busy}
                    title={`Upload to ${tab.path}`}
                    onClick={() => void uploadPaths([entry.path])}
                  >
                    →
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Dropping a file from the desktop uploads it to whatever directory is open
            here. `dragOver` must cancel the default for a drop to fire at all, and the
            containment check guards against the dragleave that fires when the pointer
            crosses from the pane onto a row inside it. */}
        <section
          className={`${styles.pane} ${dropping ? styles.dropping : ''}`}
          onDragOver={(event) => {
            if (!tab.path) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            if (!dropping) setDropping(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDropping(false);
            }
          }}
          onDrop={(event) => void dropFiles(event)}
        >
          <header className={styles.paneHead}>
            <span className={styles.paneTitle}>
              {tab.kind === 'standalone' ? 'Remote' : 'Device'}
            </span>
            <button
              type="button"
              disabled={!tab.browsable || !tab.path || tab.path === '/'}
              onClick={() => void loadRemote(tab.path.replace(/\/[^/]+\/?$/, '') || '/')}
            >
              Up
            </button>
          </header>
          <div className={styles.path}>{tab.path || '…'}</div>

          {dropping && (
            <div className={styles.dropHint} aria-hidden="true">
              Drop to upload to <code>{tab.path}</code>
            </div>
          )}

          {!tab.browsable && (
            <div className={styles.manual}>
              <p className={styles.manualNote}>
                This device cannot list a directory over SCP — there is no listing operation
                in the protocol, and it has no <code>ls</code>. Type where files should go,
                or the full path of one to fetch.
              </p>
              <form
                className={styles.manualRow}
                onSubmit={(event) => {
                  event.preventDefault();
                  const typed = manualPath.trim();
                  if (typed) patch(tab.key, { path: typed });
                }}
              >
                <input
                  value={manualPath}
                  placeholder="flash:  ·  /var/tmp  ·  bootflash:image.bin"
                  onChange={(event) => setManualPath(event.target.value)}
                />
                <button type="submit">Use</button>
              </form>
              <p className={styles.manualNote}>
                Uploads go to <code>{tab.path || '—'}</code>. To fetch a file, set that box to
                its full path and press Fetch.
              </p>
              <button
                type="button"
                className={styles.manualFetch}
                disabled={busy || !tab.path}
                onClick={() =>
                  void download({
                    name: tab.path.split(/[/:]/).pop() ?? tab.path,
                    path: tab.path,
                    directory: false,
                    symlink: false,
                    size: 0,
                    modified: '',
                    permissions: '',
                  })
                }
              >
                Fetch {tab.path || 'a file'}
              </button>
            </div>
          )}

          <div className={styles.list}>
            {remote.map((entry) => (
              <div
                key={entry.path}
                className={styles.row}
                onDoubleClick={() => entry.directory && void loadRemote(entry.path)}
              >
                {!entry.directory && (
                  <button
                    type="button"
                    className={styles.send}
                    disabled={busy}
                    title={`Download to ${local.path}`}
                    onClick={() => void download(entry)}
                  >
                    ←
                  </button>
                )}
                <span className={styles.name}>
                  {entry.directory ? '▸ ' : '   '}
                  {entry.name}
                </span>
                <span className={styles.perms}>{entry.permissions}</span>
                <span className={styles.size}>
                  {entry.directory ? '' : formatBytes(entry.size)}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {transfers.length > 0 && (
        <div className={styles.transfers}>
          {transfers.map((entry) => (
            <div key={entry.id} className={styles.transfer}>
              <span className={styles.transferName}>
                {entry.direction === 'download' ? '←' : '→'} {entry.name}
              </span>
              {entry.status === 'running' && (
                <span className={styles.progress}>
                  <span
                    className={styles.bar_}
                    style={{
                      width: `${entry.total ? Math.min(100, (entry.transferred / entry.total) * 100) : 0}%`,
                    }}
                  />
                </span>
              )}
              <span className={styles.transferState}>
                {entry.status === 'done'
                  ? 'done'
                  : entry.status === 'error'
                    ? (entry.detail ?? 'failed')
                    : `${formatBytes(entry.transferred)} / ${formatBytes(entry.total)}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
