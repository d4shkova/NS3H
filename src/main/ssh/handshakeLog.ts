/**
 * ssh2 only reports the peer's KEXINIT through its debug callback, and only reports
 * a negotiation failure as a bare message. Scraping the debug stream is the only way
 * to tell the user what the server actually offered — which §3.2 requires on failure.
 */

export interface RemoteOffer {
  kex?: string[];
  serverHostKey?: string[];
  cipher?: string[];
  mac?: string[];
}

const PATTERNS: { re: RegExp; key: keyof RemoteOffer }[] = [
  { re: /^Handshake: \(remote\) KEX method: (.*)$/, key: 'kex' },
  { re: /^Handshake: \(remote\) Host key format: (.*)$/, key: 'serverHostKey' },
  { re: /^Handshake: \(remote\) C->S cipher: (.*)$/, key: 'cipher' },
  { re: /^Handshake: \(remote\) C->S MAC: (.*)$/, key: 'mac' },
];

/** Accumulates the remote lists as debug lines arrive. Returns true if it matched. */
export function collectRemoteOffer(offer: RemoteOffer, line: string): boolean {
  for (const { re, key } of PATTERNS) {
    const match = re.exec(line);
    if (match) {
      offer[key] = match[1]
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
      return true;
    }
  }
  return false;
}

export function describeRemoteOffer(offer: RemoteOffer): string[] {
  const labels: [keyof RemoteOffer, string][] = [
    ['kex', 'KEX'],
    ['serverHostKey', 'Host key'],
    ['cipher', 'Cipher'],
    ['mac', 'MAC'],
  ];
  const lines: string[] = [];
  for (const [key, label] of labels) {
    const values = offer[key];
    if (values && values.length > 0) {
      lines.push(`${label}: ${values.join(', ')}`);
    }
  }
  return lines;
}
