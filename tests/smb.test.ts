import { describe, expect, it } from 'vitest';
import { explainSmbError, joinShare, shareUnc, toSmbPath } from '../src/main/files/smb.js';

describe('share paths', () => {
  it('converts the pane’s POSIX paths to what SMB expects on the wire', () => {
    // The share root is an empty string, not a separator — SMB2 has no leading slash.
    expect(toSmbPath('/')).toBe('');
    expect(toSmbPath('/images')).toBe('images');
    expect(toSmbPath('/images/ios/c2960.bin')).toBe('images\\ios\\c2960.bin');
  });

  it('walks into and back out of directories without escaping the share', () => {
    expect(joinShare('/', 'images')).toBe('/images');
    expect(joinShare('/images', 'ios')).toBe('/images/ios');
    expect(joinShare('/images/ios', '..')).toBe('/images');
    expect(joinShare('/images', '..')).toBe('/');
    expect(joinShare('/', '..')).toBe('/');
  });

  it('writes a share the way a user would', () => {
    expect(shareUnc('fileserver', 'images')).toBe('\\\\fileserver\\images');
  });
});

describe('SMB failures', () => {
  const failure = (code: string) =>
    explainSmbError(Object.assign(new Error('nope'), { code }), 'fileserver', 'images');

  it('names a bad password rather than printing a status code', () => {
    const explained = failure('STATUS_LOGON_FAILURE');
    expect(explained.message).toContain('rejected those credentials');
    expect(explained.message).toContain('domain or workgroup');
    expect(explained.message).not.toContain('STATUS_');
  });

  it('distinguishes a missing share from a permissions problem', () => {
    expect(failure('STATUS_BAD_NETWORK_NAME').message).toContain('no share called "images"');
    expect(failure('STATUS_ACCESS_DENIED').message).toContain('refused access');
  });

  it('says plainly that SMB1-only hosts are out of reach', () => {
    expect(failure('STATUS_NOT_SUPPORTED').message).toContain('SMB2 only');
  });

  it('explains a refused connection in terms of port 445', () => {
    expect(failure('ECONNREFUSED').message).toContain('port 445');
  });

  it('falls back to the underlying message, and never carries a library stack', () => {
    const explained = failure('STATUS_SOMETHING_NEW');
    expect(explained.message).toContain('nope');
    expect(explained.stack).toBe(`Error: ${explained.message}`);
  });
});

describe('the share field', () => {
  it('treats whitespace as empty rather than sending it to the server', async () => {
    const { SmbTransport } = await import('../src/main/files/smb.js');
    await expect(
      SmbTransport.connect({
        protocol: 'smb',
        host: 'fileserver',
        port: 445,
        username: 'admin',
        share: '   ',
      }),
    ).rejects.toThrow('needs a share name');
  });
});
