import { describe, expect, it } from 'vitest';
import {
  EMPTY_KNOWN_HOSTS,
  parseKnownHosts,
  upsertEntry,
  verifyHostKey,
  type KnownHostsFile,
} from '../src/main/store/knownHosts.js';

const entry = {
  address: '10.1.1.5',
  port: 22,
  keyType: 'ssh-rsa',
  fingerprint: 'SHA256:abc123',
  acceptedAt: '2026-08-14T10:00:00Z',
};

const file: KnownHostsFile = { version: 1, entries: [entry] };

describe('known hosts', () => {
  it('treats an unseen address as unknown', () => {
    expect(verifyHostKey(EMPTY_KNOWN_HOSTS, '10.1.1.5', 22, 'SHA256:abc123')).toEqual({
      kind: 'unknown',
    });
  });

  it('trusts a matching fingerprint', () => {
    expect(verifyHostKey(file, '10.1.1.5', 22, 'SHA256:abc123').kind).toBe('trusted');
  });

  it('flags a changed key and carries the previous entry', () => {
    const verdict = verifyHostKey(file, '10.1.1.5', 22, 'SHA256:different');
    expect(verdict.kind).toBe('changed');
    if (verdict.kind === 'changed') {
      expect(verdict.previous.fingerprint).toBe('SHA256:abc123');
    }
  });

  it('keys on address:port, so the same host on another port is unknown', () => {
    expect(verifyHostKey(file, '10.1.1.5', 2222, 'SHA256:abc123').kind).toBe('unknown');
  });

  it('overwrites rather than duplicating on accept', () => {
    const next = upsertEntry(file, { ...entry, fingerprint: 'SHA256:new' });
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0].fingerprint).toBe('SHA256:new');
  });

  it('drops malformed entries instead of throwing', () => {
    const parsed = parseKnownHosts(
      JSON.stringify({ version: 1, entries: [entry, { address: 5 }, null] }),
    );
    expect(parsed.entries).toHaveLength(1);
  });

  it('rejects a file that is not the expected shape', () => {
    expect(() => parseKnownHosts('{"version":1}')).toThrow();
  });
});
