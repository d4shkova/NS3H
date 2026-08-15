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
 * Two rules, and both come down to the same idea — the pane shows the work, and the card
 * grid is what stands in when there is none:
 *
 * - **Home means the sessions, when there are sessions.** Open connections are the thing
 *   the user came back for, so Home lands on the dock and its tabs rather than on a menu
 *   they have to click through. Every card's destination is in the sidebar anyway.
 * - **The dock is never shown empty.** Asking for it with nothing open renders a dockview
 *   with no panels, which is a blank window — not an empty state, just nothing.
 *
 * File transfers are deliberately not part of this: they have their own tabs on their own
 * screen, so a transfer never competes with a terminal for the same pane.
 */
export function paneLayout(view: MainView, sessionCount: number): PaneLayout {
  const wantsSessions = view.kind === 'sessions' || view.kind === 'home';
  const dockUsable = wantsSessions && sessionCount > 0;

  return {
    showDock: dockUsable,
    showHome: wantsSessions && !dockUsable,
  };
}
