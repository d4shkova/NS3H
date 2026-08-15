import { randomBytes } from 'node:crypto';
import type { FileConnection, FileTargetInput } from '@shared/transfer.js';
import type { SessionManager } from '../sessions/manager.js';
import { SmbTransport, shareUnc } from './smb.js';
import { StandaloneSftp } from './sftp.js';
import type { FileTransport } from './transport.js';

/** Transfer connection ids are told apart from session ids by their prefix. */
export const TRANSFER_ID_PREFIX = 'trc_';

export function isTransferConnectionId(id: string): boolean {
  return id.startsWith(TRANSFER_ID_PREFIX);
}

interface Entry {
  info: FileConnection;
  transport: FileTransport;
}

/**
 * Transfer connections that do not belong to a terminal session (§ phase 12).
 *
 * One hub per renderer, alongside its SessionManager — which it borrows for host-key and
 * authentication prompts, so a standalone SFTP connection raises the same modal as a
 * session and records a newly trusted key in the same known-hosts file.
 */
export class TransferHub {
  private readonly connections = new Map<string, Entry>();

  constructor(private readonly prompts: SessionManager) {}

  async connect(target: FileTargetInput): Promise<FileConnection> {
    const id = `${TRANSFER_ID_PREFIX}${randomBytes(4).toString('hex')}`;

    const transport =
      target.protocol === 'smb'
        ? await SmbTransport.connect(target)
        : await this.connectSftp(id, target);

    const label =
      target.protocol === 'smb'
        ? shareUnc(target.host, (target.share ?? '').replace(/^[\\/]+|[\\/]+$/g, ''))
        : `${target.username}@${target.host}`;

    let home = '/';
    try {
      home = await transport.home();
    } catch {
      // A device that will not resolve its own home still lists from the root.
    }

    const info: FileConnection = { id, protocol: target.protocol, label, home };
    this.connections.set(id, { info, transport });
    return info;
  }

  private async connectSftp(id: string, target: FileTargetInput): Promise<FileTransport> {
    // The ladder explains itself through notices — "retrying with the legacy algorithm
    // set" and so on. A standalone connection has no terminal to print them in, so they
    // are kept and attached to the failure, where they are the useful part.
    const notices: string[] = [];

    try {
      return await StandaloneSftp.connect(target, {
        // The host-key modal is app-level, not per-tab, so it appears for a connection
        // with no session behind it — and a key trusted here lands in the same file.
        verifyHostKey: (identity) =>
          this.prompts.resolveHostKey(id, { address: target.host, port: target.port }, identity),
        onClosed: () => this.forget(id),
        onNotice: (level, text) => {
          if (level !== 'info') notices.push(text);
        },
      });
    } catch (error) {
      const detail = (error as Error).message;
      throw notices.length > 0
        ? new Error(`${detail}\n\nAlong the way:\n${notices.map((n) => `  · ${n}`).join('\n')}`)
        : error;
    }
  }

  list(): FileConnection[] {
    return [...this.connections.values()].map((entry) => entry.info);
  }

  transport(id: string): FileTransport {
    const entry = this.connections.get(id);
    if (!entry) {
      throw new Error('That transfer connection is no longer open — connect again.');
    }
    return entry.transport;
  }

  disconnect(id: string): void {
    const entry = this.connections.get(id);
    if (!entry) return;
    this.connections.delete(id);
    try {
      entry.transport.close();
    } catch {
      // Closing a connection the far end already dropped is not worth reporting.
    }
  }

  /** Drops a connection the far end closed, without trying to close it again. */
  private forget(id: string): void {
    this.connections.delete(id);
  }

  closeAll(): void {
    for (const id of [...this.connections.keys()]) this.disconnect(id);
  }
}
