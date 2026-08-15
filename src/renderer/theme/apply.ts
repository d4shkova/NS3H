import { DEFAULT_THEME_ID, getTheme, type ThemeDefinition } from '@shared/themes.js';

/** CSS custom property per token, matching the names in `styles/tokens.css`. */
const TOKEN_VARIABLES: Record<keyof ThemeDefinition['tokens'], string> = {
  bgBase: '--bg-base',
  bgPanel: '--bg-panel',
  bgElevated: '--bg-elevated',
  bgHover: '--bg-hover',
  border: '--border',
  borderFocus: '--border-focus',
  textPrimary: '--text-primary',
  textSecondary: '--text-secondary',
  textTertiary: '--text-tertiary',
  accent: '--accent',
  accentHover: '--accent-hover',
  accentMuted: '--accent-muted',
  statusOk: '--status-ok',
  statusWarn: '--status-warn',
  statusError: '--status-error',
};

let current: ThemeDefinition = getTheme(DEFAULT_THEME_ID);
const listeners = new Set<(theme: ThemeDefinition) => void>();

export function currentTheme(): ThemeDefinition {
  return current;
}

/** Notified whenever the theme changes — the terminal registry uses this. */
export function onThemeChange(listener: (theme: ThemeDefinition) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Writes the theme's tokens onto the document root. Everything styled through the
 * tokens — including dockview, whose variables are mapped onto them — follows
 * automatically; only the terminals need telling, which is what the listeners are for.
 */
export function applyTheme(id: string | undefined): ThemeDefinition {
  const theme = getTheme(id);
  if (theme.id === current.id && document.documentElement.dataset.theme === theme.id) {
    return theme;
  }

  const root = document.documentElement;
  for (const [token, variable] of Object.entries(TOKEN_VARIABLES)) {
    root.style.setProperty(variable, theme.tokens[token as keyof ThemeDefinition['tokens']]);
  }

  // Lets CSS respond to light themes where a token alone is not enough — a form
  // control's own chrome, for instance.
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.mode;

  current = theme;
  for (const listener of listeners) listener(theme);
  return theme;
}
