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
  /** The last window size sent to the session, so an unchanged fit costs nothing. */
  reported?: { cols: number; rows: number };
  dispose(): void;
}

/** Roughly a fifth of a second at 60Hz — long enough for a pane to be laid out. */
const FOCUS_ATTEMPTS = 12;

/**
 * Whether something outside this terminal is genuinely taking typing — an auth prompt,
 * a search box, a form field. A button or the bare body is not a claim worth yielding to.
 */
function claimedByAnInput(element: HTMLElement): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || element.contains(active)) return false;
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement ||
    (active instanceof HTMLElement && active.isContentEditable)
  );
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
    const pasteFromClipboard = async (event: MouseEvent) => {
      event.preventDefault();
      const text = await window.ns3h.clipboard.read();
      if (!text) return;

      const multiline = /\r|\n/.test(text.trimEnd());
      if (multiline && this.hooks.warnOnMultilinePaste()) {
        if (!(await this.hooks.confirmPaste(text))) return;
      }
      void window.ns3h.session.write(sessionId, text);
    };
    const onContextMenu = (event: MouseEvent) => void pasteFromClipboard(event);
    element.addEventListener('contextmenu', onContextMenu);

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
        element.removeEventListener('contextmenu', onContextMenu);
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

  /**
   * Re-fits a terminal to its pane. Called from a ResizeObserver and from every
   * dockview layout change, so it fires in bursts while a splitter is dragged — the
   * window size is only sent on when it has actually changed, which keeps a drag from
   * putting a SSH window-change packet on the wire per mouse move.
   */
  resize(sessionId: string): void {
    const record = this.terminals.get(sessionId);
    if (!record || record.element.clientWidth === 0) return;
    record.fit.fit();

    const { cols, rows } = record.terminal;
    if (record.reported?.cols === cols && record.reported.rows === rows) return;
    record.reported = { cols, rows };
    void window.ns3h.session.resize(sessionId, cols, rows);
  }

  /** Writes an app-generated line. The session's terminal is created if needed. */
  write(sessionId: string, text: string): void {
    this.ensure(sessionId).terminal.writeln(text);
  }

  /**
   * Puts the keyboard into a session, and keeps asking until it lands.
   *
   * One call is not enough, and this is where the "click the terminal before you can
   * type" complaint came from. A session is focused at the moment its panel is created,
   * and at that moment `terminal.focus()` is a no-op more often than not: xterm focuses a
   * hidden textarea, and a textarea that is detached, in a pane of zero width, or in a
   * group dockview has not finished activating cannot take the focus. The click that
   * started the connection had already moved on, so nothing tried again and the session
   * sat there unfocused.
   *
   * macOS made it reliable rather than intermittent: WebKit and Chromium there do not
   * focus a button on click, so the pointer never left the element it started on, and the
   * activation dockview does asynchronously always landed after our one attempt.
   *
   * So the ask is repeated over the next few frames and stops the moment the terminal
   * actually holds the focus — or the moment something with a better claim does. A
   * device asking for a password puts an input on screen with `autoFocus`; that input
   * wins, because the alternative is typing a password into a terminal that grabbed the
   * caret back a frame later.
   */
  focus(sessionId: string, attempts = FOCUS_ATTEMPTS): void {
    const record = this.terminals.get(sessionId);
    if (!record) return;

    const attempt = (left: number) => {
      // Disposed, or replaced by a new session under the same id: stop asking.
      if (this.terminals.get(sessionId) !== record) return;
      if (record.element.contains(document.activeElement)) return;
      if (claimedByAnInput(record.element)) return;

      if (record.element.isConnected && record.element.clientWidth > 0) {
        record.terminal.focus();
        if (record.element.contains(document.activeElement)) return;
      }
      if (left > 0) requestAnimationFrame(() => attempt(left - 1));
    };

    attempt(attempts);
  }

  dispose(sessionId: string): void {
    this.terminals.get(sessionId)?.dispose();
  }
}

export const terminals = new TerminalRegistry();
