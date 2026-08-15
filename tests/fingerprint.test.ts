import { createHash, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  identifyHostKey,
  readKeyTypeFromBlob,
  sha256Fingerprint,
} from '../src/main/ssh/fingerprint.js';

function sshString(value: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(value.length);
  return Buffer.concat([length, value]);
}

/** The wire form of an ed25519 host key, as `hostVerifier` receives it. */
function ed25519Blob(): Buffer {
  const { publicKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(12);
  return Buffer.concat([sshString(Buffer.from('ssh-ed25519')), sshString(raw)]);
}

describe('host key fingerprints', () => {
  it('matches the OpenSSH SHA256 form', () => {
    const blob = Buffer.from('some key material');
    const expected = createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');
    expect(sha256Fingerprint(blob)).toBe(`SHA256:${expected}`);
    expect(sha256Fingerprint(blob)).not.toMatch(/=/);
  });

  it('identifies a real key blob', () => {
    const identity = identifyHostKey(ed25519Blob());
    expect(identity.keyType).toBe('ssh-ed25519');
    expect(identity.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]+$/);
  });

  it('falls back to the blob header for a key type it cannot parse', () => {
    const blob = Buffer.concat([sshString(Buffer.from('ssh-exotic')), sshString(Buffer.alloc(8))]);
    expect(identifyHostKey(blob).keyType).toBe('ssh-exotic');
  });

  it('reports unknown rather than throwing on garbage', () => {
    expect(readKeyTypeFromBlob(Buffer.from([0x01]))).toBeNull();
    expect(identifyHostKey(Buffer.from([0x01, 0x02, 0x03])).keyType).toBe('unknown');
  });
});
