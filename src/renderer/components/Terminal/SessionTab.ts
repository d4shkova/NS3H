import type { ITabRenderer, TabPartInitParameters } from 'dockview';

const CLOSE_PATH =
  'M2.1 27.3L0 25.2L11.55 13.65L0 2.1L2.1 0L13.65 11.55L25.2 0L27.3 2.1L15.75 13.65L27.3 25.2L25.2 27.3L13.65 15.75L2.1 27.3Z';

function closeIcon(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttributeNS(null, 'height', '11');
  svg.setAttributeNS(null, 'width', '11');
  svg.setAttributeNS(null, 'viewBox', '0 0 28 28');
  svg.setAttributeNS(null, 'aria-hidden', 'true');
  svg.setAttributeNS(null, 'focusable', 'false');
  svg.classList.add('dv-svg');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttributeNS(null, 'd', CLOSE_PATH);
  svg.appendChild(path);
  return svg;
}

/**
 * A session's tab.
 *
 * Drawn here rather than by dockview's own renderer for one reason: a right-click has to
 * arrive with the session it was aimed at already in hand. dockview's tab context menu is
 * an enterprise module, and the tab DOM it builds carries no panel id, so an event caught
 * on the strip could only be mapped back to a session by counting tab positions — which
 * is wrong the moment one is dragged.
 *
 * The markup is the default renderer's, class names included, so the theming in
 * `styles/dockview.css` applies to it unchanged and the tab looks like every other one.
 */
export function createSessionTab(
  sessionId: string,
  onContextMenu: (sessionId: string, event: MouseEvent) => void,
): ITabRenderer {
  const element = document.createElement('div');
  element.className = 'dv-default-tab';

  const content = document.createElement('div');
  content.className = 'dv-default-tab-content';

  const action = document.createElement('div');
  action.className = 'dv-default-tab-action';
  action.setAttribute('role', 'button');
  action.setAttribute('aria-label', 'Close session');
  action.setAttribute('tabindex', '-1');
  action.appendChild(closeIcon());

  element.append(content, action);

  const menu = (event: MouseEvent) => {
    // The browser's own menu would cover ours, and dockview's drag handling has no
    // interest in the secondary button.
    event.preventDefault();
    event.stopPropagation();
    onContextMenu(sessionId, event);
  };
  element.addEventListener('contextmenu', menu);

  // Both, as the default tab does: `pointerdown` stops the close button from starting a
  // tab drag, and the close itself is the click.
  const hold = (event: PointerEvent) => event.preventDefault();
  action.addEventListener('pointerdown', hold);

  const render = (title: string) => {
    content.textContent = title;
    action.setAttribute('aria-label', title ? `Close ${title}` : 'Close session');
  };

  let close: (() => void) | null = null;
  let unsubscribe: (() => void) | null = null;

  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    close?.();
  };
  action.addEventListener('click', onClick);

  return {
    element,
    init: (params: TabPartInitParameters) => {
      close = () => params.api.close();
      render(params.title);

      // The dock renames a tab when its session is renamed; without this the tab would
      // still be showing the name it was opened under.
      const listener = params.api.onDidTitleChange((event) => render(event.title));
      unsubscribe = () => listener.dispose();
    },
    dispose: () => {
      element.removeEventListener('contextmenu', menu);
      action.removeEventListener('pointerdown', hold);
      action.removeEventListener('click', onClick);
      unsubscribe?.();
    },
  };
}
