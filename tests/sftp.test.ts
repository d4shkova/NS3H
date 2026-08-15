import { describe, expect, it } from 'vitest';
import { joinRemote, permissionString } from '../src/main/ssh/sftp.js';

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
