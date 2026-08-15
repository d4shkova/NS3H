import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface Versioned {
  version: number;
}

export interface JsonStoreOptions<T extends Versioned> {
  file: string;
  fallback: T;
  /** Coerces parsed JSON into a valid T, dropping anything malformed. */
  normalise: (raw: unknown) => T;
  /**
   * Applied in order before normalisation when the file's version is older than
   * the current one. Keyed by the version being migrated *from*.
   */
  migrations?: Record<number, (data: Record<string, unknown>) => Record<string, unknown>>;
}

/**
 * A versioned JSON file on disk. Reads are cached; writes are atomic (temp file plus
 * rename) so a crash mid-write cannot leave a truncated config behind.
 *
 * A file that cannot be read or parsed falls back to defaults rather than throwing —
 * a corrupt hosts.json must not stop the app from starting — and the bad file is left
 * in place to be inspected.
 */
export class JsonStore<T extends Versioned> {
  private cache: T | null = null;

  constructor(private readonly options: JsonStoreOptions<T>) {}

  get path(): string {
    return this.options.file;
  }

  async read(): Promise<T> {
    if (this.cache) return this.cache;

    try {
      const raw: unknown = JSON.parse(await readFile(this.options.file, 'utf8'));
      this.cache = this.options.normalise(this.migrate(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`NS3H: could not read ${this.options.file}:`, error);
      }
      this.cache = this.options.fallback;
    }
    return this.cache;
  }

  async write(value: T): Promise<T> {
    const normalised = this.options.normalise(value);
    this.cache = normalised;
    await mkdir(dirname(this.options.file), { recursive: true });
    const temp = `${this.options.file}.tmp`;
    await writeFile(temp, `${JSON.stringify(normalised, null, 2)}\n`, 'utf8');
    await rename(temp, this.options.file);
    return normalised;
  }

  /** Read, transform, write — the shape every CRUD operation takes. */
  async update(transform: (current: T) => T): Promise<T> {
    return this.write(transform(await this.read()));
  }

  /** Drops the cache so the next read hits disk. Used by tests and hand-edits. */
  invalidate(): void {
    this.cache = null;
  }

  private migrate(raw: unknown): unknown {
    const migrations = this.options.migrations;
    if (!migrations || typeof raw !== 'object' || raw === null) return raw;

    let data = raw as Record<string, unknown>;
    let version = typeof data.version === 'number' ? data.version : 0;

    while (migrations[version]) {
      data = migrations[version](data);
      const next = typeof data.version === 'number' ? data.version : version + 1;
      if (next <= version) break; // a migration that does not advance would loop
      version = next;
    }
    return data;
  }
}
