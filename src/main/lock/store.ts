import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * The launch password (§ phase 15).
 *
 * **What this is.** A gate on the app itself: with it on, NS3H will not open — and main
 * will not answer for a secret — until the password is entered. It exists because saved
 * passwords can now be read back in the forms, and an app left open on an unlocked
 * machine is the obvious way that gets abused.
 *
 * **What this is not.** It does not encrypt anything. Secrets stay where they were, in
 * the OS keychain, protected by the OS. Someone with an account on the machine and the
 * patience to read the keychain does not need NS3H's permission, and this password will
 * not stop them. It stops a person at the keyboard, which is the threat it is for.
 *
 * The password is stored as an Argon2id hash and nothing else — there is no way back to
 * the password from the file, which is also why forgetting it costs the credentials.
 *
 * It lives in its own file rather than in settings, deliberately: `settings` is part of
 * what "Export configuration" writes, and that export is documented as safe to email. A
 * password hash in it would be an offline guessing target sitting in someone's inbox.
 */

/** §7's profile, the same one the encrypted backup uses. */
const ARGON = {
  algorithm: 2 as const, // Argon2id
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
};

interface LockFile {
  version: 1;
  /** An Argon2id PHC string, or null when no launch password is set. */
  hash: string | null;
}

const EMPTY: LockFile = { version: 1, hash: null };

export class LockStore {
  private cache: LockFile | null = null;

  constructor(private readonly file: string) {}

  /** Whether a launch password is set at all. */
  async enabled(): Promise<boolean> {
    return (await this.read()).hash !== null;
  }

  async set(password: string): Promise<void> {
    if (password.length === 0) throw new Error('A launch password cannot be empty.');
    const { hash } = await import('@node-rs/argon2');
    await this.persist({ version: 1, hash: await hash(password, ARGON) });
  }

  /** Removes the password entirely, leaving the app unlocked at launch. */
  async clear(): Promise<void> {
    await this.persist({ ...EMPTY });
    // The file has nothing left to hold; leaving it behind implies a password is set.
    await rm(this.file, { force: true }).catch(() => {});
    this.cache = { ...EMPTY };
  }

  /**
   * True when the password matches. A malformed or missing hash is not a match — it must
   * never fail open, whatever state the file is in.
   */
  async verify(password: string): Promise<boolean> {
    const { hash } = await this.read();
    if (!hash || password.length === 0) return false;
    try {
      const { verify } = await import('@node-rs/argon2');
      return await verify(hash, password);
    } catch {
      return false;
    }
  }

  private async read(): Promise<LockFile> {
    if (this.cache) return this.cache;
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      const hash = (parsed as LockFile)?.hash;
      this.cache = { version: 1, hash: typeof hash === 'string' && hash ? hash : null };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`NS3H: could not read ${this.file}:`, error);
      }
      this.cache = { ...EMPTY };
    }
    return this.cache;
  }

  private async persist(file: LockFile): Promise<void> {
    this.cache = file;
    await mkdir(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    await writeFile(temp, JSON.stringify(file), { encoding: 'utf8', mode: 0o600 });
    await rename(temp, this.file);
  }
}
