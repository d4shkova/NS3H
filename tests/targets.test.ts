import { describe, expect, it, vi } from 'vitest';
import type { SshAuth } from '../src/shared/types.js';
import { parseTarget } from '../src/main/ipc/targets.js';

/** Stands in for the credential store, which needs a keychain to be real. */
const resolver = (auth: SshAuth | null) => vi.fn(async () => auth);

const base = { name: '', address: '10.1.1.5', port: 22 };

describe('parsing an SSH target', () => {
  it('passes a typed username and password through', async () => {
    const resolve = resolver(null);
    const target = await parseTarget(
      { ...base, auth: { kind: 'password', username: 'will', password: 'hunter2' } },
      resolve,
    );

    expect(target.auth).toEqual({ kind: 'password', username: 'will', password: 'hunter2' });
    // Nothing was saved, so nothing should have been looked up.
    expect(resolve).not.toHaveBeenCalled();
  });

  it('names an unnamed target after its address, the way a quick connect arrives', async () => {
    const target = await parseTarget(
      { ...base, auth: { kind: 'prompt', username: 'will' } },
      resolver(null),
    );
    expect(target.name).toBe('10.1.1.5');
  });

  it('refuses an address, a port, or an auth kind it does not recognise', async () => {
    const resolve = resolver(null);
    await expect(parseTarget({ ...base, address: '' }, resolve)).rejects.toThrow('address');
    await expect(
      parseTarget({ ...base, port: 70000, auth: { kind: 'prompt', username: 'w' } }, resolve),
    ).rejects.toThrow('port must be between 1 and 65535');
    await expect(
      parseTarget({ ...base, auth: { kind: 'root', username: 'w' } }, resolve),
    ).rejects.toThrow('unsupported auth kind');
  });
});

/**
 * Quick connect may name a saved credential instead of spelling one out. The point of
 * resolving it here is that the renderer sends an id and never holds the secret.
 */
describe('a target naming a saved credential', () => {
  it('resolves the id into the username and secret behind it', async () => {
    const resolve = resolver({ kind: 'password', username: 'netadmin', password: 'stored' });

    const target = await parseTarget(
      { ...base, auth: { kind: 'saved', credentialId: 'crd_1' } },
      resolve,
    );

    expect(resolve).toHaveBeenCalledWith('crd_1');
    expect(target.auth).toEqual({ kind: 'password', username: 'netadmin', password: 'stored' });
  });

  it('carries a key credential over with its path and passphrase', async () => {
    const resolve = resolver({
      kind: 'key',
      username: 'netadmin',
      keyPath: '/home/will/.ssh/id_ed25519',
      passphrase: 'open sesame',
    });

    const target = await parseTarget(
      { ...base, auth: { kind: 'saved', credentialId: 'crd_2' } },
      resolve,
    );

    expect(target.auth).toEqual({
      kind: 'key',
      username: 'netadmin',
      keyPath: '/home/will/.ssh/id_ed25519',
      passphrase: 'open sesame',
    });
  });

  it('leaves a credential with no stored secret to prompt in the session', async () => {
    // What resolveCredential returns when the keychain has nothing for it.
    const resolve = resolver({ kind: 'prompt', username: 'netadmin' });
    const target = await parseTarget(
      { ...base, auth: { kind: 'saved', credentialId: 'crd_3' } },
      resolve,
    );
    expect(target.auth).toEqual({ kind: 'prompt', username: 'netadmin' });
  });

  it('says so plainly when the credential has been deleted since', async () => {
    await expect(
      parseTarget({ ...base, auth: { kind: 'saved', credentialId: 'crd_gone' } }, resolver(null)),
    ).rejects.toThrow('That credential no longer exists.');
  });

  it('requires an id rather than resolving an empty one', async () => {
    const resolve = resolver({ kind: 'prompt', username: 'netadmin' });
    await expect(
      parseTarget({ ...base, auth: { kind: 'saved', credentialId: '' } }, resolve),
    ).rejects.toThrow('credentialId');
    expect(resolve).not.toHaveBeenCalled();
  });

  // The username check that guards the typed path must not reject this one: a saved
  // credential has no username until it is resolved.
  it('does not demand a username alongside the id', async () => {
    const target = await parseTarget(
      { ...base, auth: { kind: 'saved', credentialId: 'crd_1' } },
      resolver({ kind: 'password', username: 'netadmin', password: 'stored' }),
    );
    expect(target.auth.username).toBe('netadmin');
  });
});
