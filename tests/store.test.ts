import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { JsonStore } from '../src/main/store/jsonStore.js';
import {
  createHostsStore,
  detachCredential,
  normaliseHostsFile,
  removeFolder,
  upsertHost,
} from '../src/main/store/hosts.js';
import { normaliseCredentialsFile } from '../src/main/store/credentials.js';
import { applySettings, normaliseSettings } from '../src/main/store/settings.js';
import { DEFAULT_SETTINGS, type Host, type HostsFile } from '../src/shared/config.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ns3h-store-'));
});

const host = (over: Partial<Host> = {}): Host => ({
  id: 'hst_1',
  name: 'core-sw-01',
  protocol: 'ssh',
  folderId: null,
  address: '10.1.1.5',
  port: 22,
  credentialId: null,
  inlineCredential: null,
  logging: true,
  favorite: false,
  serial: null,
  createdAt: '2026-08-14T10:00:00Z',
  ...over,
});

describe('JsonStore', () => {
  it('round-trips through disk', async () => {
    const store = createHostsStore(dir);
    await store.update((file) => upsertHost(file, host()));

    const reread = createHostsStore(dir);
    expect((await reread.read()).hosts[0].name).toBe('core-sw-01');
  });

  it('writes atomically, leaving no partial file behind', async () => {
    const store = createHostsStore(dir);
    await store.update((file) => upsertHost(file, host()));
    const raw = await readFile(join(dir, 'hosts.json'), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    await expect(readFile(join(dir, 'hosts.json.tmp'), 'utf8')).rejects.toThrow();
  });

  it('falls back to defaults rather than throwing on a corrupt file', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'hosts.json'), '{ this is not json', 'utf8');
    expect((await createHostsStore(dir).read()).hosts).toEqual([]);
  });

  it('runs migrations in order until the version stops advancing', async () => {
    await writeFile(join(dir, 'thing.json'), JSON.stringify({ version: 1, value: 'a' }), 'utf8');

    const store = new JsonStore<{ version: number; value: string }>({
      file: join(dir, 'thing.json'),
      fallback: { version: 3, value: '' },
      normalise: (raw) => raw as { version: number; value: string },
      migrations: {
        1: (data) => ({ ...data, version: 2, value: `${data.value as string}b` }),
        2: (data) => ({ ...data, version: 3, value: `${data.value as string}c` }),
      },
    });

    expect(await store.read()).toEqual({ version: 3, value: 'abc' });
  });

  it('does not loop on a migration that fails to advance the version', async () => {
    await writeFile(join(dir, 'stuck.json'), JSON.stringify({ version: 1 }), 'utf8');
    const store = new JsonStore<{ version: number }>({
      file: join(dir, 'stuck.json'),
      fallback: { version: 1 },
      normalise: (raw) => raw as { version: number },
      migrations: { 1: (data) => ({ ...data, version: 1 }) },
    });
    expect(await store.read()).toEqual({ version: 1 });
  });
});

describe('hosts file', () => {
  it('drops entries without an id and defaults logging to on', () => {
    const file = normaliseHostsFile({
      version: 1,
      folders: [],
      hosts: [{ name: 'no id' }, { id: 'hst_2', name: 'keep' }],
    });
    expect(file.hosts).toHaveLength(1);
    expect(file.hosts[0].logging).toBe(true);
  });

  it('keeps credentialId and inlineCredential mutually exclusive', () => {
    const file = normaliseHostsFile({
      version: 1,
      folders: [],
      hosts: [
        {
          id: 'hst_3',
          credentialId: 'crd_1',
          inlineCredential: { type: 'password', username: 'admin' },
        },
      ],
    });
    expect(file.hosts[0].credentialId).toBe('crd_1');
    expect(file.hosts[0].inlineCredential).toBeNull();
  });

  it('re-parents hosts and folders whose folder no longer exists', () => {
    const file = normaliseHostsFile({
      version: 1,
      folders: [{ id: 'fld_1', name: 'Datacenter', parentId: 'fld_gone' }],
      hosts: [{ id: 'hst_4', folderId: 'fld_gone' }],
    });
    expect(file.folders[0].parentId).toBeNull();
    expect(file.hosts[0].folderId).toBeNull();
  });

  it('keeps hosts when their folder is deleted', () => {
    const file: HostsFile = {
      version: 1,
      folders: [
        { id: 'fld_1', name: 'DC', parentId: null },
        { id: 'fld_2', name: 'Nested', parentId: 'fld_1' },
      ],
      hosts: [host({ folderId: 'fld_1' })],
    };
    const after = removeFolder(file, 'fld_1');
    expect(after.hosts).toHaveLength(1);
    expect(after.hosts[0].folderId).toBeNull();
    expect(after.folders.find((f) => f.id === 'fld_2')?.parentId).toBeNull();
  });

  it('detaches hosts from a deleted credential', () => {
    const file: HostsFile = {
      version: 1,
      folders: [],
      hosts: [host({ credentialId: 'crd_1' })],
    };
    expect(detachCredential(file, 'crd_1').hosts[0].credentialId).toBeNull();
  });

  it('only keeps serial settings for serial hosts', () => {
    const file = normaliseHostsFile({
      version: 1,
      folders: [],
      hosts: [
        { id: 'a', protocol: 'ssh', serial: { path: '/dev/ttyUSB0' } },
        { id: 'b', protocol: 'serial', serial: { path: '/dev/ttyUSB0' } },
      ],
    });
    expect(file.hosts[0].serial).toBeNull();
    expect(file.hosts[1].serial).toMatchObject({ path: '/dev/ttyUSB0', baudRate: 9600, dataBits: 8 });
  });
});

describe('credentials file', () => {
  it('never carries a secret field through normalisation', () => {
    const file = normaliseCredentialsFile({
      version: 1,
      credentials: [
        { id: 'crd_1', name: 'Net admin', type: 'password', username: 'admin', password: 'oops' },
      ],
    });
    expect(JSON.stringify(file)).not.toContain('oops');
    expect(Object.keys(file.credentials[0])).toEqual([
      'id',
      'name',
      'type',
      'username',
      'keyPath',
      'hasPassphrase',
    ]);
  });

  it('drops a key path on a password credential', () => {
    const file = normaliseCredentialsFile({
      version: 1,
      credentials: [{ id: 'crd_2', type: 'password', keyPath: '/home/will/.ssh/id_rsa' }],
    });
    expect(file.credentials[0].keyPath).toBeNull();
  });
});

describe('settings', () => {
  it('starts with no log directory so first run can prompt', () => {
    expect(normaliseSettings({}).logDirectory).toBeNull();
    expect(DEFAULT_SETTINGS.logDirectory).toBeNull();
  });

  it('clamps the sidebar to its draggable range', () => {
    expect(applySettings(DEFAULT_SETTINGS, { sidebarWidth: 90 }).sidebarWidth).toBe(35);
    expect(applySettings(DEFAULT_SETTINGS, { sidebarWidth: 2 }).sidebarWidth).toBe(15);
  });

  it('merges a patch without dropping untouched fields', () => {
    const next = applySettings(DEFAULT_SETTINGS, { logDirectory: '/home/will/ns3h-logs' });
    expect(next.logDirectory).toBe('/home/will/ns3h-logs');
    expect(next.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
  });
});

describe('folded host folders', () => {
  it('remembers which folders were shut', () => {
    expect(normaliseSettings({ collapsedFolders: ['fld_1', 'fld_2'] }).collapsedFolders).toEqual([
      'fld_1',
      'fld_2',
    ]);
  });

  it('starts with everything open', () => {
    // Collapsed rather than expanded, so an untouched install stores nothing at all.
    expect(normaliseSettings({}).collapsedFolders).toEqual([]);
  });

  it('cleans up what a hand-edited file might contain', () => {
    const settings = normaliseSettings({
      collapsedFolders: ['fld_1', 'fld_1', '', 42, null, { id: 'fld_2' }, 'fld_3'],
    });
    // Duplicates and anything that is not a usable id are dropped, order preserved.
    expect(settings.collapsedFolders).toEqual(['fld_1', 'fld_3']);
  });

  it('refuses to grow without limit', () => {
    const many = Array.from({ length: 900 }, (_, index) => `fld_${index}`);
    expect(normaliseSettings({ collapsedFolders: many }).collapsedFolders).toHaveLength(500);
  });

  it('is not a list of folders that exist, and does not pretend to be', () => {
    // A folder can come back on an import; it should come back folded as it was left.
    expect(normaliseSettings({ collapsedFolders: ['gone'] }).collapsedFolders).toEqual(['gone']);
  });
});

describe('favourites', () => {
  it('is off for a host from before favourites existed', () => {
    const file = normaliseHostsFile({ version: 1, folders: [], hosts: [{ id: 'hst_1' }] });
    expect(file.hosts[0].favorite).toBe(false);
  });

  it('survives a round trip through the file', () => {
    const file = normaliseHostsFile({
      version: 1,
      folders: [],
      hosts: [{ id: 'hst_1', favorite: true }, { id: 'hst_2', favorite: 'yes' }],
    });
    expect(file.hosts[0].favorite).toBe(true);
    // Only a real true counts — a hand-edited file does not get to be almost right.
    expect(file.hosts[1].favorite).toBe(false);
  });
});

describe('how often a host is connected to', () => {
  it('starts empty', () => {
    expect(normaliseSettings({}).hostUsage).toEqual({});
  });

  it('keeps counts and their timestamps', () => {
    const usage = normaliseSettings({
      hostUsage: { hst_1: { count: 3, lastAt: '2026-08-14T10:00:00Z' } },
    }).hostUsage;
    expect(usage.hst_1).toEqual({ count: 3, lastAt: '2026-08-14T10:00:00Z' });
  });

  it('drops what a hand-edited file might contain', () => {
    const usage = normaliseSettings({
      hostUsage: {
        good: { count: 2, lastAt: '2026-08-14T10:00:00Z' },
        fractional: { count: 2.7 },
        negative: { count: -5 },
        zero: { count: 0 },
        wrong: 'nonsense',
        empty: null,
      },
    }).hostUsage;

    expect(Object.keys(usage).sort()).toEqual(['fractional', 'good']);
    expect(usage.fractional).toEqual({ count: 2, lastAt: '' });
  });

  it('refuses to grow without limit, keeping the busiest', () => {
    const many = Object.fromEntries(
      Array.from({ length: 900 }, (_, index) => [`hst_${index}`, { count: index + 1 }]),
    );
    const usage = normaliseSettings({ hostUsage: many }).hostUsage;
    expect(Object.keys(usage)).toHaveLength(500);
    expect(usage.hst_899).toBeDefined();
    expect(usage.hst_0).toBeUndefined();
  });

  it('is patched wholesale, the way the renderer sends it', () => {
    const next = applySettings(
      normaliseSettings({ hostUsage: { hst_1: { count: 1, lastAt: 'a' } } }),
      { hostUsage: { hst_1: { count: 2, lastAt: 'b' } } },
    );
    expect(next.hostUsage).toEqual({ hst_1: { count: 2, lastAt: 'b' } });
  });
});

describe('the sidebar lists', () => {
  it('shows both on an install that has never opened Settings', () => {
    const settings = normaliseSettings({});
    expect(settings.showFrequentHosts).toBe(true);
    expect(settings.showFavoriteHosts).toBe(true);
  });

  it('remembers a list that was switched off', () => {
    const settings = normaliseSettings({ showFrequentHosts: false, showFavoriteHosts: true });
    expect(settings.showFrequentHosts).toBe(false);
    expect(settings.showFavoriteHosts).toBe(true);
  });

  it('takes only a real false from a hand-edited file', () => {
    const settings = normaliseSettings({ showFrequentHosts: 'no', showFavoriteHosts: 0 });
    expect(settings.showFrequentHosts).toBe(true);
    expect(settings.showFavoriteHosts).toBe(true);
  });
});

describe('resetting the frequent list', () => {
  it('forgets every count', () => {
    const current = normaliseSettings({
      hostUsage: { hst_1: { count: 4, lastAt: 'a' }, hst_2: { count: 9, lastAt: 'b' } },
    });
    expect(applySettings(current, { hostUsage: {} }).hostUsage).toEqual({});
  });

  it('leaves the rest of the settings alone', () => {
    const current = normaliseSettings({
      hostUsage: { hst_1: { count: 4, lastAt: 'a' } },
      collapsedFolders: ['fld_1'],
      showFavoriteHosts: false,
      theme: 'skifer',
    });
    const next = applySettings(current, { hostUsage: {} });
    expect(next.collapsedFolders).toEqual(['fld_1']);
    expect(next.showFavoriteHosts).toBe(false);
    expect(next.theme).toBe('skifer');
  });
});
