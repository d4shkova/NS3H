import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LockStore } from '../src/main/lock/store.js';

let dir = '';
const lockFile = () => join(dir, 'lock.json');

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ns3h-lock-'));
});

describe('the launch password', () => {
  it('is off until one is set', async () => {
    const lock = new LockStore(lockFile());
    expect(await lock.enabled()).toBe(false);
    // Nothing to verify against must never be treated as a match.
    expect(await lock.verify('')).toBe(false);
    expect(await lock.verify('anything')).toBe(false);
  });

  it('accepts the password it was given, and nothing else', async () => {
    const lock = new LockStore(lockFile());
    await lock.set('correct horse battery');

    expect(await lock.enabled()).toBe(true);
    expect(await lock.verify('correct horse battery')).toBe(true);
    expect(await lock.verify('Correct horse battery')).toBe(false);
    expect(await lock.verify('correct horse batter')).toBe(false);
    expect(await lock.verify('')).toBe(false);
  }, 20_000);

  it('stores a hash and never the password', async () => {
    const lock = new LockStore(lockFile());
    await lock.set('correct horse battery');

    const raw = await readFile(lockFile(), 'utf8');
    expect(raw).not.toContain('correct horse battery');
    // Argon2id, so a stolen file is an offline guessing problem rather than a password.
    expect(raw).toContain('$argon2id$');
  }, 20_000);

  it('survives a restart, which is the whole point of it', async () => {
    await new LockStore(lockFile()).set('correct horse battery');
    // A second store reading the same file is what the next launch looks like.
    expect(await new LockStore(lockFile()).verify('correct horse battery')).toBe(true);
  }, 20_000);

  it('leaves nothing behind when cleared', async () => {
    const lock = new LockStore(lockFile());
    await lock.set('correct horse battery');
    await lock.clear();

    expect(await lock.enabled()).toBe(false);
    expect(await new LockStore(lockFile()).enabled()).toBe(false);
    // A file left sitting there would imply a password is still set.
    expect(existsSync(lockFile())).toBe(false);
  }, 20_000);

  it('refuses an empty password rather than setting an unenterable one', async () => {
    await expect(new LockStore(lockFile()).set('')).rejects.toThrow('cannot be empty');
  });

  it('fails closed on a corrupt file', async () => {
    // Whatever state the file is in, the answer to "is this the password" is no.
    await writeFile(lockFile(), 'not json at all', 'utf8');
    expect(await new LockStore(lockFile()).verify('anything')).toBe(false);

    await writeFile(lockFile(), JSON.stringify({ version: 1, hash: 'garbage' }), 'utf8');
    const damaged = new LockStore(lockFile());
    // It still reports as enabled — a damaged hash must lock people out rather than let
    // them in, and the reset is the documented way past it.
    expect(await damaged.enabled()).toBe(true);
    expect(await damaged.verify('anything')).toBe(false);
  });

  it('replaces the old password when changed', async () => {
    const lock = new LockStore(lockFile());
    await lock.set('first one');
    await lock.set('second one');

    expect(await lock.verify('first one')).toBe(false);
    expect(await lock.verify('second one')).toBe(true);
  }, 30_000);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
