import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Settings } from '@shared/config.js';
import {
  disambiguate,
  quickFolderSegments,
  sanitiseDeviceFolder,
  sessionFileName,
} from './paths.js';
import { SessionLogWriter, type CryptoSummary, type SerialSummary } from './writer.js';

export interface SessionLogRequest {
  /** Absent for quick connections, which log under `_quick/<address>/`. */
  hostId?: string;
  name: string;
  address: string;
  port: number;
  protocol: string;
  user?: string;
  crypto?: CryptoSummary;
  serial?: SerialSummary;
}

interface FolderMeta {
  version: 1;
  hostId: string | null;
  /** Every name this folder has been known by, oldest first (§5.1). */
  names: { name: string; since: string }[];
}

export const META_FILE = '.meta.json';

async function readMeta(dir: string): Promise<FolderMeta | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(dir, META_FILE), 'utf8'));
    const meta = parsed as FolderMeta;
    return {
      version: 1,
      hostId: typeof meta?.hostId === 'string' ? meta.hostId : null,
      names: Array.isArray(meta?.names) ? meta.names : [],
    };
  } catch {
    return null;
  }
}

/**
 * Records which host a log folder belongs to, so old logs stay attributable after the
 * host is renamed. Renaming does not move existing logs — new sessions simply start
 * writing under the new name, and both folders carry the same host id.
 */
async function writeMeta(dir: string, hostId: string | null, name: string): Promise<void> {
  const existing = await readMeta(dir);
  const names = existing?.names ?? [];
  if (names.at(-1)?.name !== name) {
    names.push({ name, since: new Date().toISOString() });
  }
  const meta: FolderMeta = { version: 1, hostId: hostId ?? existing?.hostId ?? null, names };
  await writeFile(join(dir, META_FILE), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

/**
 * Decides where a session logs and opens the writer.
 *
 * Returns null when no log directory has been chosen — logging is blocked until the
 * user picks one (§4.3), and the UI says so rather than failing silently.
 */
export class LogService {
  constructor(private readonly readSettings: () => Promise<Settings>) {}

  async begin(request: SessionLogRequest, startedAt = new Date()): Promise<SessionLogWriter | null> {
    const { logDirectory } = await this.readSettings();
    if (!logDirectory) return null;

    const directory = await this.resolveDirectory(logDirectory, request);
    await mkdir(directory, { recursive: true });
    if (request.hostId) await writeMeta(directory, request.hostId, request.name);

    return SessionLogWriter.open(join(directory, sessionFileName(startedAt)), {
      host: `${request.name} (${request.address}:${request.port})`,
      protocol: request.protocol,
      user: request.user,
      started: startedAt,
      crypto: request.crypto,
      serial: request.serial,
    });
  }

  private async resolveDirectory(root: string, request: SessionLogRequest): Promise<string> {
    if (!request.hostId) {
      return join(root, ...quickFolderSegments(request.address));
    }

    const base = sanitiseDeviceFolder(request.name);
    const candidate = join(root, base);
    const meta = await readMeta(candidate);

    // Another host already owns this folder name — keep them apart.
    if (meta?.hostId && meta.hostId !== request.hostId) {
      return join(root, disambiguate(base, request.hostId));
    }
    return candidate;
  }
}

export { SessionLogWriter } from './writer.js';
export type { CryptoSummary, SerialSummary } from './writer.js';
