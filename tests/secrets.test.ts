import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { SecretsStore, SecretsUnavailableError, type Vault } from '../src/main/secrets/store.js';
import { ConfigService } from '../src/main/store/index.js';
import type { Host } from '../src/shared/config.js';

/** Stands in for safeStorage: reversible, and obviously not real encryption. */
function fakeVault(available = true): Vault {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(`enc:${plain}`, 'utf8'),
    decryptString: (buffer) => buffer.toString('utf8').replace(/^enc:/, ''),
  };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ns3h-secrets-'));
});

describe('SecretsStore', () => {
  it('round-trips a secret and keeps the plaintext off disk', async () => {
    const store = new SecretsStore(join(dir, 'secrets.enc'), fakeVault());
    await store.set('crd_1', 'password', 'hunter2');

    expect(await store.get('crd_1', 'password')).toBe('hunter2');
    expect(await readFile(join(dir, 'secrets.enc'), 'utf8')).not.toContain('hunter2');
  });

  it('keys secrets by owner and kind', async () => {
    const store = new SecretsStore(join(dir, 'secrets.enc'), fakeVault());
    await store.set('crd_1', 'password', 'pw');
    await store.set('crd_1', 'passphrase', 'pp');
    expect(await store.get('crd_1', 'password')).toBe('pw');
    expect(await store.get('crd_1', 'passphrase')).toBe('pp');
    expect(await store.get('crd_2', 'password')).toBeNull();
  });

  it('clears one kind without touching the other', async () => {
    const store = new SecretsStore(join(dir, 'secrets.enc'), fakeVault());
    await store.set('crd_1', 'password', 'pw');
    await store.set('crd_1', 'passphrase', 'pp');
    await store.clear('crd_1', 'password');
    expect(await store.get('crd_1', 'password')).toBeNull();
    expect(await store.get('crd_1', 'passphrase')).toBe('pp');
  });

  it('forgets everything belonging to a deleted owner', async () => {
    const store = new SecretsStore(join(dir, 'secrets.enc'), fakeVault());
    await store.set('crd_1', 'password', 'pw');
    await store.set('crd_1', 'passphrase', 'pp');
    await store.set('crd_2', 'password', 'other');
    await store.forget('crd_1');
    expect(await store.has('crd_1', 'password')).toBe(false);
    expect(await store.has('crd_1', 'passphrase')).toBe(false);
    expect(await store.get('crd_2', 'password')).toBe('other');
  });

  it('refuses to write when the platform has no keychain', async () => {
    const store = new SecretsStore(join(dir, 'secrets.enc'), fakeVault(false));
    await expect(store.set('crd_1', 'password', 'hunter2')).rejects.toBeInstanceOf(
      SecretsUnavailableError,
    );
    expect(store.status().available).toBe(false);
    expect(store.status().reason).toMatch(/keyring|keychain/i);
  });

  it('survives a secret it cannot decrypt', async () => {
    const store = new SecretsStore(join(dir, 'secrets.enc'), {
      isEncryptionAvailable: () => true,
      encryptString: (plain) => Buffer.from(plain),
      decryptString: () => {
        throw new Error('keychain rotated');
      },
    });
    await store.set('crd_1', 'password', 'pw');
    expect(await store.get('crd_1', 'password')).toBeNull();
  });
});

describe('ConfigService', () => {
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

  it('persists hosts and credentials across a restart', async () => {
    const secrets = new SecretsStore(join(dir, 'secrets.enc'), fakeVault());
    const service = new ConfigService(secrets, dir);
    await service.saveHost(host());
    await service.saveCredential(
      { id: 'crd_1', name: 'Net admin', type: 'password', username: 'admin', keyPath: null, hasPassphrase: false },
      { password: 'hunter2' },
    );

    // A second service reading the same directory is what a restart looks like.
    const restarted = new ConfigService(
      new SecretsStore(join(dir, 'secrets.enc'), fakeVault()),
      dir,
    );
    // Assert the location, not just the round-trip: a service that ignored `dir`
    // would still round-trip correctly while writing to the user's real config.
    expect(JSON.parse(await readFile(join(dir, 'hosts.json'), 'utf8')).hosts).toHaveLength(1);
    expect(await readFile(join(dir, 'credentials.json'), 'utf8')).toContain('crd_1');

    const snapshot = await restarted.snapshot();
    expect(snapshot.hosts.hosts[0].name).toBe('core-sw-01');
    expect(snapshot.credentials.credentials[0].username).toBe('admin');
    expect(snapshot.secrets.available).toBe(true);
  });

  it('resolves a saved host into a target carrying its stored password', async () => {
    const secrets = new SecretsStore(join(dir, 'secrets.enc'), fakeVault());
    const service = new ConfigService(secrets, dir);
    await service.saveCredential(
      { id: 'crd_1', name: 'Net admin', type: 'password', username: 'admin', keyPath: null, hasPassphrase: false },
      { password: 'hunter2' },
    );
    await service.saveHost(host({ credentialId: 'crd_1' }));

    const target = await service.resolveTarget('hst_1');
    expect(target).toMatchObject({ address: '10.1.1.5', port: 22 });
    expect(target?.auth).toEqual({ kind: 'password', username: 'admin', password: 'hunter2' });
  });

  it('degrades to an inline prompt when the secret cannot be read', async () => {
    const service = new ConfigService(
      new SecretsStore(join(dir, 'secrets.enc'), fakeVault(false)),
      dir,
    );
    await service.saveCredential(
      { id: 'crd_1', name: 'Net admin', type: 'password', username: 'admin', keyPath: null, hasPassphrase: false },
      undefined,
    );
    await service.saveHost(host({ credentialId: 'crd_1' }));

    expect((await service.resolveTarget('hst_1'))?.auth).toEqual({
      kind: 'prompt',
      username: 'admin',
    });
  });

  it('stores an inline credential secret under the host id', async () => {
    const secrets = new SecretsStore(join(dir, 'secrets.enc'), fakeVault());
    const service = new ConfigService(secrets, dir);
    await service.saveHost(
      host({
        inlineCredential: { type: 'password', username: 'cisco', keyPath: null, hasPassphrase: false },
      }),
      { password: 'enable' },
    );

    expect(await secrets.get('hst_1', 'password')).toBe('enable');
    expect((await service.resolveTarget('hst_1'))?.auth).toEqual({
      kind: 'password',
      username: 'cisco',
      password: 'enable',
    });
  });

  it('clears secrets and detaches hosts when a credential is deleted', async () => {
    const secrets = new SecretsStore(join(dir, 'secrets.enc'), fakeVault());
    const service = new ConfigService(secrets, dir);
    await service.saveCredential(
      { id: 'crd_1', name: 'Net admin', type: 'password', username: 'admin', keyPath: null, hasPassphrase: false },
      { password: 'hunter2' },
    );
    await service.saveHost(host({ credentialId: 'crd_1' }));

    const snapshot = await service.deleteCredential('crd_1');
    expect(snapshot.credentials.credentials).toHaveLength(0);
    expect(snapshot.hosts.hosts[0].credentialId).toBeNull();
    expect(await secrets.get('crd_1', 'password')).toBeNull();
  });

  it('deletes a host along with its inline secret', async () => {
    const secrets = new SecretsStore(join(dir, 'secrets.enc'), fakeVault());
    const service = new ConfigService(secrets, dir);
    await service.saveHost(
      host({ inlineCredential: { type: 'password', username: 'cisco', keyPath: null, hasPassphrase: false } }),
      { password: 'enable' },
    );
    await service.deleteHost('hst_1');
    expect(await secrets.get('hst_1', 'password')).toBeNull();
  });

  it('treats an omitted secret as unchanged and an empty one as cleared', async () => {
    const secrets = new SecretsStore(join(dir, 'secrets.enc'), fakeVault());
    const service = new ConfigService(secrets, dir);
    const credential = {
      id: 'crd_1',
      name: 'Net admin',
      type: 'password' as const,
      username: 'admin',
      keyPath: null,
      hasPassphrase: false,
    };

    await service.saveCredential(credential, { password: 'hunter2' });
    await service.saveCredential({ ...credential, name: 'Renamed' });
    expect(await secrets.get('crd_1', 'password')).toBe('hunter2');

    await service.saveCredential(credential, { password: '' });
    expect(await secrets.get('crd_1', 'password')).toBeNull();
  });
});
