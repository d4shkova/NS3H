import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { StreamSanitizer } from './sanitize.js';
import { formatDuration, formatTimestamp } from './paths.js';

export interface CryptoSummary {
  kex: string;
  cipher: string;
  mac: string;
  hostKey: string;
}

export interface SerialSummary {
  path: string;
  baudRate: number;
  dataBits: number;
  parity: string;
  stopBits: number;
  flowControl: string;
}

export interface LogHeader {
  /** `core-sw-01 (10.1.1.5:22)` */
  host: string;
  protocol: string;
  user?: string;
  started: Date;
  /** SSH only — omitted for telnet and serial (§5.2). */
  crypto?: CryptoSummary;
  /** Serial only. */
  serial?: SerialSummary;
}

const FLUSH_INTERVAL_MS = 2000;

function line(label: string, value: string): string {
  return `${label.padEnd(12)}${value}\n`;
}

export function formatHeader(header: LogHeader): string {
  let text = '=== NS3H session ===\n';
  text += line('Host:', header.host);
  text += line('Protocol:', header.protocol);
  if (header.user) text += line('User:', header.user);
  text += line('Started:', formatTimestamp(header.started));

  if (header.crypto) {
    text += line('KEX:', header.crypto.kex);
    text += line('Cipher:', header.crypto.cipher);
    text += line('MAC:', header.crypto.mac);
    text += line('Host key:', header.crypto.hostKey);
  }

  if (header.serial) {
    const { baudRate, dataBits, parity, stopBits, flowControl } = header.serial;
    text += line('Port:', header.serial.path);
    text += line('Settings:', `${baudRate} ${dataBits}${parity[0].toUpperCase()}${stopBits}`);
    text += line('Flow:', flowControl);
  }

  return `${text}====================\n\n`;
}

export function formatFooter(ended: Date, durationMs: number): string {
  return `\n=== Session ended ${formatTimestamp(ended)} (duration ${formatDuration(durationMs)}) ===\n`;
}

/**
 * Appends a session's cleaned output to disk (§5.3).
 *
 * Buffered, flushed at least every two seconds and on close, so a busy `show
 * tech-support` is not one write syscall per packet. Writes are chained rather than
 * concurrent, so appends cannot interleave.
 *
 * This lives in the main process and is fed from the raw stream, which is what keeps
 * a backgrounded — or closed — terminal logging.
 */
export class SessionLogWriter {
  private readonly sanitizer = new StreamSanitizer();
  private buffer = '';
  private timer: NodeJS.Timeout | null = null;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private failed: Error | null = null;

  private constructor(
    readonly path: string,
    private readonly startedAt: Date,
  ) {}

  static async open(path: string, header: LogHeader): Promise<SessionLogWriter> {
    await mkdir(dirname(path), { recursive: true });
    const writer = new SessionLogWriter(path, header.started);
    writer.buffer = formatHeader(header);
    await writer.flush();
    writer.timer = setInterval(() => void writer.flush(), FLUSH_INTERVAL_MS);
    writer.timer.unref?.();
    return writer;
  }

  /** The last write error, if the log stopped working — surfaced, never swallowed. */
  get error(): Error | null {
    return this.failed;
  }

  write(chunk: Buffer): void {
    if (this.closed) return;
    this.buffer += this.sanitizer.write(chunk);
  }

  async close(endedAt: Date = new Date()): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.buffer += this.sanitizer.flush();
    this.buffer += formatFooter(endedAt, endedAt.getTime() - this.startedAt.getTime());
    await this.flush();
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const pending = this.buffer;
    this.buffer = '';
    this.queue = this.queue.then(async () => {
      try {
        await appendFile(this.path, pending, 'utf8');
      } catch (error) {
        this.failed = error as Error;
        console.error(`NS3H: could not write ${this.path}:`, error);
      }
    });
    return this.queue;
  }
}
