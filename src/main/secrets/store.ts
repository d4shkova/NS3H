import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SecretKind, SecretsStatus } from '@shared/config.js';

/** The subset of Electron's `safeStorage` this needs, injectable for tests. */
export interface Vault {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

interface SecretsFileShape {
  version: 1;
  /** Secret key → base64 of the platform-encrypted blob. */
  entries: Record<string, string>;
}

const EMPTY: SecretsFileShape = { version: 1, entries: {} };

export class SecretsUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'SecretsUnavailableError';
  }
}

/**
 * Secrets are keyed by their owner — a credential ID, or a host ID for an inline
 * credential — never by hostname, so renaming or re-addressing a device keeps them.
 */
export function secretKey(ownerId: string, kind: SecretKind): string {
  return `${ownerId}:${kind}`;
}

/**
 * Passwords and key passphrases, encrypted by the OS keychain (Keychain / DPAPI /
 * libsecret) and written to secrets.enc.
 *
 * When the platform has no keychain — common on a minimal Linux desktop with no
 * keyring running — Electron's fallback is barely-obfuscated plaintext. NS3H refuses
 * to write in that case rather than implying a security property it cannot deliver;
 * the UI reports it and the session prompts for the secret instead.
 */
export class SecretsStore {
  private cache: SecretsFileShape | null = null;

  constructor(
    private readonly file: string,
    private readonly vault: Vault,
  ) {}

  status(): SecretsStatus {
    if (this.vault.isEncryptionAvailable()) return { available: true };
    return {
      available: false,
      reason:
        'No OS keychain is available, so NS3H will not store passwords or passphrases. ' +
        'On Linux, install and run a keyring (gnome-keyring or kwallet) and restart. ' +
        'Sessions will prompt for credentials until then.',
    };
  }

  async set(ownerId: string, kind: SecretKind, value: string): Promise<void> {
    const status = this.status();
    if (!status.available) throw new SecretsUnavailableError(status.reason!);

    const file = await this.read();
    file.entries[secretKey(ownerId, kind)] = this.vault
      .encryptString(value)
      .toString('base64');
    await this.persist(file);
  }

  async get(ownerId: string, kind: SecretKind): Promise<string | null> {
    if (!this.vault.isEncryptionAvailable()) return null;
    const file = await this.read();
    const encoded = file.entries[secretKey(ownerId, kind)];
    if (!encoded) return null;
    try {
      return this.vault.decryptString(Buffer.from(encoded, 'base64'));
    } catch (error) {
      // Keychain rotated, different machine, different user — recoverable by re-entry.
      console.error(`NS3H: could not decrypt secret for ${ownerId}:`, error);
      return null;
    }
  }

  async has(ownerId: string, kind: SecretKind): Promise<boolean> {
    const file = await this.read();
    return secretKey(ownerId, kind) in file.entries;
  }

  /** Removes one secret, for when a field is deliberately emptied. */
  async clear(ownerId: string, kind: SecretKind): Promise<void> {
    const file = await this.read();
    if (!(secretKey(ownerId, kind) in file.entries)) return;
    delete file.entries[secretKey(ownerId, kind)];
    await this.persist(file);
  }

  /** Removes every secret belonging to an owner, for when it is deleted. */
  async forget(ownerId: string): Promise<void> {
    const file = await this.read();
    const prefix = `${ownerId}:`;
    let changed = false;
    for (const key of Object.keys(file.entries)) {
      if (key.startsWith(prefix)) {
        delete file.entries[key];
        changed = true;
      }
    }
    if (changed) await this.persist(file);
  }

  /**
   * Empties the vault. Used by the launch-password reset, which is the one path that
   * deliberately destroys credentials — someone who cannot get in should not be able to
   * read them, but should be able to start again.
   */
  async clearAll(): Promise<void> {
    await this.persist({ version: 1, entries: {} });
  }

  private async read(): Promise<SecretsFileShape> {
    if (this.cache) return this.cache;
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      const entries = (parsed as SecretsFileShape)?.entries;
      this.cache = {
        version: 1,
        entries: typeof entries === 'object' && entries !== null ? { ...entries } : {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`NS3H: could not read ${this.file}:`, error);
      }
      this.cache = { ...EMPTY, entries: {} };
    }
    return this.cache;
  }

  private async persist(file: SecretsFileShape): Promise<void> {
    this.cache = file;
    await mkdir(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    await writeFile(temp, JSON.stringify(file), { encoding: 'utf8', mode: 0o600 });
    await rename(temp, this.file);
  }
}
