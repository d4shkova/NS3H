import { describe, expect, it } from 'vitest';
import { paneLayout, viewAfterLastSession } from '../src/renderer/stores/pane.js';

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

describe('where the pane goes when the last session closes', () => {
  it('returns to the section the left-hand column is on', () => {
    // The bug this exists for: connecting from Hosts and then closing the session left
    // the column highlighting Hosts over the Home screen, and getting back meant
    // clicking a menu entry that already looked selected.
    expect(viewAfterLastSession({ kind: 'sessions' }, 'hosts')).toEqual({ kind: 'hosts' });
    expect(viewAfterLastSession({ kind: 'sessions' }, 'logs')).toEqual({ kind: 'logs' });
    expect(viewAfterLastSession({ kind: 'sessions' }, 'quick')).toEqual({ kind: 'quick' });
  });

  it('still lands on Home when Home is what is selected', () => {
    expect(viewAfterLastSession({ kind: 'sessions' }, 'home')).toEqual({ kind: 'home' });
    expect(viewAfterLastSession({ kind: 'home' }, 'home')).toEqual({ kind: 'home' });
  });

  it('leaves the pane alone when the dock is not what it is showing', () => {
    // A session can end behind a form or Settings — nothing the user did, and no reason
    // to move them off what they are part-way through.
    const views = [
      { kind: 'settings' as const },
      { kind: 'host-form' as const, host: null },
      { kind: 'transfer' as const },
      { kind: 'log-viewer' as const, path: '/logs/a.log', title: 'a' },
    ];

    for (const view of views) expect(viewAfterLastSession(view, 'hosts')).toBe(view);
  });
});
