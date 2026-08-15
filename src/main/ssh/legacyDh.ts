import nodeCrypto from 'node:crypto';

/**
 * Electron links against BoringSSL, not OpenSSL, and BoringSSL does not carry the
 * small MODP groups. `crypto.createDiffieHellmanGroup('modp2')` throws "Unknown DH
 * group" there, which kills `diffie-hellman-group1-sha1` — the only key exchange a
 * lot of pre-2010 network gear offers.
 *
 * BoringSSL does support Diffie-Hellman over an explicitly supplied prime, so the
 * groups can be restored by handing it the same primes OpenSSL would have used.
 * These are the standard MODP primes (RFC 2409 groups 1 and 2, RFC 3526 group 5);
 * `tests/legacyDh.test.ts` checks each one byte-for-byte against OpenSSL's own copy.
 */
export const MODP_PRIMES: Record<string, string> = {
  modp1:
    'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74' +
    '020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F1437' +
    '4FE1356D6D51C245E485B576625E7EC6F44C42E9A63A3620FFFFFFFFFFFFFFFF',
  modp2:
    'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74' +
    '020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F1437' +
    '4FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
    'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE65381FFFFFFFFFFFFFFFF',
  modp5:
    'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74' +
    '020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F1437' +
    '4FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
    'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF05' +
    '98DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB' +
    '9ED529077096966D670C354E4ABC9804F1746C08CA237327FFFFFFFFFFFFFFFF',
};

const GENERATOR = Buffer.from([0x02]);

type CryptoModule = Pick<
  typeof nodeCrypto,
  'createDiffieHellman' | 'createDiffieHellmanGroup'
>;

export interface DhShimReport {
  /** Groups the runtime could not provide and that this shim now supplies. */
  patched: string[];
  /** Groups the runtime provides natively — left untouched. */
  native: string[];
}

/**
 * Wraps `createDiffieHellmanGroup` so a group the runtime rejects falls back to an
 * explicit prime. Groups the runtime already knows keep using its implementation.
 *
 * Must run before `ssh2` is loaded: ssh2 destructures the function off the crypto
 * module at require time, so a later patch would never be seen.
 */
export function installLegacyDhGroups(crypto: CryptoModule = nodeCrypto): DhShimReport {
  const report: DhShimReport = { patched: [], native: [] };
  const original = crypto.createDiffieHellmanGroup.bind(crypto);
  const fallbacks = new Map<string, () => nodeCrypto.DiffieHellman>();

  for (const [name, prime] of Object.entries(MODP_PRIMES)) {
    try {
      original(name);
      report.native.push(name);
    } catch {
      report.patched.push(name);
      fallbacks.set(name, () =>
        crypto.createDiffieHellman(Buffer.from(prime, 'hex'), GENERATOR),
      );
    }
  }

  if (fallbacks.size === 0) return report;

  crypto.createDiffieHellmanGroup = ((name: string) => {
    const fallback = fallbacks.get(name);
    return fallback ? fallback() : original(name);
  }) as typeof crypto.createDiffieHellmanGroup;

  return report;
}
