/**
 * Telnet option negotiation (§3.5). There is no adequate library, so this is written
 * from RFC 854/1091/1073/858.
 *
 * The rule that keeps this simple: NS3H is a client that wants a plain character
 * stream. It agrees to exactly four options and refuses everything else, and it never
 * answers a request that would not change the current state — that is what stops two
 * polite implementations negotiating forever.
 */

export const IAC = 255;
export const DONT = 254;
export const DO = 253;
export const WONT = 252;
export const WILL = 251;
export const SB = 250;
export const SE = 240;

export const OPT_ECHO = 1;
export const OPT_SGA = 3;
export const OPT_TTYPE = 24;
export const OPT_NAWS = 31;

const TTYPE_IS = 0;
const TTYPE_SEND = 1;

/** Options we will perform ourselves when asked. */
const WE_SUPPORT = new Set([OPT_TTYPE, OPT_NAWS]);
/** Options we want the other end to perform. */
const WE_WANT_REMOTE = new Set([OPT_ECHO, OPT_SGA]);

export interface TelnetOptions {
  terminalType: string;
  cols: number;
  rows: number;
}

export interface NegotiationResult {
  /** Application data with all telnet machinery removed. */
  data: Buffer;
  /** Bytes to send back to the server. Empty when nothing is required. */
  reply: Buffer;
}

type State = 'data' | 'iac' | 'will' | 'wont' | 'do' | 'dont' | 'sb' | 'sbIac';

export class TelnetNegotiator {
  private state: State = 'data';
  private subnegotiation: number[] = [];
  /** What we have told the peer, so a repeated request is not answered twice. */
  private readonly told = new Map<number, 'will' | 'wont'>();
  private readonly asked = new Map<number, 'do' | 'dont'>();
  private cols: number;
  private rows: number;

  constructor(private readonly options: TelnetOptions) {
    this.cols = options.cols;
    this.rows = options.rows;
  }

  /** True once the peer has agreed to us sending window sizes. */
  get nawsAgreed(): boolean {
    return this.told.get(OPT_NAWS) === 'will';
  }

  /**
   * The opening proposal. Sending it rather than waiting shortens the handshake with
   * devices that expect the client to lead.
   */
  initialNegotiation(): Buffer {
    const reply: number[] = [];
    for (const option of [OPT_TTYPE, OPT_NAWS]) {
      this.told.set(option, 'will');
      reply.push(IAC, WILL, option);
    }
    for (const option of [OPT_SGA, OPT_ECHO]) {
      this.asked.set(option, 'do');
      reply.push(IAC, DO, option);
    }
    return Buffer.from(reply);
  }

  receive(chunk: Buffer): NegotiationResult {
    const data: number[] = [];
    const reply: number[] = [];

    for (const byte of chunk) {
      switch (this.state) {
        case 'data':
          if (byte === IAC) this.state = 'iac';
          else data.push(byte);
          break;

        case 'iac':
          if (byte === IAC) {
            // Escaped 255 — a literal data byte.
            data.push(IAC);
            this.state = 'data';
          } else if (byte === WILL) this.state = 'will';
          else if (byte === WONT) this.state = 'wont';
          else if (byte === DO) this.state = 'do';
          else if (byte === DONT) this.state = 'dont';
          else if (byte === SB) {
            this.subnegotiation = [];
            this.state = 'sb';
          } else {
            // A two-byte command with no argument (NOP, DM, GA...). Nothing to do.
            this.state = 'data';
          }
          break;

        case 'will':
          this.onWill(byte, reply);
          this.state = 'data';
          break;

        case 'wont':
          // The peer refuses; record it so we stop asking.
          if (this.asked.get(byte) !== 'dont') {
            this.asked.set(byte, 'dont');
            reply.push(IAC, DONT, byte);
          }
          this.state = 'data';
          break;

        case 'do':
          this.onDo(byte, reply);
          this.state = 'data';
          break;

        case 'dont':
          if (this.told.get(byte) !== 'wont') {
            this.told.set(byte, 'wont');
            reply.push(IAC, WONT, byte);
          }
          this.state = 'data';
          break;

        case 'sb':
          if (byte === IAC) this.state = 'sbIac';
          else this.subnegotiation.push(byte);
          break;

        case 'sbIac':
          if (byte === IAC) {
            // Escaped 255 inside a subnegotiation.
            this.subnegotiation.push(IAC);
            this.state = 'sb';
          } else if (byte === SE) {
            this.onSubnegotiation(this.subnegotiation, reply);
            this.subnegotiation = [];
            this.state = 'data';
          } else {
            this.state = 'sb';
          }
          break;
      }
    }

    return { data: Buffer.from(data), reply: Buffer.from(reply) };
  }

  /** The peer offers to perform an option. */
  private onWill(option: number, reply: number[]): void {
    const wanted = WE_WANT_REMOTE.has(option);
    const desired = wanted ? 'do' : 'dont';
    if (this.asked.get(option) === desired) return; // already settled
    this.asked.set(option, desired);
    reply.push(IAC, wanted ? DO : DONT, option);
  }

  /** The peer asks us to perform an option. */
  private onDo(option: number, reply: number[]): void {
    const supported = WE_SUPPORT.has(option);
    const desired = supported ? 'will' : 'wont';
    const settled = this.told.get(option) === desired;

    if (!settled) {
      this.told.set(option, desired);
      reply.push(IAC, supported ? WILL : WONT, option);
    }

    // §3.5 — send NAWS on connect as well as on resize, so the device sizes its
    // pager correctly from the start. Worth repeating even if WILL was already sent.
    if (option === OPT_NAWS && supported) {
      reply.push(...this.nawsBytes());
    }
  }

  private onSubnegotiation(bytes: number[], reply: number[]): void {
    const [option, command] = bytes;
    if (option === OPT_TTYPE && command === TTYPE_SEND) {
      reply.push(IAC, SB, OPT_TTYPE, TTYPE_IS);
      for (const byte of Buffer.from(this.options.terminalType, 'ascii')) reply.push(byte);
      reply.push(IAC, SE);
    }
    // Every other subnegotiation is ignored; we already refused those options.
  }

  /** Window size for the current dimensions, or null if NAWS was never agreed. */
  resize(cols: number, rows: number): Buffer | null {
    this.cols = cols;
    this.rows = rows;
    if (!this.nawsAgreed) return null;
    return Buffer.from(this.nawsBytes());
  }

  private nawsBytes(): number[] {
    const size = [
      (this.cols >> 8) & 0xff,
      this.cols & 0xff,
      (this.rows >> 8) & 0xff,
      this.rows & 0xff,
    ];
    // A size byte of 255 has to be escaped, or it would read as an IAC.
    const escaped = size.flatMap((byte) => (byte === IAC ? [IAC, IAC] : [byte]));
    return [IAC, SB, OPT_NAWS, ...escaped, IAC, SE];
  }
}

/** §3.5 — a literal 0xFF in outbound data must go out as IAC IAC. */
export function escapeOutbound(data: Buffer): Buffer {
  if (!data.includes(IAC)) return data;
  const out: number[] = [];
  for (const byte of data) {
    out.push(byte);
    if (byte === IAC) out.push(IAC);
  }
  return Buffer.from(out);
}
