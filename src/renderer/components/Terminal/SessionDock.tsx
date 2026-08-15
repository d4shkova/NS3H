import { useEffect, useRef } from 'react';
import { createDockview, type DockviewApi, type IContentRenderer } from 'dockview';
import { useSessions } from '@renderer/stores/sessions.js';
import { terminals } from '@renderer/terminals/registry.js';
import styles from './SessionDock.module.css';

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

  const tabs = useSessions((state) => state.tabs);
  const activeId = useSessions((state) => state.activeId);
  const setActive = useSessions((state) => state.setActive);
  const closeTab = useSessions((state) => state.closeTab);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const dock = createDockview(host, {
      className: 'dockview-theme-abyss',
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

  return <div ref={hostRef} className={styles.dock} />;
}
