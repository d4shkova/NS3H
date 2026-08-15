import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LogDocument, LogMatch } from '@shared/logs.js';
import { useConfig } from '@renderer/stores/config.js';
import styles from './LogViewer.module.css';

const LINE_HEIGHT = 18;
/** Lines fetched either side of the viewport, so scrolling does not flicker. */
const OVERSCAN = 40;

interface Props {
  path: string;
  title: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Read-only viewer for a session log (§6.3).
 *
 * Virtualised: main splits the file into lines and this asks only for the window in
 * view, so a 50 MB `show tech-support` costs a few hundred rendered rows rather than
 * half a million DOM nodes.
 */
export function LogViewer({ path, title }: Props): JSX.Element {
  const setView = useConfig((state) => state.setView);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const [document_, setDocument] = useState<LogDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [window_, setWindow] = useState({ start: 0, lines: [] as string[] });
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);

  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<LogMatch[]>([]);
  const [matchIndex, setMatchIndex] = useState(0);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDocument(null);
    setError(null);
    void window.ns3h.logs
      .open(path)
      .then((doc) => !cancelled && setDocument(doc))
      .catch((cause: Error) => !cancelled && setError(cause.message));

    return () => {
      cancelled = true;
      void window.ns3h.logs.close(path);
    };
  }, [path]);

  const visible = useMemo(() => {
    const first = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
    const count = Math.ceil(height / LINE_HEIGHT) + OVERSCAN * 2;
    return { first, count };
  }, [scrollTop, height]);

  // Fetch the window whenever it moves past what is already loaded.
  useEffect(() => {
    if (!document_) return;
    const { first, count } = visible;
    const loadedEnd = window_.start + window_.lines.length;
    if (window_.lines.length > 0 && first >= window_.start && first + count <= loadedEnd) return;

    let cancelled = false;
    void window.ns3h.logs.lines(path, first, count).then((lines) => {
      if (!cancelled) setWindow({ start: first, lines });
    });
    return () => {
      cancelled = true;
    };
  }, [document_, path, visible, window_.start, window_.lines.length]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    setHeight(element.clientHeight);
    return () => observer.disconnect();
  }, [document_]);

  const runSearch = useCallback(async () => {
    if (!query.trim()) {
      setMatches([]);
      return;
    }
    setSearching(true);
    try {
      const found = await window.ns3h.logs.search(path, query);
      setMatches(found);
      setMatchIndex(0);
      if (found.length > 0) scrollToLine(found[0].line);
    } finally {
      setSearching(false);
    }
  }, [path, query]);

  const scrollToLine = (line: number) => {
    const element = scrollRef.current;
    if (!element) return;
    // A third of the way down reads better than pinned to the top edge.
    element.scrollTop = Math.max(0, line * LINE_HEIGHT - element.clientHeight / 3);
  };

  const step = (delta: number) => {
    if (matches.length === 0) return;
    const next = (matchIndex + delta + matches.length) % matches.length;
    setMatchIndex(next);
    scrollToLine(matches[next].line);
  };

  // Cmd/Ctrl+F focuses search, as §6.3 asks.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, []);

  const matchedLines = useMemo(() => new Set(matches.map((match) => match.line)), [matches]);
  const currentLine = matches[matchIndex]?.line ?? -1;

  if (error) {
    return (
      <div className={styles.wrap}>
        <div className={styles.header}>
          <button type="button" className={styles.back} onClick={() => setView({ kind: 'logs' })}>
            ← Logs
          </button>
        </div>
        <p className={styles.error}>{error}</p>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <button type="button" className={styles.back} onClick={() => setView({ kind: 'logs' })}>
          ← Logs
        </button>
        <span className={styles.title}>{title}</span>
        <span className={styles.meta}>
          {document_
            ? `${document_.lineCount.toLocaleString()} lines · ${formatBytes(document_.bytes)}`
            : 'Opening…'}
        </span>

        <form
          className={styles.search}
          onSubmit={(event) => {
            event.preventDefault();
            if (matches.length > 0) step(1);
            else void runSearch();
          }}
        >
          <input
            ref={searchRef}
            value={query}
            placeholder="Find (Ctrl+F)"
            onChange={(event) => {
              setQuery(event.target.value);
              setMatches([]);
            }}
          />
          <span className={styles.count}>
            {searching
              ? '…'
              : matches.length > 0
                ? `${matchIndex + 1}/${matches.length}`
                : query.trim()
                  ? '0'
                  : ''}
          </span>
          <button type="button" onClick={() => step(-1)} disabled={matches.length === 0}>
            ↑
          </button>
          <button type="button" onClick={() => step(1)} disabled={matches.length === 0}>
            ↓
          </button>
        </form>

        <button
          type="button"
          className={styles.reveal}
          onClick={() => void window.ns3h.shell.reveal(path)}
        >
          Reveal
        </button>
      </div>

      <div
        ref={scrollRef}
        className={styles.scroll}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div style={{ height: (document_?.lineCount ?? 0) * LINE_HEIGHT, position: 'relative' }}>
          {window_.lines.map((line, offset) => {
            const number = window_.start + offset;
            return (
              <div
                key={number}
                className={`${styles.line} ${matchedLines.has(number) ? styles.match : ''} ${
                  number === currentLine ? styles.current : ''
                }`}
                style={{ top: number * LINE_HEIGHT, height: LINE_HEIGHT }}
              >
                <span className={styles.number}>{number + 1}</span>
                <span className={styles.text}>{line || ' '}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
