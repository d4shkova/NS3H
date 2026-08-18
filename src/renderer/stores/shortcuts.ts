import type { Host, HostUsage } from '@shared/config.js';

/** How many of the busiest hosts the sidebar lists before the favourites. */
export const FREQUENT_LIMIT = 7;

/** Which of the two lists the user has left switched on. */
export interface ShortcutOptions {
  frequent: boolean;
  favorites: boolean;
}

export interface Shortcuts {
  /** The hosts connected to most often, busiest first. */
  frequent: Host[];
  /** Hosts the user marked, minus any already listed above. */
  favorites: Host[];
}

/**
 * What the sidebar column holds: the seven hosts connected to most often, then the ones
 * marked as favourites.
 *
 * The two lists are deliberately disjoint. A device that is both a favourite and one of
 * the busiest is listed once, under Frequent — showing it twice in one column is the
 * duplication this replaced, only smaller.
 *
 * Ordering inside Frequent is by count, then by which was used most recently, then by
 * name, so the column is stable: two hosts on one connection each do not swap places
 * every time the app is opened.
 */
export function shortcutsFor(
  hosts: Host[],
  usage: Record<string, HostUsage>,
  options: ShortcutOptions = { frequent: true, favorites: true },
): Shortcuts {
  const countOf = (host: Host) => usage[host.id]?.count ?? 0;
  const lastOf = (host: Host) => usage[host.id]?.lastAt ?? '';

  const frequent = !options.frequent
    ? []
    : hosts
        .filter((host) => countOf(host) > 0)
        .sort(
          (a, b) =>
            countOf(b) - countOf(a) ||
            lastOf(b).localeCompare(lastOf(a)) ||
            a.name.localeCompare(b.name),
        )
        .slice(0, FREQUENT_LIMIT);

  /**
   * Only what is actually on screen is deduplicated against. With Frequent switched off
   * a favourite is not being shown twice by appearing here — it is the only place it
   * could appear, and leaving it out would hide it entirely.
   */
  const listed = new Set(frequent.map((host) => host.id));
  const favorites = !options.favorites
    ? []
    : hosts
        .filter((host) => host.favorite && !listed.has(host.id))
        .sort((a, b) => a.name.localeCompare(b.name));

  return { frequent, favorites };
}

/** One connection, recorded. Returns the whole map, which is what settings stores. */
export function countConnection(
  usage: Record<string, HostUsage>,
  hostId: string,
  at = new Date().toISOString(),
): Record<string, HostUsage> {
  return { ...usage, [hostId]: { count: (usage[hostId]?.count ?? 0) + 1, lastAt: at } };
}
