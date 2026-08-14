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
