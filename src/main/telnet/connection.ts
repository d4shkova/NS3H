import { Socket } from 'node:net';
import type { NoticeLevel } from '@shared/types.js';
import { TelnetNegotiator, escapeOutbound } from './iac.js';

export interface TelnetTarget {
  name: string;
  address: string;
  port: number;
}

export interface TelnetCallbacks {
  onData(chunk: Buffer): void;
  onConnected(): void;
  onClosed(detail: string): void;
  onError(detail: string): void;
  onNotice(level: NoticeLevel, text: string): void;
}

const CONNECT_TIMEOUT_MS = 15_000;
/** §3.7 — telnet keeps TCP keepalive on; there is no protocol-level equivalent. */
const KEEPALIVE_DELAY_MS = 30_000;

export class TelnetConnection {
  private socket: Socket | null = null;
  private negotiator: TelnetNegotiator;
  private disposed = false;
  private connected = false;

  constructor(
    private readonly target: TelnetTarget,
    private readonly callbacks: TelnetCallbacks,
    cols = 80,
    rows = 24,
  ) {
    this.negotiator = new TelnetNegotiator({ terminalType: 'xterm-256color', cols, rows });
  }

  open(): void {
    const socket = new Socket();
    this.socket = socket;
    socket.setNoDelay(true);
    socket.setKeepAlive(true, KEEPALIVE_DELAY_MS);
    socket.setTimeout(CONNECT_TIMEOUT_MS);

    socket.on('connect', () => {
      this.connected = true;
      socket.setTimeout(0); // the timeout guards connection, not idle sessions
      socket.write(this.negotiator.initialNegotiation());
      this.callbacks.onConnected();
    });

    socket.on('timeout', () => {
      if (this.connected) return;
      socket.destroy();
      this.callbacks.onError(
        `Timed out connecting to ${this.target.address}:${this.target.port}. ` +
          'A firewall or ACL may be dropping the traffic.',
      );
    });

    socket.on('data', (chunk) => {
      const { data, reply } = this.negotiator.receive(chunk);
      if (reply.length > 0) socket.write(reply);
      if (data.length > 0) this.callbacks.onData(data);
    });

    socket.on('error', (error) => {
      if (this.disposed) return;
      this.callbacks.onError(explainSocketError(error, this.target.address, this.target.port));
    });

    socket.on('close', () => {
      if (this.disposed || !this.connected) return;
      this.callbacks.onClosed('The device closed the connection.');
    });

    socket.connect(this.target.port, this.target.address);
  }

  write(data: string): void {
    if (!this.socket || !this.connected) return;
    this.socket.write(escapeOutbound(Buffer.from(data, 'utf8')));
  }

  resize(cols: number, rows: number): void {
    const message = this.negotiator.resize(cols, rows);
    if (message && this.socket && this.connected) this.socket.write(message);
  }

  close(): void {
    this.disposed = true;
    this.socket?.destroy();
  }
}

export function explainSocketError(error: unknown, address: string, port: number): string {
  const code = (error as NodeJS.ErrnoException)?.code ?? '';
  switch (code) {
    case 'ENOTFOUND':
      return `Could not resolve ${address}. Check the hostname or use an IP address.`;
    case 'ECONNREFUSED':
      return `${address} refused the connection on port ${port}. Is telnet enabled on that port?`;
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return `No route to ${address}. Check the interface, VPN, or routing table.`;
    case 'ECONNRESET':
      return `${address} reset the connection. Some devices do this when all VTY lines are busy.`;
    case 'ETIMEDOUT':
      return `Timed out connecting to ${address}:${port}. A firewall or ACL may be dropping the traffic.`;
    default:
      return (error as Error)?.message ?? String(error);
  }
}
