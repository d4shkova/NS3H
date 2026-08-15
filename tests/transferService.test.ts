import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { SecretsStore, type Vault } from '../src/main/secrets/store.js';
import { ConfigService } from '../src/main/store/index.js';
import { TransferService, bundleFileName, configFileName } from '../src/main/transfer/index.js';
import type { Host } from '../src/shared/config.js';

const vault = (): Vault => ({
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`enc:${plain}`, 'utf8'),
  decryptString: (buffer) => buffer.toString('utf8').replace(/^enc:/, ''),
});

const host = (over: Partial<Host> = {}): Host => ({
  id: 'hst_1',
  name: 'core-sw-01',
  protocol: 'ssh',
  folderId: null,
  address: '10.1.1.5',
  port: 22,
  credentialId: 'crd_1',
  inlineCredential: null,
  logging: true,
  serial: null,
  createdAt: '2026-08-14T10:00:00Z',
  ...over,
});

const credential = {
  id: 'crd_1',
  name: 'Network admin',
  type: 'password' as const,
  username: 'admin',
  keyPath: null,
  hasPassphrase: false,
};

async function machine(): Promise<{ dir: string; config: ConfigService; secrets: SecretsStore; transfer: TransferService }> {
  const dir = await mkdtemp(join(tmpdir(), 'ns3h-machine-'));
  const secrets = new SecretsStore(join(dir, 'secrets.enc'), vault());
  const config = new ConfigService(secrets, dir);
  return { dir, config, secrets, transfer: new TransferService(config, secrets) };
}

let a: Awaited<ReturnType<typeof machine>>;
let b: Awaited<ReturnType<typeof machine>>;

beforeEach(async () => {
  a = await machine();
  b = await machine();
  await a.config.saveFolder({ id: 'fld_1', name: 'Datacenter', parentId: null });
  await a.config.saveCredential(credential, { password: 'hunter2' });
  await a.config.saveHost(host());
});

describe('file names', () => {
  it('follows §7', () => {
    const date = new Date(2026, 7, 14);
    expect(configFileName(date)).toMatch(/^ns3h-config-\d{4}-\d{2}-\d{2}\.json$/);
    expect(bundleFileName(date)).toMatch(/^ns3h-backup-\d{4}-\d{2}-\d{2}\.ns3h$/);
  });
});

describe('configuration export', () => {
  it('carries hosts and settings but no credentials or secrets', async () => {
    const path = join(a.dir, 'config.json');
    await a.transfer.exportConfig(path);
    const text = await readFile(path, 'utf8');

    expect(text).toContain('core-sw-01');
    expect(text).toContain('Datacenter');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('Network admin');
    expect(JSON.parse(text).credentials).toBeUndefined();
  });

  it('imports onto a second machine', async () => {
    const path = join(a.dir, 'config.json');
    await a.transfer.exportConfig(path);

    const preview = await b.transfer.preview(path);
    expect(preview.kind).toBe('config');
    expect(preview.added.hosts).toBe(1);
    expect(preview.collisions).toHaveLength(0);

    const snapshot = await b.transfer.apply({ path });
    expect(snapshot.hosts.hosts[0].name).toBe('core-sw-01');
    expect(snapshot.hosts.folders[0].name).toBe('Datacenter');
    expect(snapshot.credentials.credentials).toHaveLength(0);
  });
});

describe('encrypted backup', () => {
  it('restores credentials and their secrets on the second machine', async () => {
    const path = join(a.dir, 'backup.ns3h');
    await a.transfer.exportBundle(path, 'correct horse');

    const locked = await b.transfer.preview(path);
    expect(locked.needsPassphrase).toBe(true);

    const preview = await b.transfer.preview(path, 'correct horse');
    expect(preview.added).toEqual({ hosts: 1, folders: 1, credentials: 1 });

    const snapshot = await b.transfer.apply({ path, passphrase: 'correct horse' });
    expect(snapshot.credentials.credentials[0].name).toBe('Network admin');
    expect(await b.secrets.get('crd_1', 'password')).toBe('hunter2');

    // And the restored host connects with the restored secret.
    const resolved = await b.config.resolveHost('hst_1');
    expect(resolved?.kind).toBe('ssh');
    if (resolved?.kind === 'ssh') {
      expect(resolved.target.auth).toEqual({
        kind: 'password',
        username: 'admin',
        password: 'hunter2',
      });
    }
  }, 60_000);

  it('refuses the wrong passphrase rather than importing nothing quietly', async () => {
    const path = join(a.dir, 'backup.ns3h');
    await a.transfer.exportBundle(path, 'right');
    await expect(b.transfer.preview(path, 'wrong')).rejects.toThrow(/wrong passphrase/i);
  }, 60_000);
});

describe('merging into an existing config', () => {
  it('keeps what is here unless the collision is approved', async () => {
    await b.config.saveHost(host({ name: 'local name' }));
    const path = join(a.dir, 'config.json');
    await a.transfer.exportConfig(path);

    const preview = await b.transfer.preview(path);
    expect(preview.collisions).toHaveLength(1);

    const kept = await b.transfer.apply({ path });
    expect(kept.hosts.hosts[0].name).toBe('local name');

    const replaced = await b.transfer.apply({ path, resolutions: { hst_1: true } });
    expect(replaced.hosts.hosts[0].name).toBe('core-sw-01');
  });

  it('flags a credential whose key file is missing here', async () => {
    await a.config.saveCredential({
      id: 'crd_key',
      name: 'Linux key',
      type: 'key',
      username: 'will',
      keyPath: '/nowhere/id_ed25519',
      hasPassphrase: false,
    });
    const path = join(a.dir, 'backup.ns3h');
    await a.transfer.exportBundle(path, 'pw');

    const preview = await b.transfer.preview(path, 'pw');
    expect(preview.missingKeys.map((k) => k.id)).toEqual(['crd_key']);
  }, 60_000);

  it('rejects a file that is neither format', async () => {
    const path = join(a.dir, 'random.json');
    await writeFile(path, '{"something":"else"}', 'utf8');
    await expect(b.transfer.preview(path)).rejects.toThrow(/neither/i);
  });
});
