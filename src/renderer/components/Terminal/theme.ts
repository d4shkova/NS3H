import type { ITheme } from '@xterm/xterm';
import type { ThemeDefinition } from '@shared/themes.js';
import { currentTheme } from '@renderer/theme/apply.js';

/** The active theme's palette, in the shape xterm wants. */
export function xtermThemeFor(theme: ThemeDefinition = currentTheme()): ITheme {
  return { ...theme.terminal };
}

const RESET = '\x1b[0m';

function rgb(hex: string): string {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value;
  const number = Number.parseInt(full, 16);
  return `${(number >> 16) & 255};${(number >> 8) & 255};${number & 255}`;
}

/**
 * App-generated lines (connection banners, failures, notices) are written straight
 * into the terminal, so they are coloured with the theme's status colours rather than
 * fixed ones — otherwise they would clash with every palette but the default.
 */
function paint(colour: string, text: string): string {
  return `\x1b[38;2;${rgb(colour)}m${text}${RESET}`;
}

export const ansi = {
  error: (text: string) => paint(currentTheme().tokens.statusError, text),
  warn: (text: string) => paint(currentTheme().tokens.statusWarn, text),
  info: (text: string) => paint(currentTheme().tokens.textSecondary, text),
  ok: (text: string) => paint(currentTheme().tokens.statusOk, text),
};

/** Terminals need CRLF; notices are authored with plain newlines. */
export function toCrlf(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}
