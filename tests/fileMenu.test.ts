import { describe, expect, it } from 'vitest';
import {
  modeProblem,
  nameProblem,
  octalFromPermissions,
} from '../src/renderer/components/Transfer/fileActions.js';
import { capabilitiesOf } from '../src/main/files/transport.js';
import { siblingPath } from '../src/main/ssh/sftp.js';
import type { FileTransport } from '../src/main/files/transport.js';

describe('reading a permission string back', () => {
  it('reads the modes anyone actually types', () => {
    expect(octalFromPermissions('-rw-r--r--')).toBe('644');
    expect(octalFromPermissions('drwxr-xr-x')).toBe('755');
    expect(octalFromPermissions('-rwx------')).toBe('700');
    expect(octalFromPermissions('----------')).toBe('000');
  });

  it('treats a lower-case set-uid or sticky bit as execute', () => {
    // `s` is set-uid with execute; `S` is set-uid without it. The box shows the
    // permission bits, so only the lower-case forms count as execute.
    expect(octalFromPermissions('-rwsr-xr-x')).toBe('755');
    expect(octalFromPermissions('-rwSr--r--')).toBe('644');
    expect(octalFromPermissions('drwxrwxrwt')).toBe('777');
    expect(octalFromPermissions('drwxrwxrwT')).toBe('776');
  });

  it('gives nothing back for a column that is not a POSIX mode', () => {
    // SMB has no mode on the wire, and its column says so rather than inventing bits.
    expect(octalFromPermissions('dir')).toBe('');
    expect(octalFromPermissions('—')).toBe('');
    expect(octalFromPermissions('')).toBe('');
  });
});

describe('judging a name before it is sent', () => {
  it('accepts an ordinary file name', () => {
    expect(nameProblem('running-config.txt')).toBeNull();
    expect(nameProblem('  spaced name.bin  ')).toBeNull();
  });

  it('refuses anything that would move the file rather than rename it', () => {
    expect(nameProblem('../elsewhere')).toMatch(/slash/);
    expect(nameProblem('sub/dir')).toMatch(/slash/);
    expect(nameProblem('back\\slash')).toMatch(/slash/);
    expect(nameProblem('..')).toMatch(/directory itself/);
    expect(nameProblem('.')).toMatch(/directory itself/);
  });

  it('refuses an empty name and one no filesystem would take', () => {
    expect(nameProblem('   ')).toMatch(/needed/);
    expect(nameProblem('x'.repeat(256))).toMatch(/255/);
    expect(nameProblem('x'.repeat(255))).toBeNull();
  });
});

describe('judging a permission string', () => {
  it('takes three or four octal digits', () => {
    expect(modeProblem('644')).toBeNull();
    expect(modeProblem('0755')).toBeNull();
    expect(modeProblem(' 600 ')).toBeNull();
  });

  it('refuses anything else', () => {
    expect(modeProblem('rwxr-xr-x')).toMatch(/octal/);
    expect(modeProblem('648')).toMatch(/octal/);
    expect(modeProblem('64')).toMatch(/octal/);
    expect(modeProblem('')).toMatch(/octal/);
  });
});

describe('what a transport says it can do', () => {
  const base: FileTransport = {
    home: () => Promise.resolve('/'),
    list: () => Promise.resolve([]),
    download: () => Promise.resolve(''),
    upload: () => Promise.resolve(''),
    close: () => {},
  };

  it('reports nothing for a transport that only moves bytes', () => {
    expect(capabilitiesOf(base)).toEqual({
      rename: false,
      remove: false,
      chmod: false,
      mkdir: false,
    });
  });

  it('reports each operation the transport actually implements', () => {
    // SMB's shape: it renames, deletes and creates directories, but has no POSIX mode.
    const smbLike: FileTransport = {
      ...base,
      rename: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      mkdir: () => Promise.resolve(),
    };
    expect(capabilitiesOf(smbLike)).toEqual({
      rename: true,
      remove: true,
      chmod: false,
      mkdir: true,
    });
  });
});

describe('renaming in place', () => {
  it('keeps the directory the entry is already in', () => {
    expect(siblingPath('/home/admin/old.cfg', 'new.cfg')).toBe('/home/admin/new.cfg');
    expect(siblingPath('/old.cfg', 'new.cfg')).toBe('/new.cfg');
  });

  it('handles a directory written with a trailing slash', () => {
    expect(siblingPath('/var/tmp/images/', 'archive')).toBe('/var/tmp/archive');
  });
});
