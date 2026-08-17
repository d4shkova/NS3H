import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_ID,
  THEMES,
  getTheme,
  isKnownTheme,
  resolveThemeId,
  type TerminalPalette,
  type ThemeTokens,
} from '../src/shared/themes.js';
import { normaliseSettings } from '../src/main/store/settings.js';

const TOKEN_KEYS: (keyof ThemeTokens)[] = [
  'bgBase', 'bgPanel', 'bgElevated', 'bgHover',
  'border', 'borderFocus',
  'textPrimary', 'textSecondary', 'textTertiary',
  'accent', 'accentHover', 'accentMuted',
  'statusOk', 'statusWarn', 'statusError',
];

const PALETTE_KEYS: (keyof TerminalPalette)[] = [
  'background', 'foreground', 'cursor', 'selectionBackground',
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
];

const COLOUR = /^(#[0-9a-fA-F]{6}|rgba?\([\d.,\s]+\))$/;

describe('theme definitions', () => {
  it('has unique ids and names', () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    expect(new Set(THEMES.map((t) => t.name)).size).toBe(THEMES.length);
  });

  it('defines every design token, as a usable colour', () => {
    for (const theme of THEMES) {
      for (const key of TOKEN_KEYS) {
        expect(theme.tokens[key], `${theme.id}.${key}`).toMatch(COLOUR);
      }
    }
  });

  it('takes a usable colour for the recording light where one is named', () => {
    // Optional: a theme sets it only when its error red is not the red it wants
    // blinking, and the app falls back to statusError otherwise.
    for (const theme of THEMES) {
      if (theme.tokens.recordDot === undefined) continue;
      expect(theme.tokens.recordDot, `${theme.id}.recordDot`).toMatch(COLOUR);
    }
  });

  it('defines the full 16-colour palette plus background, foreground and cursor', () => {
    for (const theme of THEMES) {
      for (const key of PALETTE_KEYS) {
        expect(theme.terminal[key], `${theme.id}.${key}`).toMatch(COLOUR);
      }
    }
  });

  it('keeps the terminal background in step with the chrome', () => {
    // A light chrome with a black terminal reads as a bug, not a theme.
    for (const theme of THEMES) {
      const luminance = (hex: string) => {
        const value = Number.parseInt(hex.replace('#', ''), 16);
        return (((value >> 16) & 255) + ((value >> 8) & 255) + (value & 255)) / 3;
      };
      const chrome = luminance(theme.tokens.bgBase);
      const terminal = luminance(theme.terminal.background);
      expect(Math.abs(chrome - terminal), `${theme.id} chrome vs terminal`).toBeLessThan(60);
      if (theme.mode === 'light') expect(chrome).toBeGreaterThan(128);
      else expect(chrome).toBeLessThan(128);
    }
  });

  it('keeps foreground and background apart enough to read', () => {
    for (const theme of THEMES) {
      const value = (hex: string) => {
        const n = Number.parseInt(hex.replace('#', ''), 16);
        return (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000;
      };
      const gap = Math.abs(value(theme.terminal.foreground) - value(theme.terminal.background));
      expect(gap, `${theme.id} contrast`).toBeGreaterThan(90);
    }
  });

  it('includes the default, first', () => {
    expect(THEMES[0].id).toBe(DEFAULT_THEME_ID);
  });
});

describe('theme lookup', () => {
  it('falls back to the default for an unknown id', () => {
    expect(getTheme('nope').id).toBe(DEFAULT_THEME_ID);
    expect(getTheme(undefined).id).toBe(DEFAULT_THEME_ID);
  });

  it('recognises known ids only', () => {
    expect(isKnownTheme('skumring')).toBe(true);
    expect(isKnownTheme('dark-red')).toBe(false);
    expect(isKnownTheme(42)).toBe(false);
    // A renamed theme's old id is no longer one of the set — it is resolved, not known.
    expect(isKnownTheme('kanagawa-wave')).toBe(false);
  });

  it('carries an id from before the rename forward to its theme', () => {
    // A settings file written by an earlier build names the old id. Dropping to the
    // default there would look like the app forgetting the chosen theme.
    expect(getTheme('kanagawa-wave').id).toBe('skumring');
    expect(getTheme('everforest-light').id).toBe('bjork');
    expect(getTheme('hacker-red').id).toBe('falurod');
    expect(getTheme('ns3h-dark').id).toBe(DEFAULT_THEME_ID);
  });

  it('has a forward mapping for every renamed theme, pointing at a real one', () => {
    const ids = new Set(THEMES.map((theme) => theme.id));
    const old = [
      'ns3h-dark', 'ns3h-light', 'kanagawa-wave', 'kanagawa-dragon', 'kanagawa-lotus',
      'everforest-dark', 'everforest-light', 'night-owl', 'light-owl',
      'flexoki-dark', 'flexoki-light', 'hacker-green', 'hacker-blue', 'hacker-red',
    ];
    for (const id of old) {
      expect(ids.has(resolveThemeId(id)), `${id} resolves to a theme that exists`).toBe(true);
    }

    // Landing on the default would mean the mapping is missing, not that it worked —
    // except for the theme that *is* the default, which is where it should land.
    const collapsed = old.filter((id) => resolveThemeId(id) === DEFAULT_THEME_ID);
    expect(collapsed).toEqual(['ns3h-dark']);
  });

  it('drops nothing Scandinavian on the floor', () => {
    // Every name in the picker is the app's own; none is borrowed from another client.
    const borrowed = /kanagawa|everforest|owl|flexoki|hacker/i;
    for (const theme of THEMES) {
      expect(theme.name, `${theme.id} name`).not.toMatch(borrowed);
      expect(theme.id, `${theme.id} id`).not.toMatch(borrowed);
    }
  });
});

describe('stored setting', () => {
  it('keeps a valid theme', () => {
    expect(normaliseSettings({ theme: 'furu' }).theme).toBe('furu');
  });

  it('rewrites an id from before the rename, so it is translated once', () => {
    expect(normaliseSettings({ theme: 'everforest-dark' }).theme).toBe('furu');
  });

  it('replaces one that no longer exists, including the pre-theme value', () => {
    expect(normaliseSettings({ theme: 'dark-red' }).theme).toBe(DEFAULT_THEME_ID);
    expect(normaliseSettings({ theme: 'removed-theme' }).theme).toBe(DEFAULT_THEME_ID);
  });
});
