import { createHash } from 'node:crypto';
import { utils } from './ssh2.js';

export interface HostKeyIdentity {
  keyType: string;
  /** OpenSSH-style `SHA256:<unpadded base64>`. */
  fingerprint: string;
}

/** SHA256 fingerprint in the same form `ssh-keygen -l` prints. */
export function sha256Fingerprint(keyBlob: Buffer): string {
  const digest = createHash('sha256').update(keyBlob).digest('base64');
  return `SHA256:${digest.replace(/=+$/, '')}`;
}

/**
 * Identify a host key from the raw wire blob ssh2 hands to `hostVerifier`.
 * Falls back to reading the type out of the blob itself if parsing fails, so an
 * exotic key type still produces something the user can compare.
 */
export function identifyHostKey(keyBlob: Buffer): HostKeyIdentity {
  const fingerprint = sha256Fingerprint(keyBlob);
  const parsed = utils.parseKey(keyBlob);
  if (!(parsed instanceof Error)) {
    return { keyType: parsed.type, fingerprint };
  }
  return { keyType: readKeyTypeFromBlob(keyBlob) ?? 'unknown', fingerprint };
}

/** SSH public key blobs start with a length-prefixed algorithm name. */
export function readKeyTypeFromBlob(keyBlob: Buffer): string | null {
  if (keyBlob.length < 4) return null;
  const length = keyBlob.readUInt32BE(0);
  if (length === 0 || length > 64 || keyBlob.length < 4 + length) return null;
  const name = keyBlob.subarray(4, 4 + length).toString('utf8');
  return /^[\x20-\x7e]+$/.test(name) ? name : null;
}
