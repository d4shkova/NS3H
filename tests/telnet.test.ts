import { describe, expect, it } from 'vitest';
import {
  DO,
  DONT,
  IAC,
  OPT_ECHO,
  OPT_NAWS,
  OPT_SGA,
  OPT_TTYPE,
  SB,
  SE,
  TelnetNegotiator,
  WILL,
  WONT,
  escapeOutbound,
} from '../src/main/telnet/iac.js';

const negotiator = () =>
  new TelnetNegotiator({ terminalType: 'xterm-256color', cols: 80, rows: 24 });

const bytes = (...values: number[]) => Buffer.from(values);

describe('option negotiation', () => {
  it('leads with a proposal so slow devices do not wait for us', () => {
    const opening = [...negotiator().initialNegotiation()];
    expect(opening).toEqual([
      IAC, WILL, OPT_TTYPE,
      IAC, WILL, OPT_NAWS,
      IAC, DO, OPT_SGA,
      IAC, DO, OPT_ECHO,
    ]);
  });

  it('agrees to terminal type and window size when asked', () => {
    const telnet = negotiator();
    // A fresh negotiator that has not sent its opening proposal.
    expect([...telnet.receive(bytes(IAC, DO, OPT_TTYPE)).reply]).toEqual([
      IAC, WILL, OPT_TTYPE,
    ]);
  });

  it('refuses everything it does not implement', () => {
    const telnet = negotiator();
    const { reply } = telnet.receive(bytes(IAC, DO, 5, IAC, DO, 34, IAC, WILL, 36));
    expect([...reply]).toEqual([
      IAC, WONT, 5,
      IAC, WONT, 34,
      IAC, DONT, 36,
    ]);
  });

  it('wants the device to suppress go-ahead and handle echo', () => {
    const telnet = negotiator();
    const { reply } = telnet.receive(bytes(IAC, WILL, OPT_SGA, IAC, WILL, OPT_ECHO));
    expect([...reply]).toEqual([IAC, DO, OPT_SGA, IAC, DO, OPT_ECHO]);
  });

  it('does not answer a request that would not change anything', () => {
    const telnet = negotiator();
    telnet.initialNegotiation(); // we already said WILL TTYPE
    expect([...telnet.receive(bytes(IAC, DO, OPT_TTYPE)).reply]).toEqual([]);
    // ...and a repeated refusal is not repeated either.
    telnet.receive(bytes(IAC, DO, 5));
    expect([...telnet.receive(bytes(IAC, DO, 5)).reply]).toEqual([]);
  });

  it('answers a terminal-type subnegotiation with xterm-256color', () => {
    const telnet = negotiator();
    const { reply } = telnet.receive(bytes(IAC, SB, OPT_TTYPE, 1, IAC, SE));
    expect([...reply]).toEqual([
      IAC, SB, OPT_TTYPE, 0,
      ...Buffer.from('xterm-256color', 'ascii'),
      IAC, SE,
    ]);
  });
});

describe('window size', () => {
  it('sends NAWS as soon as the device asks us to perform it', () => {
    const telnet = negotiator();
    const { reply } = telnet.receive(bytes(IAC, DO, OPT_NAWS));
    expect([...reply]).toEqual([
      IAC, WILL, OPT_NAWS,
      IAC, SB, OPT_NAWS, 0, 80, 0, 24, IAC, SE,
    ]);
  });

  it('reports a resize once NAWS is agreed, and stays quiet before that', () => {
    const telnet = negotiator();
    expect(telnet.resize(132, 43)).toBeNull();

    telnet.receive(bytes(IAC, DO, OPT_NAWS));
    expect([...telnet.resize(132, 43)!]).toEqual([
      IAC, SB, OPT_NAWS, 0, 132, 0, 43, IAC, SE,
    ]);
  });

  it('escapes a dimension byte of 255 so it is not read as a command', () => {
    const telnet = negotiator();
    telnet.receive(bytes(IAC, DO, OPT_NAWS));
    expect([...telnet.resize(255, 24)!]).toEqual([
      IAC, SB, OPT_NAWS, 0, IAC, IAC, 0, 24, IAC, SE,
    ]);
  });

  it('handles a width beyond one byte', () => {
    const telnet = negotiator();
    telnet.receive(bytes(IAC, DO, OPT_NAWS));
    expect([...telnet.resize(300, 24)!]).toEqual([
      IAC, SB, OPT_NAWS, 1, 44, 0, 24, IAC, SE,
    ]);
  });
});

describe('data extraction', () => {
  it('passes application data through untouched', () => {
    expect(negotiator().receive(Buffer.from('Router>')).data.toString()).toBe('Router>');
  });

  it('unescapes IAC IAC to a single 0xFF', () => {
    const { data } = negotiator().receive(bytes(0x41, IAC, IAC, 0x42));
    expect([...data]).toEqual([0x41, 0xff, 0x42]);
  });

  it('keeps commands out of the data stream', () => {
    const { data } = negotiator().receive(
      bytes(0x41, IAC, DO, OPT_TTYPE, 0x42, IAC, SB, OPT_TTYPE, 1, IAC, SE, 0x43),
    );
    expect(data.toString()).toBe('ABC');
  });

  it('survives a command split across chunks', () => {
    const telnet = negotiator();
    expect(telnet.receive(bytes(0x41, IAC)).data.toString()).toBe('A');
    expect(telnet.receive(bytes(DO)).data.toString()).toBe('');
    const third = telnet.receive(bytes(OPT_TTYPE, 0x42));
    expect(third.data.toString()).toBe('B');
    expect([...third.reply]).toEqual([IAC, WILL, OPT_TTYPE]);
  });

  it('survives a subnegotiation split across chunks', () => {
    const telnet = negotiator();
    telnet.receive(bytes(IAC, SB, OPT_TTYPE));
    telnet.receive(bytes(1, IAC));
    const { reply } = telnet.receive(bytes(SE));
    expect(reply.length).toBeGreaterThan(0);
    expect(reply.toString('ascii')).toContain('xterm-256color');
  });

  it('ignores two-byte commands that carry no option', () => {
    const NOP = 241;
    const { data, reply } = negotiator().receive(bytes(0x41, IAC, NOP, 0x42));
    expect(data.toString()).toBe('AB');
    expect([...reply]).toEqual([]);
  });
});

describe('outbound escaping', () => {
  it('doubles a literal 0xFF', () => {
    expect([...escapeOutbound(bytes(0x41, 0xff, 0x42))]).toEqual([0x41, IAC, IAC, 0x42]);
  });

  it('returns ordinary data unchanged', () => {
    const plain = Buffer.from('show running-config\r');
    expect(escapeOutbound(plain)).toBe(plain);
  });
});
