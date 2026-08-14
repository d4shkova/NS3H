import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MODP_PRIMES, installLegacyDhGroups } from '../src/main/ssh/legacyDh.js';

/**
 * These run under Node, which links OpenSSL and therefore *does* have the small MODP
 * groups. That is exactly what makes them useful: OpenSSL is the reference the shim's
 * hard-coded primes are checked against, so a typo cannot reach Electron unnoticed.
 */
describe('legacy DH groups', () => {
  it('carries the same primes OpenSSL uses', () => {
    for (const [name, prime] of Object.entries(MODP_PRIMES)) {
      const reference = crypto.createDiffieHellmanGroup(name);
      expect(Buffer.from(prime, 'hex').equals(reference.getPrime())).toBe(true);
      expect(reference.getGenerator()).toEqual(Buffer.from([0x02]));
    }
  });

  it('covers the group behind diffie-hellman-group1-sha1', () => {
    // modp2 is the 1024-bit group; it is the only KEX a lot of pre-2010 gear offers.
    expect(MODP_PRIMES.modp2).toBeDefined();
    expect(Buffer.from(MODP_PRIMES.modp2, 'hex').length * 8).toBe(1024);
  });

  it('leaves a runtime that already has the groups alone', () => {
    const report = installLegacyDhGroups();
    expect(report.patched).toEqual([]);
    expect(report.native).toEqual(['modp1', 'modp2', 'modp5']);
  });

  it('supplies a working group when the runtime rejects it', () => {
    // Stands in for Electron's BoringSSL, which throws "Unknown DH group" on modp2.
    const boringish = {
      createDiffieHellman: crypto.createDiffieHellman.bind(crypto),
      createDiffieHellmanGroup: (name: string) => {
        if (name === 'modp2') throw new Error('Unknown DH group');
        return crypto.createDiffieHellmanGroup(name);
      },
    } as unknown as typeof crypto;

    const report = installLegacyDhGroups(boringish);
    expect(report.patched).toEqual(['modp2']);
    expect(report.native).toEqual(['modp1', 'modp5']);

    // The patched group has to agree with a peer using the genuine OpenSSL group.
    const patched = boringish.createDiffieHellmanGroup('modp2');
    const peer = crypto.createDiffieHellmanGroup('modp2');
    const ours = patched.generateKeys();
    const theirs = peer.generateKeys();
    expect(patched.computeSecret(theirs).equals(peer.computeSecret(ours))).toBe(true);
    expect(patched.getPrime().equals(peer.getPrime())).toBe(true);
  });

  it('still delegates groups the runtime does know', () => {
    const seen: string[] = [];
    const stub = {
      createDiffieHellman: crypto.createDiffieHellman.bind(crypto),
      createDiffieHellmanGroup: (name: string) => {
        if (name === 'modp2') throw new Error('Unknown DH group');
        seen.push(name);
        return crypto.createDiffieHellmanGroup(name);
      },
    } as unknown as typeof crypto;

    installLegacyDhGroups(stub);
    seen.length = 0;
    stub.createDiffieHellmanGroup('modp14');
    expect(seen).toEqual(['modp14']);
  });
});
