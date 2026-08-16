import { describe, expect, it } from 'vitest';
import {
  classifySshError,
  explainNetworkError,
  explainSftpRefusal,
} from '../src/main/ssh/errors.js';
import { collectRemoteOffer, describeRemoteOffer } from '../src/main/ssh/handshakeLog.js';

describe('failure classification', () => {
  it('recognises an authentication failure as re-promptable', () => {
    const error = Object.assign(new Error('All configured authentication methods failed'), {
      level: 'client-authentication',
    });
    expect(classifySshError(error, true).kind).toBe('auth');
  });

  it('recognises a negotiation mismatch', () => {
    const error = new Error('Handshake failed: no matching key exchange algorithm');
    expect(classifySshError(error, false).kind).toBe('negotiation');
  });

  it('treats a socket dropped mid-handshake as a negotiation failure', () => {
    const error = Object.assign(new Error('socket closed'), { code: 'ECONNRESET' });
    expect(classifySshError(error, false).kind).toBe('negotiation');
    // The same reset after a successful handshake is not the ladder's problem.
    expect(classifySshError(error, true).kind).toBe('other');
  });

  it('explains an SFTP channel a device would not open', () => {
    // What ssh2 actually reports for a device with no SFTP subsystem: no reason text.
    const error = new Error('(SSH) Channel open failure: ');
    const explained = explainSftpRefusal(error, '10.1.1.5');

    expect(explained.message).toContain('10.1.1.5 refused an SFTP channel');
    expect(explained.message).toContain('SFTP subsystem');
    // No dangling "()" where ssh2 gave no reason, and no ssh2 stack in the log.
    expect(explained.message).not.toContain('()');
    expect(explained.stack).toBe(`Error: ${explained.message}`);
  });

  it('keeps the reason a device did give', () => {
    const explained = explainSftpRefusal(new Error('(SSH) Channel open failure: administratively prohibited'), 'sw1');
    expect(explained.message).toContain('(administratively prohibited)');
  });

  it('recognises unreachable hosts', () => {
    for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'EHOSTUNREACH', 'ETIMEDOUT']) {
      const error = Object.assign(new Error('nope'), { code });
      expect(classifySshError(error, false).kind).toBe('network');
    }
  });

  it('names the likely cause instead of printing the errno', () => {
    const refused = explainNetworkError(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      '10.1.1.5',
      22,
    );
    expect(refused).toContain('refused the connection on port 22');
    expect(refused).not.toContain('ECONNREFUSED');
  });
});

describe('remote offer scraping', () => {
  it('collects the server lists from ssh2 debug output', () => {
    const offer = {};
    expect(
      collectRemoteOffer(offer, 'Handshake: (remote) KEX method: diffie-hellman-group1-sha1,foo'),
    ).toBe(true);
    collectRemoteOffer(offer, 'Handshake: (remote) Host key format: ssh-dss');
    collectRemoteOffer(offer, 'Handshake: (remote) C->S cipher: 3des-cbc, aes128-cbc');
    collectRemoteOffer(offer, 'Handshake: (remote) C->S MAC: hmac-sha1');
    expect(collectRemoteOffer(offer, 'Outbound: Sending KEXINIT')).toBe(false);

    expect(offer).toEqual({
      kex: ['diffie-hellman-group1-sha1', 'foo'],
      serverHostKey: ['ssh-dss'],
      cipher: ['3des-cbc', 'aes128-cbc'],
      mac: ['hmac-sha1'],
    });

    expect(describeRemoteOffer(offer)).toEqual([
      'KEX: diffie-hellman-group1-sha1, foo',
      'Host key: ssh-dss',
      'Cipher: 3des-cbc, aes128-cbc',
      'MAC: hmac-sha1',
    ]);
  });

  it('says nothing when the server never advertised anything', () => {
    expect(describeRemoteOffer({})).toEqual([]);
  });
});
