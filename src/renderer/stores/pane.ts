import type { MainView } from './config.js';

/**
 * The entries in the left-hand column. Each one names the view it opens, and stays
 * selected while the user works inside it — including while a session started from it
 * is on screen.
 */
export type SidebarSection =
  | 'home'
  | 'hosts'
  | 'credentials'
  | 'logs'
  | 'transfer'
  | 'quick';

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

/**
 * Where the pane goes when the last session is closed.
 *
 * The dock cannot be shown empty, so something has to take the pane — and what the user
 * chose in the left-hand column is what that should be. Sending them to Home instead
 * left the column saying "Hosts" over a screen that was not the host list: the selection
 * and the pane disagreed, and getting back meant clicking a menu entry that already
 * looked selected.
 *
 * Only the dock is replaced. A session can end while a form, Settings, or a log is what
 * the pane is showing; that is not a navigation the user asked for, and moving them off
 * it would lose whatever they were part-way through.
 */
export function viewAfterLastSession(view: MainView, section: SidebarSection): MainView {
  if (view.kind !== 'sessions' && view.kind !== 'home') return view;
  return { kind: section };
}
