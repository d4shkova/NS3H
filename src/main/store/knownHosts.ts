import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ConfigFile, configPath } from './paths.js';

export interface KnownHostEntry {
  address: string;
  port: number;
  keyType: string;
  fingerprint: string;
  acceptedAt: string;
}

export interface KnownHostsFile {
  version: 1;
  entries: KnownHostEntry[];
}

export const EMPTY_KNOWN_HOSTS: KnownHostsFile = { version: 1, entries: [] };

/** Keyed on address:port, not friendly name, so a renamed host keeps its trust. */
export function findEntry(
  file: KnownHostsFile,
  address: string,
  port: number,
): KnownHostEntry | undefined {
  return file.entries.find((entry) => entry.address === address && entry.port === port);
}

export type HostKeyVerdict =
  | { kind: 'trusted'; entry: KnownHostEntry }
  | { kind: 'unknown' }
  | { kind: 'changed'; previous: KnownHostEntry };

export function verifyHostKey(
  file: KnownHostsFile,
  address: string,
  port: number,
  fingerprint: string,
): HostKeyVerdict {
  const entry = findEntry(file, address, port);
  if (!entry) return { kind: 'unknown' };
  if (entry.fingerprint === fingerprint) return { kind: 'trusted', entry };
  return { kind: 'changed', previous: entry };
}

/** Returns a new file object; accepting a changed key overwrites the stored one. */
export function upsertEntry(file: KnownHostsFile, entry: KnownHostEntry): KnownHostsFile {
  const rest = file.entries.filter(
    (existing) => !(existing.address === entry.address && existing.port === entry.port),
  );
  return { version: 1, entries: [...rest, entry] };
}

export function parseKnownHosts(raw: string): KnownHostsFile {
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as KnownHostsFile).entries)
  ) {
    throw new Error('known-hosts.json is not in the expected shape');
  }
  const entries = (parsed as KnownHostsFile).entries.filter(
    (entry) =>
      typeof entry?.address === 'string' &&
      typeof entry?.port === 'number' &&
      typeof entry?.fingerprint === 'string',
  );
  return { version: 1, entries };
}

export class KnownHostsStore {
  private cache: KnownHostsFile | null = null;

  constructor(private readonly file: string = configPath(ConfigFile.knownHosts)) {}

  async read(): Promise<KnownHostsFile> {
    if (this.cache) return this.cache;
    try {
      this.cache = parseKnownHosts(await readFile(this.file, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // A corrupt file must not lock the user out of every host; start clean but
        // leave the bad file in place so it can be inspected.
        console.error(`NS3H: could not read ${this.file}:`, error);
      }
      this.cache = EMPTY_KNOWN_HOSTS;
    }
    return this.cache;
  }

  async accept(entry: KnownHostEntry): Promise<void> {
    const next = upsertEntry(await this.read(), entry);
    this.cache = next;
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  }
}
