import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  deleteLogFolder,
  deleteLogSession,
  isSafeSegment,
  listLogFolders,
  listLogSessions,
} from '../src/main/logging/browse.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ns3h-browse-'));
});

async function seed(folder: string, files: Record<string, string>, meta?: object) {
  const path = join(dir, ...folder.split('/'));
  await mkdir(path, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(path, name), body, 'utf8');
  }
  if (meta) await writeFile(join(path, '.meta.json'), JSON.stringify(meta), 'utf8');
}

describe('folder listing', () => {
  it('returns nothing when no log directory is set', async () => {
    expect(await listLogFolders(null)).toEqual([]);
  });

  it('summarises each device folder', async () => {
    await seed(
      'core-sw-01',
      { '2026-08-14_101500.log': 'a'.repeat(100), '2026-08-14_143022.log': 'b'.repeat(50) },
      { version: 1, hostId: 'hst_c3d4', names: [{ name: 'core-sw-01', since: '2026-08-14' }] },
    );

    const [folder] = await listLogFolders(dir);
    expect(folder).toMatchObject({
      name: 'core-sw-01',
      displayName: 'core-sw-01',
      hostId: 'hst_c3d4',
      sessions: 2,
      totalBytes: 150,
    });
    expect(folder.lastSession).not.toBeNull();
  });

  it('shows the current name of a renamed host, not the folder name', async () => {
    await seed(
      'core-sw-01',
      { '2026-08-14_101500.log': 'x' },
      {
        version: 1,
        hostId: 'hst_c3d4',
        names: [
          { name: 'core-sw-01', since: '2026-01-01' },
          { name: 'dist-sw-01', since: '2026-08-01' },
        ],
      },
    );

    const [folder] = await listLogFolders(dir);
    expect(folder.displayName).toBe('dist-sw-01');
    expect(folder.name).toBe('core-sw-01');
  });

  it('descends into _quick and labels those folders', async () => {
    await seed('_quick/10.1.1.99', { '2026-08-14_150200.log': 'x' });
    const [folder] = await listLogFolders(dir);
    expect(folder.name).toBe('_quick/10.1.1.99');
    expect(folder.displayName).toBe('10.1.1.99 (quick)');
  });

  it('ignores files that are not logs', async () => {
    await seed('core-sw-01', { 'notes.txt': 'x', '2026-08-14_101500.log': 'y' });
    expect((await listLogFolders(dir))[0].sessions).toBe(1);
  });

  it('survives a log directory that does not exist', async () => {
    expect(await listLogFolders(join(dir, 'missing'))).toEqual([]);
  });
});

describe('session listing', () => {
  it('lists a folder newest first', async () => {
    await seed('core-sw-01', {
      '2026-08-14_101500.log': 'a',
      '2026-08-15_090000.log': 'bb',
    });
    const sessions = await listLogSessions(dir, 'core-sw-01');
    expect(sessions.map((s) => s.name)).toEqual([
      '2026-08-15_090000.log',
      '2026-08-14_101500.log',
    ]);
    expect(sessions[0].bytes).toBe(2);
  });

  it('refuses a folder name that would escape the log directory', async () => {
    for (const bad of ['../etc', '..', 'a/../../b', '/etc', 'C:\\Windows']) {
      await expect(listLogSessions(dir, bad)).rejects.toThrow(/invalid/i);
    }
  });

  it('accepts the nested _quick path, which is the one legitimate separator', async () => {
    await seed('_quick/10.1.1.99', { '2026-08-14_150200.log': 'x' });
    expect(await listLogSessions(dir, '_quick/10.1.1.99')).toHaveLength(1);
  });

  it('judges path segments directly', () => {
    expect(isSafeSegment('core-sw-01')).toBe(true);
    expect(isSafeSegment('..')).toBe(false);
    expect(isSafeSegment('a/b')).toBe(false);
    expect(isSafeSegment('')).toBe(false);
  });
});

describe('deleting logs', () => {
  it('removes one session and leaves the rest of the folder alone', async () => {
    await seed(
      'core-sw-01',
      { '2026-08-14_101500.log': 'a', '2026-08-15_090000.log': 'bb' },
      { version: 1, hostId: 'hst_c3d4', names: [{ name: 'core-sw-01', since: '2026-08-14' }] },
    );

    const removed = await deleteLogSession(dir, 'core-sw-01', '2026-08-14_101500.log');
    expect(removed).toBe(join(dir, 'core-sw-01', '2026-08-14_101500.log'));

    const remaining = await listLogSessions(dir, 'core-sw-01');
    expect(remaining.map((session) => session.name)).toEqual(['2026-08-15_090000.log']);
    // The folder keeps its identity, so what is left is still attributable to the host.
    expect((await listLogFolders(dir))[0].hostId).toBe('hst_c3d4');
  });

  it('removes a device folder and everything in it', async () => {
    await seed('core-sw-01', { '2026-08-14_101500.log': 'a' });
    await seed('dist-sw-02', { '2026-08-14_101500.log': 'b' });

    await deleteLogFolder(dir, 'core-sw-01');
    expect((await listLogFolders(dir)).map((folder) => folder.name)).toEqual(['dist-sw-02']);
  });

  it('removes a quick-connect folder by its nested name', async () => {
    await seed('_quick/10.1.1.99', { '2026-08-14_150200.log': 'x' });
    await deleteLogFolder(dir, '_quick/10.1.1.99');
    expect(await listLogFolders(dir)).toEqual([]);
  });

  it('refuses a folder that would escape the log directory', async () => {
    for (const bad of ['../etc', '..', 'a/../../b', '/etc', 'C:\\Windows']) {
      await expect(deleteLogFolder(dir, bad)).rejects.toThrow(/invalid/i);
      await expect(deleteLogSession(dir, bad, '2026-08-14_101500.log')).rejects.toThrow(
        /invalid/i,
      );
    }
  });

  it('deletes session logs only — not the folder metadata, and not a traversal', async () => {
    await seed(
      'core-sw-01',
      { '2026-08-14_101500.log': 'a' },
      { version: 1, hostId: 'hst_c3d4', names: [] },
    );

    for (const bad of ['.meta.json', '../core-sw-01/2026-08-14_101500.log', 'notes.txt', '']) {
      await expect(deleteLogSession(dir, 'core-sw-01', bad)).rejects.toThrow(/invalid/i);
    }
    expect(await listLogSessions(dir, 'core-sw-01')).toHaveLength(1);
    expect((await listLogFolders(dir))[0].hostId).toBe('hst_c3d4');
  });

  it('says so when there is no log directory at all', async () => {
    await expect(deleteLogFolder(null, 'core-sw-01')).rejects.toThrow(/log directory/i);
    await expect(deleteLogSession(null, 'core-sw-01', 'x.log')).rejects.toThrow(/log directory/i);
  });
});
