import type { ITheme } from '@xterm/xterm';

/** Derived from the design tokens in §6.1. */
export const xtermTheme: ITheme = {
  background: '#0A0A0B',
  foreground: '#F5F5F7',
  cursor: '#E5484D',
  selectionBackground: 'rgba(229, 72, 77, 0.28)',
  black: '#1B1B1F',
  brightBlack: '#6A6A72',
  red: '#E5484D',
  brightRed: '#F2555A',
  green: '#3DD68C',
  brightGreen: '#56E39F',
  yellow: '#F5A623',
  brightYellow: '#FFBF47',
  blue: '#5B9DF5',
  brightBlue: '#7DB3F7',
  magenta: '#C678DD',
  brightMagenta: '#D89BE8',
  cyan: '#4CC9C0',
  brightCyan: '#6FDDD5',
  white: '#D8D8DE',
  brightWhite: '#FFFFFF',
};

const RESET = '\x1b[0m';

export const ansi = {
  error: (text: string) => `\x1b[38;2;229;72;77m${text}${RESET}`,
  warn: (text: string) => `\x1b[38;2;245;166;35m${text}${RESET}`,
  info: (text: string) => `\x1b[38;2;154;154;162m${text}${RESET}`,
  ok: (text: string) => `\x1b[38;2;61;214;140m${text}${RESET}`,
};

/** Terminals need CRLF; notices are authored with plain newlines. */
export function toCrlf(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}
