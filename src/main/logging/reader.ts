import { readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export interface LogDocument {
  path: string;
  bytes: number;
  lineCount: number;
}

export interface LogMatch {
  line: number;
  /** Column of the first hit on that line, for scrolling and highlighting. */
  column: number;
}

/**
 * A log file open for reading, held as an array of lines in main.
 *
 * §6.3 requires the viewer to be virtualised — a `show tech-support` runs to tens of
 * megabytes and rendering that as DOM would freeze the window. The split happens here,
 * once, and the renderer asks for the window it can actually see.
 */
interface CachedLog {
  lines: string[];
  bytes: number;
  read: number;
}

const MAX_CACHED = 3;
const MAX_MATCHES = 5000;

export class LogReader {
  private readonly cache = new Map<string, CachedLog>();

  constructor(private readonly logDirectory: () => Promise<string | null>) {}

  /**
   * The renderer supplies the path, so it is checked against the log directory before
   * anything is read — this is the one place the app opens a file the UI names.
   */
  private async verify(path: string): Promise<string> {
    const root = await this.logDirectory();
    if (!root) throw new Error('No log directory is set.');

    const full = resolve(path);
    const base = resolve(root);
    if (full !== base && !full.startsWith(base + sep)) {
      throw new Error('That file is outside the log directory.');
    }
    if (!full.endsWith('.log')) throw new Error('Only .log files can be opened.');
    return full;
  }

  async open(path: string): Promise<LogDocument> {
    const full = await this.verify(path);
    const cached = this.cache.get(full);
    if (cached) {
      cached.read = Date.now();
      return { path: full, bytes: cached.bytes, lineCount: cached.lines.length };
    }

    const info = await stat(full);
    const text = await readFile(full, 'utf8');
    // A trailing newline would otherwise show as an extra blank line at the end.
    const body = text.endsWith('\n') ? text.slice(0, -1) : text;
    const lines = body.length === 0 ? [] : body.split('\n');

    this.cache.set(full, { lines, bytes: info.size, read: Date.now() });
    this.evict();
    return { path: full, bytes: info.size, lineCount: lines.length };
  }

  async lines(path: string, start: number, count: number): Promise<string[]> {
    const full = await this.verify(path);
    const cached = this.cache.get(full) ?? (await this.reopen(full));
    const from = Math.max(0, Math.floor(start));
    return cached.lines.slice(from, from + Math.max(0, Math.floor(count)));
  }

  async search(path: string, query: string): Promise<LogMatch[]> {
    if (!query) return [];
    const full = await this.verify(path);
    const cached = this.cache.get(full) ?? (await this.reopen(full));

    const needle = query.toLowerCase();
    const matches: LogMatch[] = [];
    for (let index = 0; index < cached.lines.length; index += 1) {
      const column = cached.lines[index].toLowerCase().indexOf(needle);
      if (column >= 0) {
        matches.push({ line: index, column });
        if (matches.length >= MAX_MATCHES) break;
      }
    }
    return matches;
  }

  close(path: string): void {
    this.cache.delete(resolve(path));
  }

  private async reopen(full: string): Promise<CachedLog> {
    await this.open(full);
    return this.cache.get(full)!;
  }

  /** Keeps a couple of recent files around; a viewer only ever shows one. */
  private evict(): void {
    while (this.cache.size > MAX_CACHED) {
      let oldest: string | null = null;
      let oldestRead = Infinity;
      for (const [path, entry] of this.cache) {
        if (entry.read < oldestRead) {
          oldestRead = entry.read;
          oldest = path;
        }
      }
      if (!oldest) return;
      this.cache.delete(oldest);
    }
  }
}
