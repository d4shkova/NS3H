import { useEffect, useRef, useState } from 'react';
import { createDockview, type DockviewApi, type IContentRenderer } from 'dockview';
import { useSessions } from '@renderer/stores/sessions.js';
import { terminals } from '@renderer/terminals/registry.js';
import { createSessionTab } from './SessionTab.js';
import styles from './SessionDock.module.css';

/** An open tab menu: where it was asked for, and which session it belongs to. */
interface MenuState {
  x: number;
  y: number;
  sessionId: string;
}

/**
 * The session area (§6.4): tabs across the top, and dragging a tab to an edge of the
 * terminal area splits the pane in that direction. Each pane holds one session.
 *
 * dockview's vanilla API is used rather than its React bindings, because the panel
 * content is a terminal element the registry owns — there is no React tree inside a
 * pane to reconcile, and a drag becomes a DOM re-parent rather than a remount.
 */
export function SessionDock(): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<DockviewApi | null>(null);
  /** Panels currently in the dock, so tab changes can be diffed against sessions. */
  const panels = useRef(new Set<string>());

  const [menu, setMenu] = useState<MenuState | null>(null);

  const tabs = useSessions((state) => state.tabs);
  const activeId = useSessions((state) => state.activeId);
  const setActive = useSessions((state) => state.setActive);
  const closeTab = useSessions((state) => state.closeTab);
  const reconnect = useSessions((state) => state.reconnect);

  useEffect(() => {
    if (!menu) return undefined;
    const dismiss = () => setMenu(null);
    window.addEventListener('click', dismiss);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('click', dismiss);
      window.removeEventListener('resize', dismiss);
    };
  }, [menu]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const dock = createDockview(host, {
      className: 'dockview-theme-abyss',
      // Every panel is a session, so they all get the tab that carries the session menu.
      defaultTabComponent: 'session',
      createTabComponent: (options) =>
        createSessionTab(options.id, (sessionId, event) =>
          setMenu({ x: event.clientX, y: event.clientY, sessionId }),
        ),
      createComponent: (options): IContentRenderer => {
        const element = document.createElement('div');
        element.className = styles.pane;
        // Each pane watches its own box: a split resizes panes independently, and a
        // terminal that is not re-fitted keeps the old column count and wraps.
        const observer = new ResizeObserver(() => terminals.resize(options.id));
        return {
          element,
          init: () => {
            terminals.attach(options.id, element);
            observer.observe(element);
          },
          dispose: () => observer.disconnect(),
        };
      },
    });

    apiRef.current = dock;

    // Clicking a tab, or dragging one into another group, changes the active panel.
    // `origin` separates that from our own setActive below, so the two cannot loop.
    const activeSub = dock.onDidActivePanelChange((event) => {
      if (event.origin === 'user' && event.panel) {
        useSessions.getState().setActive(event.panel.id);
      }
    });

    // A panel closed from its own × is a session the user wants gone.
    const removeSub = dock.onDidRemovePanel((panel) => {
      if (!panels.current.delete(panel.id)) return;
      if (useSessions.getState().tabs.some((tab) => tab.id === panel.id)) {
        useSessions.getState().closeTab(panel.id);
      }
      terminals.dispose(panel.id);
    });

    // A layout change settles over a frame, so measure after it has been applied.
    const onResize = () => {
      requestAnimationFrame(() => {
        for (const id of panels.current) terminals.resize(id);
      });
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(host);
    const layoutSub = dock.onDidLayoutChange(onResize);

    return () => {
      observer.disconnect();
      activeSub.dispose();
      removeSub.dispose();
      layoutSub.dispose();
      dock.dispose();
      apiRef.current = null;
      panels.current.clear();
    };
  }, [setActive, closeTab]);

  // Sessions are the source of truth; panels follow them.
  useEffect(() => {
    const dock = apiRef.current;
    if (!dock) return;

    for (const tab of tabs) {
      if (panels.current.has(tab.id)) {
        const panel = dock.getPanel(tab.id);
        if (panel && panel.title !== tab.name) panel.setTitle(tab.name);
        continue;
      }
      panels.current.add(tab.id);
      terminals.ensure(tab.id);
      dock.addPanel({ id: tab.id, component: 'terminal', title: tab.name });
    }

    for (const id of [...panels.current]) {
      if (tabs.some((tab) => tab.id === id)) continue;
      panels.current.delete(id);
      dock.getPanel(id)?.api.close();
      terminals.dispose(id);
    }
  }, [tabs]);

  useEffect(() => {
    const dock = apiRef.current;
    if (!dock || !activeId) return;
    const panel = dock.getPanel(activeId);
    if (panel && !panel.api.isActive) panel.api.setActive();
    terminals.focus(activeId);
  }, [activeId]);

  const menuTab = menu ? tabs.find((tab) => tab.id === menu.sessionId) : undefined;

  return (
    <>
      <div ref={hostRef} className={styles.dock} />

      {menu && menuTab && (
        <div
          className={styles.menu}
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => {
              void reconnect(menu.sessionId);
              setMenu(null);
            }}
          >
            {/* One item, two jobs: a session that dropped is dialled again, and one that
                is still up is dropped first and then dialled — which is what a wedged
                connection needs. */}
            {menuTab.status === 'connected' ? 'Reconnect' : 'Connect again'}
          </button>
        </div>
      )}
    </>
  );
}
