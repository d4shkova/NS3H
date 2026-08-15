/**
 * SSH algorithm policy. Hard-coded, not user-editable, not exposed in settings.
 *
 * Order matters: modern algorithms are offered first so a modern server negotiates
 * modern crypto. The legacy entries are only selected when they are all a device has.
 */

export interface AlgorithmSet {
  kex: string[];
  serverHostKey: string[];
  cipher: string[];
  hmac: string[];
}

export const FULL_ALGORITHMS: AlgorithmSet = {
  kex: [
    'curve25519-sha256',
    'curve25519-sha256@libssh.org',
    'ecdh-sha2-nistp256',
    'ecdh-sha2-nistp384',
    'ecdh-sha2-nistp521',
    'diffie-hellman-group-exchange-sha256',
    'diffie-hellman-group16-sha512',
    'diffie-hellman-group18-sha512',
    'diffie-hellman-group14-sha256',
    'diffie-hellman-group14-sha1',
    'diffie-hellman-group-exchange-sha1',
    'diffie-hellman-group1-sha1',
  ],
  serverHostKey: [
    'ssh-ed25519',
    'ecdsa-sha2-nistp256',
    'ecdsa-sha2-nistp384',
    'ecdsa-sha2-nistp521',
    'rsa-sha2-512',
    'rsa-sha2-256',
    'ssh-rsa',
    'ssh-dss',
  ],
  cipher: [
    'chacha20-poly1305@openssh.com',
    'aes128-gcm@openssh.com',
    'aes256-gcm@openssh.com',
    'aes128-ctr',
    'aes192-ctr',
    'aes256-ctr',
    'aes256-cbc',
    'aes192-cbc',
    'aes128-cbc',
    '3des-cbc',
    'blowfish-cbc',
    'cast128-cbc',
    'arcfour256',
    'arcfour128',
    'arcfour',
  ],
  hmac: [
    'hmac-sha2-256-etm@openssh.com',
    'hmac-sha2-512-etm@openssh.com',
    'hmac-sha1-etm@openssh.com',
    'hmac-sha2-256',
    'hmac-sha2-512',
    'hmac-sha1',
    'hmac-md5',
    'hmac-sha1-96',
    'hmac-md5-96',
  ],
};

/** Trimmed proposal for devices that reject an oversized KEXINIT. */
export const LEGACY_ALGORITHMS: AlgorithmSet = {
  kex: [
    'diffie-hellman-group14-sha1',
    'diffie-hellman-group-exchange-sha1',
    'diffie-hellman-group1-sha1',
  ],
  serverHostKey: ['ssh-rsa', 'ssh-dss'],
  cipher: ['aes128-cbc', 'aes256-cbc', '3des-cbc'],
  hmac: ['hmac-sha1', 'hmac-md5'],
};

/** The lists a transport actually implements, in the same shape as an AlgorithmSet. */
export interface SupportedAlgorithms {
  kex: readonly string[];
  serverHostKey: readonly string[];
  cipher: readonly string[];
  hmac: readonly string[];
}

export interface FilteredAlgorithms {
  algorithms: AlgorithmSet;
  /** Entries we would have offered but the transport cannot implement. */
  dropped: AlgorithmSet;
}

/**
 * ssh2 throws on an algorithm name it does not implement, so a proposal has to be
 * intersected with its supported lists before use. Preference order is preserved,
 * and what fell out is reported so it can be surfaced rather than silently lost.
 */
export function filterAlgorithms(
  wanted: AlgorithmSet,
  supported: SupportedAlgorithms,
): FilteredAlgorithms {
  const keys = ['kex', 'serverHostKey', 'cipher', 'hmac'] as const;
  const algorithms = {} as AlgorithmSet;
  const dropped = {} as AlgorithmSet;

  for (const key of keys) {
    const available = new Set(supported[key]);
    algorithms[key] = wanted[key].filter((name) => available.has(name));
    dropped[key] = wanted[key].filter((name) => !available.has(name));
  }

  return { algorithms, dropped };
}

/** Flatten a dropped-algorithm report into one line per category, for logging. */
export function describeDropped(dropped: AlgorithmSet): string[] {
  const labels: Record<keyof AlgorithmSet, string> = {
    kex: 'KEX',
    serverHostKey: 'host key',
    cipher: 'cipher',
    hmac: 'MAC',
  };
  const lines: string[] = [];
  for (const key of Object.keys(labels) as (keyof AlgorithmSet)[]) {
    if (dropped[key].length > 0) {
      lines.push(`${labels[key]}: ${dropped[key].join(', ')}`);
    }
  }
  return lines;
}
