import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import styles from './FileMenu.module.css';

export interface FileMenuItem {
  label: string;
  onSelect: () => void;
  /** Drawn in the warning colour: deleting, and nothing else so far. */
  danger?: boolean;
  disabled?: boolean;
  /** Puts a rule above this item, grouping what follows. */
  separated?: boolean;
}

export interface FileMenuState {
  x: number;
  y: number;
  /** What the menu is about, shown greyed at the top so a mis-aimed click is obvious. */
  subject: string;
  items: FileMenuItem[];
}

/**
 * The right-click menu for a file pane.
 *
 * It replaced the single arrow button each row used to carry, which did the one thing it
 * could — send the file the other way — and read as a back button while doing it. A menu
 * can say what it is offering, and has room for the rest of what a file needs: renaming,
 * deleting, permissions, a new folder.
 *
 * Positioned against the pointer and then pulled back inside the window, so a row near
 * the bottom or the right-hand edge does not open a menu half off screen.
 */
export function FileMenu({
  menu,
  onDismiss,
}: {
  menu: FileMenuState;
  onDismiss: () => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState({ left: menu.x, top: menu.y });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const margin = 8;
    setAt({
      left: Math.max(margin, Math.min(menu.x, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(menu.y, window.innerHeight - height - margin)),
    });
  }, [menu]);

  useEffect(() => {
    const dismiss = () => onDismiss();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    // `click` rather than `mousedown`: the click that opened this menu is a right button
    // press, and closing on any press would swallow the first left click on an item.
    window.addEventListener('click', dismiss);
    window.addEventListener('resize', dismiss);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', dismiss);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('keydown', onKey);
    };
  }, [onDismiss]);

  return (
    <div
      ref={ref}
      className={styles.menu}
      style={at}
      role="menu"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className={styles.subject}>{menu.subject}</div>
      {menu.items.map((item, index) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className={[
            styles.item,
            item.danger ? styles.danger : '',
            item.separated && index > 0 ? styles.separated : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => {
            onDismiss();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
