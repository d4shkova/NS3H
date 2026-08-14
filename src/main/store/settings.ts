import { DEFAULT_SETTINGS, type Settings } from '@shared/config.js';
import { ConfigFile, configPath } from './paths.js';
import { JsonStore } from './jsonStore.js';

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
    theme: typeof settings.theme === 'string' ? settings.theme : DEFAULT_SETTINGS.theme,
    fontFamily:
      typeof settings.fontFamily === 'string' && settings.fontFamily.length > 0
        ? settings.fontFamily
        : DEFAULT_SETTINGS.fontFamily,
    fontSize: clamp(settings.fontSize, 8, 32, DEFAULT_SETTINGS.fontSize),
    scrollback: clamp(settings.scrollback, 100, 1_000_000, DEFAULT_SETTINGS.scrollback),
    // §6.2 — the sidebar is draggable between 15% and 35%.
    sidebarWidth: clamp(settings.sidebarWidth, 15, 35, DEFAULT_SETTINGS.sidebarWidth),
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
