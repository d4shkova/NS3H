import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SshTarget } from '../src/shared/types.js';

/**
 * Every connection the manager has built, in order. The fake stands in for `ssh2` so a
 * test can decide when a connection comes up, when it drops, and — the point of these
 * tests — say something on behalf of one that has already been replaced.
 */
interface FakeConnection {
  target: SshTarget;
  callbacks: {
    onData(chunk: Buffer): void;
    onConnected(negotiation: unknown): void;
    onClosed(detail: string): void;
    onError(detail: string): void;
  };
  closed: boolean;
  /** Every window size the manager pushed at this connection, in order. */
  sizes: { cols: number; rows: number }[];
  opened: boolean;
  /** Whether a size arrived before `open` — where an SSH pty is sized. */
  sizedBeforeOpen: boolean;
}

const connections: FakeConnection[] = [];

vi.mock('../src/main/ssh/connection.js', () => ({
  SshConnection: class implements FakeConnection {
    closed = false;
    sizes: { cols: number; rows: number }[] = [];
    opened = false;
    sizedBeforeOpen = false;

    constructor(
      readonly target: SshTarget,
      readonly callbacks: FakeConnection['callbacks'],
    ) {
      connections.push(this);
    }

    open(): Promise<void> {
      this.opened = true;
      return Promise.resolve();
    }
    write(): void {}
    resize(cols: number, rows: number): void {
      if (!this.opened) this.sizedBeforeOpen = true;
      this.sizes.push({ cols, rows });
    }
    close(): void {
      this.closed = true;
    }
  },
}));

const { SessionManager } = await import('../src/main/sessions/manager.js');

const target = (): SshTarget => ({
  name: 'core-sw-01',
  address: '10.1.1.5',
  port: 22,
  auth: { kind: 'password', username: 'admin', password: 'secret' },
});

interface Sent {
  channel: string;
  payload: { sessionId?: string; status?: string; data?: Uint8Array };
}

function machine(): { manager: InstanceType<typeof SessionManager>; sent: Sent[] } {
  const sent: Sent[] = [];
  const sender = {
    isDestroyed: () => false,
    send: (channel: string, payload: Sent['payload']) => sent.push({ channel, payload }),
  };
  return { manager: new SessionManager(sender as never), sent };
}

const statuses = (sent: Sent[]) =>
  sent.filter((entry) => entry.channel === 'session:status').map((entry) => entry.payload.status);

beforeEach(() => {
  connections.length = 0;
});

describe('reconnecting a session', () => {
  it('dials the same target again under the same session id', () => {
    // The tab, its terminal and the pane it was dragged to all belong to the id, so
    // keeping it is what makes this a reconnect rather than a second session.
    const { manager, sent } = machine();
    const sessionId = manager.openSsh(target(), { logging: false });
    connections[0].callbacks.onClosed('Connection reset by peer');

    manager.reconnect(sessionId);

    expect(connections).toHaveLength(2);
    expect(connections[1].target).toEqual(target());
    expect(sent.every((entry) => entry.payload.sessionId === sessionId)).toBe(true);
    expect(statuses(sent)).toEqual(['connecting', 'closed', 'connecting']);
  });

  it('reconnects a session that is still up', () => {
    const { manager, sent } = machine();
    const sessionId = manager.openSsh(target(), { logging: false });
    connections[0].callbacks.onConnected({ kex: 'k', cipher: 'c', mac: 'm' });

    manager.reconnect(sessionId);

    // The live link is dropped first — this is also how a wedged session is redialled.
    expect(connections[0].closed).toBe(true);
    expect(connections).toHaveLength(2);
    expect(statuses(sent)).toEqual(['connecting', 'connected', 'connecting']);
  });

  it('ignores the replaced connection as it tears down', () => {
    // A dropped connection does not go quiet at once: without the guard its parting
    // `closed` would land on the session that has just replaced it, and the tab would
    // show the new attempt as already dead.
    const { manager, sent } = machine();
    const sessionId = manager.openSsh(target(), { logging: false });
    connections[0].callbacks.onConnected({ kex: 'k', cipher: 'c', mac: 'm' });

    manager.reconnect(sessionId);
    connections[0].callbacks.onClosed('Socket closed');
    connections[0].callbacks.onData(Buffer.from('trailing output'));

    expect(statuses(sent)).toEqual(['connecting', 'connected', 'connecting']);
    expect(sent.some((entry) => entry.channel === 'session:data')).toBe(false);
  });

  it('tells a reconnected session how big the terminal already is', () => {
    // A new connection starts at the protocol default of 80x24, and the renderer has no
    // reason to mention the size again — nothing on its side resized. Without this the
    // device believes the terminal is 80 columns wide while it is drawn much wider, and
    // a long line recalled from the shell's history is drawn over the lines above it.
    const { manager } = machine();
    const sessionId = manager.openSsh(target(), { logging: false });
    manager.resize(sessionId, 203, 51);

    manager.reconnect(sessionId);

    expect(connections[1].sizes).toEqual([{ cols: 203, rows: 51 }]);
  });

  it('applies the remembered size before the connection is opened', () => {
    // Before, not after: an SSH session asks for its pty at open time, so a size that
    // arrives a moment later costs a resize the device has to redraw for.
    const { manager } = machine();
    const sessionId = manager.openSsh(target(), { logging: false });
    manager.resize(sessionId, 120, 30);
    manager.reconnect(sessionId);

    expect(connections[1].opened).toBe(true);
    expect(connections[1].sizes).toEqual([{ cols: 120, rows: 30 }]);
    expect(connections[1].sizedBeforeOpen).toBe(true);
  });

  it('forgets the size once the tab has gone', () => {
    const { manager } = machine();
    const sessionId = manager.openSsh(target(), { logging: false });
    manager.resize(sessionId, 203, 51);
    manager.close(sessionId);

    // A new session under a fresh id starts from the protocol default, as it should.
    const second = manager.openSsh(target(), { logging: false });
    expect(second).not.toBe(sessionId);
    expect(connections[1].sizes).toEqual([]);
  });

  it('refuses a session the tab has already been closed on', () => {
    // Closing the tab is what says the target is not wanted again; the resolved
    // credential goes with it rather than being held for the life of the window.
    const { manager } = machine();
    const sessionId = manager.openSsh(target(), { logging: false });
    manager.close(sessionId);

    expect(() => manager.reconnect(sessionId)).toThrow(/cannot be reconnected/);
    expect(connections).toHaveLength(1);
  });

  it('refuses a session id it has never seen', () => {
    const { manager } = machine();
    expect(() => manager.reconnect('ses_nope')).toThrow(/cannot be reconnected/);
  });
});
