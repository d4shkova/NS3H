import { StringDecoder } from 'node:string_decoder';

/**
 * Turns a raw terminal stream into what the user actually saw (§5.3).
 *
 * The device echoes everything back, so the log gets the commands for free — but it
 * also gets the machinery that made the screen look right: escape sequences, and the
 * backspace/carriage-return dance a `--More--` pager uses to rub out its own prompt.
 * Writing those bytes to a file produces something unreadable.
 *
 * So this keeps a one-line buffer with a cursor and replays the overwrites into it,
 * emitting a line only once the device moves off it. What lands in the log is the
 * final state of each line, which is what was on the screen.
 *
 * It is a streaming state machine because chunk boundaries fall anywhere — mid escape
 * sequence, mid UTF-8 character, mid line.
 */
export class StreamSanitizer {
  private readonly decoder = new StringDecoder('utf8');
  private line: string[] = [];
  private cursor = 0;
  private out: string[] = [];
  private state: 'text' | 'esc' | 'csi' | 'osc' | 'oscEsc' | 'charset' = 'text';
  private params = '';

  /** Feed a chunk; returns any completed lines, ready to append. */
  write(chunk: Buffer): string {
    for (const char of this.decoder.write(chunk)) this.consume(char);
    return this.drain();
  }

  /** Emits the partial line still in the buffer. Call once, at session end. */
  flush(): string {
    for (const char of this.decoder.end()) this.consume(char);
    if (this.line.length > 0) this.emitLine();
    return this.drain();
  }

  private drain(): string {
    const text = this.out.join('');
    this.out = [];
    return text;
  }

  private consume(char: string): void {
    switch (this.state) {
      case 'esc':
        this.consumeEscape(char);
        return;
      case 'csi':
        // Parameter and intermediate bytes, then a final byte in 0x40–0x7E.
        if (char >= '\x40' && char <= '\x7e') {
          this.applyCsi(this.params, char);
          this.state = 'text';
        } else {
          this.params += char;
        }
        return;
      case 'osc':
        // Window titles and the like: consumed and dropped, terminated by BEL or ST.
        if (char === '\x07') this.state = 'text';
        else if (char === '\x1b') this.state = 'oscEsc';
        return;
      case 'oscEsc':
        this.state = char === '\\' ? 'text' : 'osc';
        return;
      case 'charset':
        this.state = 'text';
        return;
      default:
        this.consumeText(char);
    }
  }

  private consumeText(char: string): void {
    switch (char) {
      case '\x1b':
        this.state = 'esc';
        return;
      case '\n':
        this.emitLine();
        return;
      case '\r':
        // A bare CR rewrites the line rather than ending it.
        this.cursor = 0;
        return;
      case '\b':
        this.cursor = Math.max(0, this.cursor - 1);
        return;
      case '\t':
        this.put(char);
        return;
      default:
        // Drop the remaining C0 controls (BEL, SO/SI, NUL) and DEL.
        if (char < '\x20' || char === '\x7f') return;
        this.put(char);
    }
  }

  private consumeEscape(char: string): void {
    switch (char) {
      case '[':
        this.state = 'csi';
        this.params = '';
        return;
      case ']':
        this.state = 'osc';
        return;
      case '(':
      case ')':
      case '*':
      case '+':
      case '#':
        // Character-set designators: one more byte to swallow.
        this.state = 'charset';
        return;
      case 'E':
        // NEL — next line.
        this.emitLine();
        this.state = 'text';
        return;
      default:
        this.state = 'text';
    }
  }

  private applyCsi(params: string, final: string): void {
    const numbers = params
      .split(';')
      .map((value) => Number.parseInt(value, 10))
      .map((value) => (Number.isNaN(value) ? 0 : value));
    const first = numbers[0] ?? 0;

    switch (final) {
      case 'K': // EL — erase in line
        if (first === 0) this.line.length = Math.min(this.line.length, this.cursor);
        else if (first === 1) for (let i = 0; i < this.cursor; i += 1) this.line[i] = ' ';
        else this.line = [];
        return;
      case 'D': // CUB — cursor back
        this.cursor = Math.max(0, this.cursor - Math.max(1, first));
        return;
      case 'C': // CUF — cursor forward
        this.cursor += Math.max(1, first);
        return;
      case 'G': // CHA — cursor to column
        this.cursor = Math.max(0, Math.max(1, first) - 1);
        return;
      case 'H':
      case 'f': {
        // CUP — only the column is meaningful for a line-oriented log.
        const column = numbers[1] ?? 1;
        this.cursor = Math.max(0, Math.max(1, column) - 1);
        return;
      }
      default:
        // SGR colours, erase-display, mode switches: nothing to record.
        return;
    }
  }

  private put(char: string): void {
    while (this.line.length < this.cursor) this.line.push(' ');
    this.line[this.cursor] = char;
    this.cursor += 1;
  }

  private emitLine(): void {
    // Overwrites routinely leave trailing spaces behind; they are not information.
    this.out.push(`${this.line.join('').replace(/[ \t]+$/, '')}\n`);
    this.line = [];
    this.cursor = 0;
  }
}
