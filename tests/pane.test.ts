import { describe, expect, it } from 'vitest';
import { paneLayout } from '../src/renderer/stores/pane.js';

describe('what the main pane shows', () => {
  it('shows the dock when there are sessions to put in it', () => {
    expect(paneLayout({ kind: 'sessions' }, 1)).toEqual({ showDock: true, showHome: false });
    expect(paneLayout({ kind: 'sessions' }, 4)).toEqual({ showDock: true, showHome: false });
  });

  it('never shows the dock empty', () => {
    // The bug this exists for: the file transfer pane's back button, with a standalone
    // transfer connection and no terminal session behind it, asked for the session view
    // and got a dockview with no panels — a blank window.
    expect(paneLayout({ kind: 'sessions' }, 0)).toEqual({ showDock: false, showHome: true });
  });

  it('lands Home on the open sessions rather than on the card grid', () => {
    // Home is where the user goes back to their work: with connections open, that is the
    // dock and its tabs, not a menu they have to click through.
    expect(paneLayout({ kind: 'home' }, 3)).toEqual({ showDock: true, showHome: false });
  });

  it('shows the card grid when there is no work to go back to', () => {
    expect(paneLayout({ kind: 'home' }, 0)).toEqual({ showDock: false, showHome: true });
  });

  it('leaves every other view to render itself', () => {
    const views = [
      { kind: 'transfer' as const },
      { kind: 'hosts' as const },
      { kind: 'credentials' as const },
      { kind: 'logs' as const },
      { kind: 'settings' as const },
      { kind: 'quick' as const },
      { kind: 'log-viewer' as const, path: '/logs/a.log', title: 'a' },
    ];

    for (const view of views) {
      // Neither the dock nor the home fallback: these views own the pane themselves, and
      // they do it whether or not sessions are open behind them.
      expect(paneLayout(view, 0)).toEqual({ showDock: false, showHome: false });
      expect(paneLayout(view, 2)).toEqual({ showDock: false, showHome: false });
    }
  });
});
