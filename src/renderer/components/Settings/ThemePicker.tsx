import { THEMES, type ThemeDefinition } from '@shared/themes.js';
import { useConfig } from '@renderer/stores/config.js';
import styles from './ThemePicker.module.css';

/**
 * A miniature of a terminal in the theme's own colours: background, a prompt line,
 * some output, and the palette along the bottom. Enough to judge a theme without
 * applying it.
 */
function Preview({ theme }: { theme: ThemeDefinition }): JSX.Element {
  const swatches = [
    theme.terminal.red,
    theme.terminal.green,
    theme.terminal.yellow,
    theme.terminal.blue,
    theme.terminal.magenta,
    theme.terminal.cyan,
  ];

  return (
    <span
      className={styles.preview}
      style={{ background: theme.terminal.background, borderColor: theme.tokens.border }}
      aria-hidden="true"
    >
      <span className={styles.previewBar} style={{ background: theme.tokens.bgPanel }} />
      <span className={styles.line} style={{ background: theme.terminal.green, width: '46%' }} />
      <span
        className={styles.line}
        style={{ background: theme.terminal.foreground, width: '72%' }}
      />
      <span className={styles.line} style={{ background: theme.terminal.cyan, width: '58%' }} />
      <span className={styles.swatches}>
        {swatches.map((colour) => (
          <span key={colour} className={styles.swatch} style={{ background: colour }} />
        ))}
      </span>
    </span>
  );
}

export function ThemePicker(): JSX.Element {
  const themeId = useConfig((state) => state.snapshot.settings.theme);
  const saveSettings = useConfig((state) => state.saveSettings);

  return (
    <div className={styles.grid}>
      {THEMES.map((theme) => (
        <button
          key={theme.id}
          type="button"
          className={`${styles.card} ${theme.id === themeId ? styles.selected : ''}`}
          onClick={() => void saveSettings({ theme: theme.id })}
          aria-pressed={theme.id === themeId}
        >
          <Preview theme={theme} />
          <span className={styles.meta}>
            <span className={styles.name}>{theme.name}</span>
            <span className={styles.mode}>
              {theme.id === themeId ? 'in use' : theme.mode}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
