import { SerialPort } from 'serialport';
import type { SerialConfig } from '@shared/config.js';
import type { NoticeLevel } from '@shared/types.js';

export interface SerialCallbacks {
  onData(chunk: Buffer): void;
  onConnected(): void;
  onClosed(detail: string): void;
  onError(detail: string): void;
  onNotice(level: NoticeLevel, text: string): void;
}

/** §3.6 — hold the line low for 250 ms. Cisco password recovery depends on this. */
const BREAK_DURATION_MS = 250;

export class SerialConnection {
  private port: SerialPort | null = null;
  private disposed = false;

  constructor(
    private readonly config: SerialConfig,
    private readonly callbacks: SerialCallbacks,
  ) {}

  open(): void {
    const port = new SerialPort(
      {
        path: this.config.path,
        baudRate: this.config.baudRate,
        dataBits: this.config.dataBits,
        stopBits: this.config.stopBits,
        parity: this.config.parity,
        rtscts: this.config.flowControl === 'rtscts',
        xon: this.config.flowControl === 'xonxoff',
        xoff: this.config.flowControl === 'xonxoff',
        autoOpen: false,
      },
      (error) => {
        if (error) this.callbacks.onError(explainSerialError(error, this.config.path));
      },
    );

    this.port = port;

    port.on('data', (chunk: Buffer) => this.callbacks.onData(chunk));
    port.on('error', (error) => {
      if (this.disposed) return;
      this.callbacks.onError(explainSerialError(error, this.config.path));
    });
    port.on('close', () => {
      if (this.disposed) return;
      // Unplugging a USB adapter mid-session lands here.
      this.callbacks.onClosed(`${this.config.path} closed. The adapter may have been unplugged.`);
    });

    port.open((error) => {
      if (error) {
        this.callbacks.onError(explainSerialError(error, this.config.path));
        return;
      }
      this.callbacks.onConnected();
      const { baudRate, dataBits, parity, stopBits } = this.config;
      this.callbacks.onNotice(
        'info',
        `Opened ${this.config.path} at ${baudRate} ${dataBits}${parity[0].toUpperCase()}${stopBits}. ` +
          'There is no carrier signal on a serial line — press Enter if nothing appears.',
      );
    });
  }

  write(data: string): void {
    this.port?.write(data);
  }

  /** Serial has no window size to report; the remote end cannot know. */
  resize(): void {}

  /** §3.6 — Send Break: assert, hold, release. */
  sendBreak(): Promise<void> {
    return new Promise((resolve, reject) => {
      const port = this.port;
      if (!port?.isOpen) {
        reject(new Error('The port is not open.'));
        return;
      }
      port.set({ brk: true }, (error) => {
        if (error) {
          reject(new Error(`Could not assert break: ${error.message}`));
          return;
        }
        setTimeout(() => {
          port.set({ brk: false }, (releaseError) => {
            if (releaseError) reject(new Error(`Could not release break: ${releaseError.message}`));
            else resolve();
          });
        }, BREAK_DURATION_MS);
      });
    });
  }

  close(): void {
    this.disposed = true;
    if (this.port?.isOpen) this.port.close(() => {});
  }
}

/**
 * §3.6 — a permissions error must name the fix, not print EACCES. This is the single
 * most common first-run failure on Linux and the answer is always the same.
 */
export function explainSerialError(error: unknown, path: string): string {
  const err = error as NodeJS.ErrnoException;
  const code = err?.code ?? '';
  const message = err?.message ?? String(error);

  if (code === 'EACCES' || /permission denied/i.test(message)) {
    return (
      `No permission to open ${path}.\n\n` +
      'On Linux the fix is to add your user to the group that owns the port — usually ' +
      '`dialout` (Debian, Ubuntu, Arch) or `uucp` (some distributions):\n\n' +
      '    sudo usermod -aG dialout $USER\n\n' +
      'Then log out and back in — group membership is only applied at login.'
    );
  }

  if (code === 'ENOENT' || /no such file/i.test(message)) {
    return (
      `${path} does not exist. The adapter may be unplugged, or the port may have been ` +
      'renumbered — reopen the port list to see what is attached now.'
    );
  }

  if (code === 'EBUSY' || /resource busy|access denied/i.test(message)) {
    return (
      `${path} is in use by another program. Close any other terminal, ModemManager, or ` +
      'console session holding the port and try again.'
    );
  }

  return message;
}
