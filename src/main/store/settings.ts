import { DEFAULT_SETTINGS, type HostUsage, type Settings } from '@shared/config.js';
import { resolveThemeId } from '@shared/themes.js';
import { ConfigFile, configPath } from './paths.js';
import { JsonStore } from './jsonStore.js';

/**
 * Folder ids from a file that may have been edited by hand: strings only, no duplicates,
 * and a bound so a malformed file cannot grow this without limit. Ids that no longer
 * match a folder are harmless and are left alone — a folder can come back on an import,
 * and it should come back folded the way it was left.
 */
function folderIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((id): id is string => typeof id === 'string' && id.length > 0);
  return [...new Set(ids)].slice(0, 500);
}

/**
 * Connection counts from a file that may have been edited by hand.
 *
 * Bounded twice over: a count is a non-negative integer, and the map keeps only the
 * busiest few hundred hosts. Nothing prunes entries for hosts that have been deleted —
 * an id that no longer resolves is skipped when the list is built, and a host that comes
 * back on an import comes back with its history rather than starting from nothing.
 */
function hostUsage(value: unknown): Record<string, HostUsage> {
  if (typeof value !== 'object' || value === null) return {};

  const entries: [string, HostUsage][] = [];
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (id.length === 0 || typeof raw !== 'object' || raw === null) continue;
    const usage = raw as Partial<HostUsage>;
    const count =
      typeof usage.count === 'number' && Number.isFinite(usage.count)
        ? Math.min(1_000_000, Math.max(0, Math.floor(usage.count)))
        : 0;
    if (count === 0) continue;
    entries.push([id, { count, lastAt: typeof usage.lastAt === 'string' ? usage.lastAt : '' }]);
  }

  entries.sort((a, b) => b[1].count - a[1].count);
  return Object.fromEntries(entries.slice(0, 500));
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

export function normaliseSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS;
  const settings = raw as Partial<Settings>;
  return {
    version: 1,
    logDirectory:
      typeof settings.logDirectory === 'string' && settings.logDirectory.length > 0
        ? settings.logDirectory
        : null,
    // An unknown id — a hand-edited file, or a theme removed in a later version — falls
    // back rather than leaving the app unstyled. An id from before the themes were
    // renamed is carried forward to its new one, and rewritten here so it only has to be
    // translated once.
    theme: resolveThemeId(settings.theme),
    fontFamily:
      typeof settings.fontFamily === 'string' && settings.fontFamily.length > 0
        ? settings.fontFamily
        : DEFAULT_SETTINGS.fontFamily,
    fontSize: clamp(settings.fontSize, 8, 32, DEFAULT_SETTINGS.fontSize),
    scrollback: clamp(settings.scrollback, 100, 1_000_000, DEFAULT_SETTINGS.scrollback),
    // §6.2 — the sidebar is draggable between 15% and 35%.
    sidebarWidth: clamp(settings.sidebarWidth, 15, 35, DEFAULT_SETTINGS.sidebarWidth),
    collapsedFolders: folderIds(settings.collapsedFolders),
    hostUsage: hostUsage(settings.hostUsage),
    // Default on: pasting several lines into a live device is worth a pause.
    pasteWarnMultiline: settings.pasteWarnMultiline !== false,
  };
}

export function applySettings(current: Settings, patch: Partial<Settings>): Settings {
  return normaliseSettings({ ...current, ...patch, version: 1 });
}

export function createSettingsStore(dir?: string): JsonStore<Settings> {
  return new JsonStore<Settings>({
    file: configPath(ConfigFile.settings, dir),
    fallback: DEFAULT_SETTINGS,
    normalise: normaliseSettings,
  });
}
