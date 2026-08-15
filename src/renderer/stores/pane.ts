import type { MainView } from './config.js';

export interface PaneLayout {
  /** The session dock is on screen and taking the pane. */
  showDock: boolean;
  /** The home screen is on screen — either asked for, or as a fallback. */
  showHome: boolean;
}

/**
 * What the main pane shows, given the view and how many sessions are open.
 *
 * The rule that is not obvious: **the dock is never shown empty.** Asking for the session
 * view with nothing open renders a dockview with no panels, which is a blank window — not
 * an empty state, just nothing. It is reachable from more than one direction (the file
 * transfer pane's back button, with a standalone transfer connection and no terminal
 * behind it, is the one that found it), so the fallback lives here rather than at each
 * call site: no sessions means the home screen, which is also where closing the last tab
 * already lands.
 */
export function paneLayout(view: MainView, sessionCount: number): PaneLayout {
  const dockAsked = view.kind === 'sessions';
  const dockUsable = dockAsked && sessionCount > 0;

  return {
    showDock: dockUsable,
    showHome: view.kind === 'home' || (dockAsked && !dockUsable),
  };
}
