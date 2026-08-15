import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { joinRemote, listLocal, permissionString } from '../src/main/ssh/sftp.js';

describe('remote paths', () => {
  it('joins POSIX-style regardless of the client platform', () => {
    expect(joinRemote('/home/will', 'file.txt')).toBe('/home/will/file.txt');
    expect(joinRemote('/home/will/', 'file.txt')).toBe('/home/will/file.txt');
    expect(joinRemote('/', 'etc')).toBe('/etc');
  });

  it('walks up without escaping the root', () => {
    expect(joinRemote('/home/will/logs', '..')).toBe('/home/will');
    expect(joinRemote('/home', '..')).toBe('/');
    expect(joinRemote('/', '..')).toBe('/');
  });
});

describe('permission strings', () => {
  it('renders a regular file', () => {
    expect(permissionString(0o100644)).toBe('-rw-r--r--');
  });

  it('renders a directory', () => {
    expect(permissionString(0o040755)).toBe('drwxr-xr-x');
  });

  it('renders a symlink', () => {
    expect(permissionString(0o120777)).toBe('lrwxrwxrwx');
  });

  it('renders no permissions at all', () => {
    expect(permissionString(0o100000)).toBe('----------');
  });
});

describe('the local pane', () => {
  let root = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'ns3h-local-'));
    await mkdir(join(root, 'configs'));
    await writeFile(join(root, 'running.cfg'), 'hostname sw1\n');
    await writeFile(join(root, 'archive.tar'), 'x'.repeat(2048));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lists directories first, with a way back up', async () => {
    const { path, entries } = await listLocal(root);

    expect(path).toBe(root);
    expect(entries[0].name).toBe('..');
    expect(entries.map((entry) => entry.name)).toEqual([
      '..',
      'configs',
      'archive.tar',
      'running.cfg',
    ]);
    expect(entries.find((entry) => entry.name === 'archive.tar')?.size).toBe(2048);
  });

  it('skips entries it cannot stat rather than failing the listing', async () => {
    // A broken symlink stats as ENOENT — common in a home directory.
    const { symlink } = await import('node:fs/promises');
    await symlink(join(root, 'gone'), join(root, 'dangling'));

    const { entries } = await listLocal(root);
    expect(entries.map((entry) => entry.name)).not.toContain('dangling');
    expect(entries.map((entry) => entry.name)).toContain('running.cfg');
  });
});
