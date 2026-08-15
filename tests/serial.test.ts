import { describe, expect, it } from 'vitest';
import { describePort } from '../src/main/serial/ports.js';
import { explainSerialError } from '../src/main/serial/connection.js';
import { explainSocketError } from '../src/main/telnet/connection.js';

describe('port labels', () => {
  it('shows the manufacturer alongside the path', () => {
    expect(describePort({ path: '/dev/ttyUSB0', manufacturer: 'FTDI FT232R' })).toBe(
      '/dev/ttyUSB0 — FTDI FT232R',
    );
  });

  it('prefers the friendly name Windows gives', () => {
    expect(
      describePort({ path: 'COM3', manufacturer: 'FTDI', friendlyName: 'USB Serial (COM3)' }),
    ).toBe('COM3 — USB Serial (COM3)');
  });

  it('falls back to the bare path when nothing else is known', () => {
    expect(describePort({ path: '/dev/ttyS0' })).toBe('/dev/ttyS0');
  });
});

describe('serial errors', () => {
  it('names the dialout fix instead of printing EACCES', () => {
    const message = explainSerialError(
      Object.assign(new Error('Permission denied, cannot open /dev/ttyUSB0'), { code: 'EACCES' }),
      '/dev/ttyUSB0',
    );
    expect(message).toContain('dialout');
    expect(message).toContain('usermod -aG dialout');
    expect(message).not.toContain('EACCES');
  });

  it('explains a missing device as an unplugged or renumbered adapter', () => {
    const message = explainSerialError(
      Object.assign(new Error('no such file or directory'), { code: 'ENOENT' }),
      '/dev/ttyUSB0',
    );
    expect(message).toMatch(/unplugged|renumbered/);
  });

  it('explains a busy port as another program holding it', () => {
    const message = explainSerialError(
      Object.assign(new Error('Resource busy'), { code: 'EBUSY' }),
      '/dev/ttyUSB0',
    );
    expect(message).toMatch(/in use by another program/);
  });

  it('passes an unrecognised error through rather than inventing advice', () => {
    expect(explainSerialError(new Error('something odd'), '/dev/ttyUSB0')).toBe('something odd');
  });
});

describe('telnet socket errors', () => {
  it('suggests the usual cause for a refused connection', () => {
    expect(
      explainSocketError(
        Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
        '10.1.1.5',
        23,
      ),
    ).toContain('Is telnet enabled');
  });

  it('mentions busy VTY lines on a reset, which is what usually causes it', () => {
    expect(
      explainSocketError(
        Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
        '10.1.1.5',
        23,
      ),
    ).toContain('VTY lines');
  });
});
