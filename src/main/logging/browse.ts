import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { META_FILE } from './index.js';

export interface LogFolderInfo {
  /** Directory name under the log root — also the identifier used to list sessions. */
  name: string;
  /** The friendly name at the time of writing, from .meta.json. */
  displayName: string;
  hostId: string | null;
  sessions: number;
  totalBytes: number;
  /** ISO timestamp of the most recent session, or null when the folder is empty. */
  lastSession: string | null;
}

export interface LogFileInfo {
  name: string;
  path: string;
  bytes: number;
  modified: string;
}

/**
 * A folder name is used to build a path, so it must be a single path segment. Anything
 * with a separator, a drive letter, or `..` is refused rather than resolved.
 */
export function isSafeSegment(segment: string): boolean {
  if (!segment || segment === '.' || segment === '..') return false;
  return !/[/\\]/.test(segment) && !/^[a-zA-Z]:/.test(segment);
}

/** Quick connections live one level down, under `_quick/<address>/`. */
const QUICK = '_quick';

export async function listLogFolders(root: string | null): Promise<LogFolderInfo[]> {
  if (!root) return [];

  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }

  const folders: LogFolderInfo[] = [];
  for (const entry of entries) {
    const path = join(root, entry);
    try {
      if (!(await stat(path)).isDirectory()) continue;
    } catch {
      continue;
    }

    if (entry === QUICK) {
      for (const address of await readdir(path).catch(() => [])) {
        const info = await describeFolder(join(path, address), `${QUICK}/${address}`);
        if (info) folders.push({ ...info, displayName: `${address} (quick)` });
      }
      continue;
    }

    const info = await describeFolder(path, entry);
    if (info) folders.push(info);
  }

  return folders.sort((a, b) => (b.lastSession ?? '').localeCompare(a.lastSession ?? ''));
}

async function describeFolder(path: string, name: string): Promise<LogFolderInfo | null> {
  let files: string[];
  try {
    files = await readdir(path);
  } catch {
    return null;
  }

  let sessions = 0;
  let totalBytes = 0;
  let lastSession: string | null = null;

  for (const file of files) {
    if (!file.endsWith('.log')) continue;
    try {
      const info = await stat(join(path, file));
      sessions += 1;
      totalBytes += info.size;
      const modified = info.mtime.toISOString();
      if (!lastSession || modified > lastSession) lastSession = modified;
    } catch {
      // A file that vanished between readdir and stat is not worth failing over.
    }
  }

  let hostId: string | null = null;
  let displayName = name;
  try {
    const meta = JSON.parse(await readFile(join(path, META_FILE), 'utf8'));
    hostId = typeof meta?.hostId === 'string' ? meta.hostId : null;
    const latest = Array.isArray(meta?.names) ? meta.names.at(-1)?.name : null;
    if (typeof latest === 'string' && latest) displayName = latest;
  } catch {
    // No meta: a quick-connect folder, or one written by hand.
  }

  return { name, displayName, hostId, sessions, totalBytes, lastSession };
}

export async function listLogSessions(
  root: string | null,
  folder: string,
): Promise<LogFileInfo[]> {
  if (!root) return [];

  const segments = folder.split('/');
  if (!segments.every(isSafeSegment)) {
    throw new Error('Invalid log folder.');
  }

  const path = join(root, ...segments);
  const files: LogFileInfo[] = [];
  for (const file of await readdir(path).catch(() => [])) {
    if (!file.endsWith('.log')) continue;
    try {
      const info = await stat(join(path, file));
      files.push({
        name: file,
        path: join(path, file),
        bytes: info.size,
        modified: info.mtime.toISOString(),
      });
    } catch {
      continue;
    }
  }

  return files.sort((a, b) => b.name.localeCompare(a.name));
}
