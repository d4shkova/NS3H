import type { Duplex } from 'node:stream';

/**
 * The SCP wire protocol, as `scp -f` (source, i.e. our download) and `scp -t` (sink, i.e.
 * our upload) speak it over an exec channel.
 *
 * It is a tiny, undocumented-by-design protocol: a control line, an acknowledgement byte,
 * the file's bytes, and another acknowledgement. It is implemented here rather than
 * pulled in because ssh2 has no SCP of its own, and because the reason to want SCP at all
 * — network gear with an SCP server and no SFTP subsystem — is exactly the case a general
 * purpose library tends to handle badly.
 *
 * Split from the transport so it can be tested against a fake channel: an SCP bug on a
 * device that only speaks SCP is not something to find out about during a firmware push.
 */

/** The single byte that means "go on". */
const OK = 0x00;
const WARNING = 0x01;
const ERROR = 0x02;

export interface ScpHeader {
  /** POSIX mode from the control line, e.g. 0o644. */
  mode: number;
  size: number;
  name: string;
}

/**
 * Shell-quotes a remote path, but only when it needs it.
 *
 * A POSIX server runs the path through a shell; `flash:c2960-image.bin` on IOS is handed
 * to something that is not a shell at all and would take the quotes literally. So paths
 * made only of characters no shell treats specially are sent untouched, which covers
 * every network-device path, and anything else is single-quoted.
 */
export function quoteRemotePath(path: string): string {
  if (/^[A-Za-z0-9._:/@%+,=-]+$/.test(path)) return path;
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

/** `C0644 1234 name` — the control line that opens a file transfer. */
export function parseControlLine(line: string): ScpHeader {
  const match = /^C([0-7]{4}) (\d+) (.*)$/.exec(line);
  if (!match) {
    throw new Error(`The device sent an SCP control line NS3H could not read: "${line}"`);
  }
  return {
    mode: Number.parseInt(match[1], 8),
    size: Number.parseInt(match[2], 10),
    name: match[3],
  };
}

export function formatControlLine(header: ScpHeader): string {
  const mode = (header.mode & 0o7777).toString(8).padStart(4, '0');
  return `C${mode} ${header.size} ${header.name}\n`;
}

/**
 * Reads a channel one protocol element at a time.
 *
 * SCP interleaves control text and raw file bytes on the same stream with no framing, so
 * the buffer has to be shared between the two: bytes read while looking for the end of a
 * control line are frequently the first bytes of the file that follows.
 */
export class ScpChannel {
  private buffer: Buffer = Buffer.alloc(0);
  private ended = false;
  private failure: Error | null = null;
  private wake: (() => void) | null = null;

  constructor(private readonly channel: Duplex) {
    channel.on('data', (chunk: Buffer) => {
      this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
      this.wake?.();
    });
    channel.on('end', () => {
      this.ended = true;
      this.wake?.();
    });
    channel.on('close', () => {
      this.ended = true;
      this.wake?.();
    });
    channel.on('error', (error: Error) => {
      this.failure = error;
      this.ended = true;
      this.wake?.();
    });
  }

  /** Waits until at least one more byte is available, or the channel is done. */
  private more(): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.ended) return Promise.resolve();
    return new Promise((resolve) => {
      this.wake = () => {
        this.wake = null;
        resolve();
      };
    });
  }

  private take(count: number): Buffer {
    const chunk = this.buffer.subarray(0, count);
    this.buffer = this.buffer.subarray(count);
    return chunk;
  }

  /**
   * Reads one acknowledgement. `\0` means go on; `\x01` and `\x02` are a warning or a
   * fatal error, each followed by a line of text that is the whole point — this is where
   * "flash: No such file or directory" or "permission denied" arrives.
   */
  async readAck(): Promise<void> {
    while (this.buffer.length === 0) {
      if (this.ended) throw new Error('The device closed the SCP channel without replying.');
      await this.more();
      if (this.failure) throw this.failure;
    }

    const code = this.take(1)[0];
    if (code === OK) return;
    if (code === WARNING || code === ERROR) {
      const text = (await this.readLine()).trim();
      throw new Error(text || 'The device refused the transfer without saying why.');
    }
    // Not an acknowledgement at all: some devices open with the control line directly.
    this.buffer = Buffer.concat([Buffer.from([code]), this.buffer]);
  }

  /** Reads up to and including the next newline, returning the text without it. */
  async readLine(): Promise<string> {
    for (;;) {
      const end = this.buffer.indexOf(0x0a);
      if (end >= 0) {
        const line = this.take(end + 1).subarray(0, end);
        return line.toString('utf8');
      }
      if (this.ended) {
        const rest = this.take(this.buffer.length).toString('utf8');
        if (rest.length > 0) return rest;
        throw new Error('The device closed the SCP channel mid-message.');
      }
      await this.more();
      if (this.failure) throw this.failure;
    }
  }

  /**
   * Hands over exactly `size` bytes of file content, in whatever chunks they arrive in.
   *
   * A `sink` that returns a promise is asking for time — the file on disk wants to drain
   * — and the channel is paused until it resolves. Without that, a 400 MB image arriving
   * faster than the disk takes it would be buffered in memory in its entirety.
   */
  async readBody(size: number, sink: (chunk: Buffer) => Promise<void> | void): Promise<void> {
    let remaining = size;
    while (remaining > 0) {
      if (this.buffer.length === 0) {
        if (this.ended) {
          throw new Error(
            `The device closed the SCP channel with ${remaining} bytes still to send.`,
          );
        }
        await this.more();
        if (this.failure) throw this.failure;
        continue;
      }

      const chunk = this.take(Math.min(remaining, this.buffer.length));
      remaining -= chunk.length;

      const settling = sink(chunk);
      if (settling) {
        this.channel.pause();
        try {
          await settling;
        } finally {
          this.channel.resume();
        }
      }
    }
  }

  /** False when the channel wants a pause — see `drain`. */
  write(data: Buffer | string): boolean {
    return this.channel.write(data);
  }

  /**
   * Resolves when the channel is ready for more.
   *
   * Settles on close and error as well as on drain: a device that dies mid-upload would
   * otherwise never emit `drain`, and the transfer would hang rather than fail. The
   * failure is then reported by the next read, which is where it belongs.
   */
  drain(): Promise<void> {
    if (this.ended) return Promise.resolve();
    return new Promise((resolve) => {
      const done = (): void => {
        this.channel.off('drain', done);
        this.channel.off('close', done);
        this.channel.off('error', done);
        resolve();
      };
      this.channel.once('drain', done);
      this.channel.once('close', done);
      this.channel.once('error', done);
    });
  }

  ack(): void {
    this.channel.write(Buffer.from([OK]));
  }

  end(): void {
    this.channel.end();
  }
}
