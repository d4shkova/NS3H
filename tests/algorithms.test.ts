import { describe, expect, it } from 'vitest';
import constants from 'ssh2/lib/protocol/constants.js';
import {
  FULL_ALGORITHMS,
  LEGACY_ALGORITHMS,
  describeDropped,
  filterAlgorithms,
} from '../src/main/ssh/algorithms.js';

const SUPPORTED = {
  kex: constants.SUPPORTED_KEX as string[],
  serverHostKey: constants.SUPPORTED_SERVER_HOST_KEY as string[],
  cipher: constants.SUPPORTED_CIPHER as string[],
  hmac: constants.SUPPORTED_MAC as string[],
};

describe('algorithm policy', () => {
  it('offers modern algorithms before legacy ones', () => {
    const kex = FULL_ALGORITHMS.kex;
    expect(kex.indexOf('curve25519-sha256')).toBeLessThan(
      kex.indexOf('diffie-hellman-group1-sha1'),
    );

    const cipher = FULL_ALGORITHMS.cipher;
    expect(cipher.indexOf('chacha20-poly1305@openssh.com')).toBeLessThan(
      cipher.indexOf('3des-cbc'),
    );

    const hmac = FULL_ALGORITHMS.hmac;
    expect(hmac.indexOf('hmac-sha2-256-etm@openssh.com')).toBeLessThan(hmac.indexOf('hmac-md5'));
  });

  it('keeps the legacy rung strictly smaller than the full rung', () => {
    for (const key of ['kex', 'serverHostKey', 'cipher', 'hmac'] as const) {
      expect(LEGACY_ALGORITHMS[key].length).toBeLessThan(FULL_ALGORITHMS[key].length);
      for (const name of LEGACY_ALGORITHMS[key]) {
        expect(FULL_ALGORITHMS[key]).toContain(name);
      }
    }
  });

  it('preserves preference order when filtering', () => {
    const { algorithms } = filterAlgorithms(FULL_ALGORITHMS, {
      kex: ['diffie-hellman-group1-sha1', 'curve25519-sha256'],
      serverHostKey: ['ssh-rsa'],
      cipher: ['3des-cbc', 'aes128-ctr'],
      hmac: ['hmac-sha1'],
    });

    expect(algorithms.kex).toEqual(['curve25519-sha256', 'diffie-hellman-group1-sha1']);
    expect(algorithms.cipher).toEqual(['aes128-ctr', '3des-cbc']);
  });

  it('reports what the transport cannot implement', () => {
    const { dropped } = filterAlgorithms(FULL_ALGORITHMS, {
      kex: FULL_ALGORITHMS.kex,
      serverHostKey: FULL_ALGORITHMS.serverHostKey,
      cipher: ['aes128-ctr'],
      hmac: FULL_ALGORITHMS.hmac,
    });

    expect(dropped.cipher).toContain('arcfour');
    expect(describeDropped(dropped).join(' ')).toMatch(/^cipher:/);
  });

  it('produces a proposal ssh2 accepts on every rung', () => {
    for (const set of [FULL_ALGORITHMS, LEGACY_ALGORITHMS]) {
      const { algorithms } = filterAlgorithms(set, SUPPORTED);
      for (const key of ['kex', 'serverHostKey', 'cipher', 'hmac'] as const) {
        expect(algorithms[key].length).toBeGreaterThan(0);
        for (const name of algorithms[key]) {
          expect(SUPPORTED[key]).toContain(name);
        }
      }
    }
  });

  it('still offers the crypto the legacy acceptance checks require', () => {
    const { algorithms } = filterAlgorithms(FULL_ALGORITHMS, SUPPORTED);
    expect(algorithms.kex).toContain('diffie-hellman-group1-sha1');
    expect(algorithms.serverHostKey).toContain('ssh-dss');
    expect(algorithms.cipher).toContain('3des-cbc');
    expect(algorithms.hmac).toContain('hmac-md5');
  });
});
