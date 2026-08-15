import { describe, expect, it } from 'vitest';
import {
  BUNDLE_MAGIC,
  decryptBundle,
  encryptBundle,
  identifyImport,
  type BundlePayload,
} from '../src/main/transfer/bundle.js';
import { applyImport, missingKeyPaths, planImport } from '../src/main/transfer/merge.js';
import { DEFAULT_SETTINGS, type Credential, type Host } from '../src/shared/config.js';

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

const credential = (over: Partial<Credential> = {}): Credential => ({
  id: 'crd_1',
  name: 'Network admin',
  type: 'password',
  username: 'admin',
  keyPath: null,
  hasPassphrase: false,
  ...over,
});

const payload = (): BundlePayload => ({
  hosts: { version: 1, folders: [], hosts: [host()] },
  settings: DEFAULT_SETTINGS,
  credentials: { version: 1, credentials: [credential()] },
  secrets: { 'crd_1:password': 'hunter2' },
});

describe('encrypted bundle', () => {
  it('round-trips through a passphrase', async () => {
    const bundle = await encryptBundle(payload(), 'correct horse');
    const restored = await decryptBundle(bundle, 'correct horse');

    expect(restored.hosts.hosts[0].name).toBe('core-sw-01');
    expect(restored.secrets['crd_1:password']).toBe('hunter2');
  }, 30_000);

  it('keeps the secrets out of the file', async () => {
    const bundle = await encryptBundle(payload(), 'pw');
    const serialised = JSON.stringify(bundle);
    expect(serialised).not.toContain('hunter2');
    expect(serialised).not.toContain('core-sw-01');
  }, 30_000);

  it('carries version, salt and nonce in the clear, as §7 specifies', async () => {
    const bundle = await encryptBundle(payload(), 'pw');
    expect(bundle.magic).toBe(BUNDLE_MAGIC);
    expect(bundle.version).toBe(1);
    expect(bundle.kdf).toMatchObject({ name: 'argon2id', memoryCost: 65_536, timeCost: 3, parallelism: 4 });
    expect(Buffer.from(bundle.kdf.salt, 'base64')).toHaveLength(16);
    expect(Buffer.from(bundle.nonce, 'base64')).toHaveLength(12);
    expect(bundle.cipher).toBe('aes-256-gcm');
  }, 30_000);

  it('refuses the wrong passphrase', async () => {
    const bundle = await encryptBundle(payload(), 'right');
    await expect(decryptBundle(bundle, 'wrong')).rejects.toThrow(/wrong passphrase/i);
  }, 60_000);

  it('refuses a file that has been altered', async () => {
    const bundle = await encryptBundle(payload(), 'pw');
    const raw = Buffer.from(bundle.ciphertext, 'base64');
    raw[0] ^= 0xff;
    const tampered = { ...bundle, ciphertext: raw.toString('base64') };
    await expect(decryptBundle(tampered, 'pw')).rejects.toThrow(/altered/i);
  }, 60_000);

  it('refuses a bundle from a newer format version', async () => {
    const bundle = await encryptBundle(payload(), 'pw');
    await expect(decryptBundle({ ...bundle, version: 99 }, 'pw')).rejects.toThrow(/newer version/i);
  }, 30_000);

  it('uses a fresh salt and nonce every time', async () => {
    const first = await encryptBundle(payload(), 'pw');
    const second = await encryptBundle(payload(), 'pw');
    expect(first.kdf.salt).not.toBe(second.kdf.salt);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  }, 60_000);
});

describe('identifying an import', () => {
  it('recognises both formats', async () => {
    const bundle = await encryptBundle(payload(), 'pw');
    expect(identifyImport(JSON.stringify(bundle)).kind).toBe('bundle');

    const config = { format: 'ns3h-config', version: 1, exportedAt: '', hosts: {}, settings: {} };
    expect(identifyImport(JSON.stringify(config)).kind).toBe('config');
  }, 30_000);

  it('rejects anything else with a plain explanation', () => {
    expect(() => identifyImport('not json')).toThrow(/valid JSON/i);
    expect(() => identifyImport('{"hello":true}')).toThrow(/neither/i);
  });
});

describe('merging an import', () => {
  const current = {
    hosts: { version: 1 as const, folders: [], hosts: [host({ name: 'existing name' })] },
    credentials: { version: 1 as const, credentials: [credential()] },
  };

  it('counts what is new and reports what collides', () => {
    const plan = planImport(current, {
      hosts: { version: 1, folders: [], hosts: [host({ name: 'incoming name' }), host({ id: 'hst_2' })] },
      credentials: { version: 1, credentials: [credential({ id: 'crd_2' })] },
    });

    expect(plan.added).toEqual({ hosts: 1, folders: 0, credentials: 1 });
    expect(plan.collisions).toHaveLength(1);
    expect(plan.collisions[0]).toMatchObject({ kind: 'host', id: 'hst_1' });
    expect(plan.collisions[0].existing).toContain('existing name');
    expect(plan.collisions[0].incoming).toContain('incoming name');
  });

  it('never clobbers a collision that was not approved', () => {
    const merged = applyImport(
      current,
      { hosts: { version: 1, folders: [], hosts: [host({ name: 'incoming name' })] } },
      {},
    );
    expect(merged.hosts.hosts[0].name).toBe('existing name');
  });

  it('overwrites only the items the user approved', () => {
    const merged = applyImport(
      current,
      {
        hosts: {
          version: 1,
          folders: [],
          hosts: [host({ name: 'incoming name' }), host({ id: 'hst_2', name: 'new' })],
        },
      },
      { hst_1: true },
    );
    expect(merged.hosts.hosts.find((h) => h.id === 'hst_1')?.name).toBe('incoming name');
    expect(merged.hosts.hosts).toHaveLength(2);
  });

  it('adds new items regardless of resolutions', () => {
    const merged = applyImport(
      current,
      { credentials: { version: 1, credentials: [credential({ id: 'crd_2', name: 'Other' })] } },
      {},
    );
    expect(merged.credentials.credentials).toHaveLength(2);
  });
});

describe('missing key files', () => {
  it('flags a key credential whose file is not there', () => {
    const flagged = missingKeyPaths(
      [
        credential({ id: 'a', type: 'key', keyPath: '/home/will/.ssh/id_ed25519' }),
        credential({ id: 'b', type: 'key', keyPath: '/gone/id_rsa' }),
        credential({ id: 'c' }),
      ],
      (path) => path.startsWith('/home/will'),
    );
    expect(flagged.map((c) => c.id)).toEqual(['b']);
  });
});
