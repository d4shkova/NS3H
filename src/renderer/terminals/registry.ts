import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { ansi, toCrlf, xtermThemeFor } from '@renderer/components/Terminal/theme.js';
import { onThemeChange } from '@renderer/theme/apply.js';

/**
 * Behaviour the registry cannot decide for itself: whether a multi-line paste needs
 * confirming, and how to ask. Set once by the app.
 */
export interface TerminalHooks {
  /** Resolves true to go ahead with the paste. */
  confirmPaste(text: string): Promise<boolean>;
  /** The user's current preference for warning on a multi-line paste. */
  warnOnMultilinePaste(): boolean;
}

export interface SessionTerminal {
  terminal: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  /** The element the terminal is rendered into. Re-parented, never recreated. */
  element: HTMLElement;
  dispose(): void;
}

/**
 * Terminals live here, outside React, keyed by session id.
 *
 * Dragging a tab to split a pane moves it to a different group, which unmounts and
 * remounts whatever renders it. If the xterm instance were owned by a React component
 * that would destroy the terminal and its scrollback on every drag — the session would
 * survive (it lives in main) but everything on screen would vanish.
 *
 * So the terminal owns a detached element that panes adopt and release. Moving a pane
 * re-parents one DOM node; the terminal never notices.
 */
class TerminalRegistry {
  private readonly terminals = new Map<string, SessionTerminal>();

  constructor() {
    // A theme change repaints every open session, not just new ones.
    onThemeChange((theme) => {
      for (const record of this.terminals.values()) {
        record.terminal.options.theme = xtermThemeFor(theme);
      }
    });
  }
  private hooks: TerminalHooks = {
    confirmPaste: async () => true,
    warnOnMultilinePaste: () => true,
  };

  configure(hooks: TerminalHooks): void {
    this.hooks = hooks;
  }

  get(sessionId: string): SessionTerminal | undefined {
    return this.terminals.get(sessionId);
  }

  /** Creates the terminal on first use, and wires it to the session's IPC streams. */
  ensure(sessionId: string, scrollback = 10000): SessionTerminal {
    const existing = this.terminals.get(sessionId);
    if (existing) return existing;

    const element = document.createElement('div');
    element.style.width = '100%';
    element.style.height = '100%';

    const terminal = new Terminal({
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Cascadia Mono', monospace",
      fontSize: 13,
      scrollback,
      cursorBlink: true,
      allowProposedApi: true,
      theme: xtermThemeFor(),
    });

    const fit = new FitAddon();
    const search = new SearchAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.open(element);

    try {
      // §2 — the WebGL renderer is required; large dumps chug without it.
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      terminal.loadAddon(webgl);
    } catch {
      terminal.writeln(ansi.warn('WebGL renderer unavailable — falling back to the DOM renderer.'));
    }

    const typing = terminal.onData((data) => void window.ns3h.session.write(sessionId, data));

    // Selecting text copies it, the way a terminal emulator is expected to behave.
    // Copying on mouseup rather than on every selection change keeps one clipboard
    // write per gesture instead of one per pixel of drag.
    const copySelection = () => {
      const selection = terminal.getSelection();
      if (selection) void window.ns3h.clipboard.write(selection);
    };
    element.addEventListener('mouseup', copySelection);

    // Right-click pastes. A paste of more than one line is submitted to the device
    // line by line the moment it arrives, so it is confirmed first unless the user
    // has turned that off.
    const onContextMenu = async (event: MouseEvent) => {
      event.preventDefault();
      const text = await window.ns3h.clipboard.read();
      if (!text) return;

      const multiline = /\r|\n/.test(text.trimEnd());
      if (multiline && this.hooks.warnOnMultilinePaste()) {
        if (!(await this.hooks.confirmPaste(text))) return;
      }
      void window.ns3h.session.write(sessionId, text);
    };
    element.addEventListener('contextmenu', (event) => void onContextMenu(event));

    const offData = window.ns3h.session.onData((event) => {
      if (event.sessionId === sessionId) terminal.write(event.data);
    });

    const offNotice = window.ns3h.session.onNotice((event) => {
      if (event.sessionId !== sessionId) return;
      const paint =
        event.level === 'error' ? ansi.error : event.level === 'warn' ? ansi.warn : ansi.info;
      terminal.writeln(paint(toCrlf(event.text)));
    });

    const record: SessionTerminal = {
      terminal,
      fit,
      search,
      element,
      dispose: () => {
        typing.dispose();
        element.removeEventListener('mouseup', copySelection);
        offData();
        offNotice();
        terminal.dispose();
        element.remove();
        this.terminals.delete(sessionId);
      },
    };

    this.terminals.set(sessionId, record);
    return record;
  }

  /** Moves the terminal's element into a pane. Safe to call repeatedly. */
  attach(sessionId: string, parent: HTMLElement): SessionTerminal {
    const record = this.ensure(sessionId);
    if (record.element.parentElement !== parent) parent.appendChild(record.element);
    // After the browser has laid the pane out, not before.
    requestAnimationFrame(() => this.resize(sessionId));
    return record;
  }

  resize(sessionId: string): void {
    const record = this.terminals.get(sessionId);
    if (!record || record.element.clientWidth === 0) return;
    record.fit.fit();
    void window.ns3h.session.resize(sessionId, record.terminal.cols, record.terminal.rows);
  }

  /** Writes an app-generated line. The session's terminal is created if needed. */
  write(sessionId: string, text: string): void {
    this.ensure(sessionId).terminal.writeln(text);
  }

  focus(sessionId: string): void {
    this.terminals.get(sessionId)?.terminal.focus();
  }

  dispose(sessionId: string): void {
    this.terminals.get(sessionId)?.dispose();
  }
}

export const terminals = new TerminalRegistry();
