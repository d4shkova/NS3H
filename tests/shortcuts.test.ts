import { describe, expect, it } from 'vitest';
import { countConnection, shortcutsFor } from '../src/renderer/stores/shortcuts.js';
import type { Host, HostUsage } from '../src/shared/config.js';

const host = (id: string, over: Partial<Host> = {}): Host => ({
  id,
  name: id,
  protocol: 'ssh',
  folderId: null,
  address: '10.1.1.5',
  port: 22,
  credentialId: null,
  inlineCredential: null,
  logging: true,
  favorite: false,
  serial: null,
  createdAt: '2026-08-14T10:00:00Z',
  ...over,
});

const used = (counts: Record<string, number>, at = '2026-08-14T10:00:00Z') =>
  Object.fromEntries(
    Object.entries(counts).map(([id, count]) => [id, { count, lastAt: at }]),
  ) as Record<string, HostUsage>;

describe('what the sidebar column holds', () => {
  it('ranks the frequent list by connection count', () => {
    const hosts = [host('a'), host('b'), host('c')];
    const { frequent } = shortcutsFor(hosts, used({ a: 2, b: 9, c: 5 }));
    expect(frequent.map((entry) => entry.id)).toEqual(['b', 'c', 'a']);
  });

  it('stops at seven', () => {
    const hosts = Array.from({ length: 12 }, (_, index) => host(`h${index}`));
    const counts = Object.fromEntries(hosts.map((entry, index) => [entry.id, index + 1]));
    const { frequent } = shortcutsFor(hosts, used(counts));
    expect(frequent).toHaveLength(7);
    expect(frequent[0].id).toBe('h11');
  });

  it('leaves out hosts that have never been connected to', () => {
    const { frequent } = shortcutsFor([host('a'), host('b')], used({ a: 1 }));
    expect(frequent.map((entry) => entry.id)).toEqual(['a']);
  });

  it('breaks a tie on the most recent connection, then on name', () => {
    const hosts = [host('older'), host('newer'), host('same-a'), host('same-b')];
    const usage: Record<string, HostUsage> = {
      older: { count: 3, lastAt: '2026-01-01T00:00:00Z' },
      newer: { count: 3, lastAt: '2026-08-01T00:00:00Z' },
      'same-b': { count: 1, lastAt: '2026-05-01T00:00:00Z' },
      'same-a': { count: 1, lastAt: '2026-05-01T00:00:00Z' },
    };
    expect(shortcutsFor(hosts, usage).frequent.map((entry) => entry.id)).toEqual([
      'newer',
      'older',
      'same-a',
      'same-b',
    ]);
  });

  it('lists favourites after the frequent hosts, by name', () => {
    const hosts = [host('zulu', { favorite: true }), host('alpha', { favorite: true }), host('x')];
    const { favorites } = shortcutsFor(hosts, used({ x: 4 }));
    expect(favorites.map((entry) => entry.id)).toEqual(['alpha', 'zulu']);
  });

  it('never shows one host twice — the duplication this replaced, only smaller', () => {
    const hosts = [host('busy', { favorite: true }), host('quiet', { favorite: true })];
    const { frequent, favorites } = shortcutsFor(hosts, used({ busy: 6 }));
    expect(frequent.map((entry) => entry.id)).toEqual(['busy']);
    expect(favorites.map((entry) => entry.id)).toEqual(['quiet']);
  });

  it('is empty on a fresh install rather than guessing', () => {
    expect(shortcutsFor([host('a'), host('b')], {})).toEqual({ frequent: [], favorites: [] });
  });
});

describe('counting a connection', () => {
  it('starts a host at one and increments from there', () => {
    const first = countConnection({}, 'hst_1', '2026-08-14T10:00:00Z');
    expect(first.hst_1).toEqual({ count: 1, lastAt: '2026-08-14T10:00:00Z' });

    const second = countConnection(first, 'hst_1', '2026-08-14T11:00:00Z');
    expect(second.hst_1).toEqual({ count: 2, lastAt: '2026-08-14T11:00:00Z' });
  });

  it('leaves the other hosts alone', () => {
    const usage = countConnection(
      { hst_2: { count: 4, lastAt: '2026-01-01T00:00:00Z' } },
      'hst_1',
    );
    expect(usage.hst_2).toEqual({ count: 4, lastAt: '2026-01-01T00:00:00Z' });
  });
});
