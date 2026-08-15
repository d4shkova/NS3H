import { describe, expect, it } from 'vitest';
import { StreamSanitizer } from '../src/main/logging/sanitize.js';

/** Feed a whole string through and return everything the sanitiser produced. */
function clean(...chunks: string[]): string {
  const sanitizer = new StreamSanitizer();
  let out = '';
  for (const chunk of chunks) out += sanitizer.write(Buffer.from(chunk, 'binary'));
  return out + sanitizer.flush();
}

describe('escape sequences', () => {
  it('strips SGR colour codes but keeps the text', () => {
    expect(clean('\x1b[31mGigabitEthernet0/1\x1b[0m is up\n')).toBe(
      'GigabitEthernet0/1 is up\n',
    );
  });

  it('strips OSC window-title sequences, BEL- and ST-terminated', () => {
    expect(clean('\x1b]0;router\x07up\n')).toBe('up\n');
    expect(clean('\x1b]0;router\x1b\\up\n')).toBe('up\n');
  });

  it('drops character-set designators without eating the next character', () => {
    expect(clean('\x1b(Bhello\n')).toBe('hello\n');
  });

  it('survives an escape sequence split across chunks', () => {
    expect(clean('\x1b', '[31mred\x1b[0', 'm done\n')).toBe('red done\n');
  });
});

describe('line endings', () => {
  it('normalises CRLF to a single newline', () => {
    expect(clean('line one\r\nline two\r\n')).toBe('line one\nline two\n');
  });

  it('emits a trailing partial line on flush', () => {
    expect(clean('Router#')).toBe('Router#\n');
  });
});

describe('overwrite resolution', () => {
  it('honours backspace', () => {
    expect(clean('cisco\b\b\b\bXYZ\n')).toBe('cXYZo\n');
  });

  it('rubs out a --More-- prompt the way a pager does', () => {
    // The classic sequence: print the prompt, then back over it with spaces.
    const erase = '\b'.repeat(8) + ' '.repeat(8) + '\b'.repeat(8);
    expect(clean(`--More--${erase}interface Vlan1\n`)).toBe('interface Vlan1\n');
  });

  it('treats a bare carriage return as a rewrite, not a new line', () => {
    expect(clean('50%\rDone\n')).toBe('Done\n');
  });

  it('leaves the tail of a longer line a short rewrite does not cover', () => {
    // Not a quirk — this is what the screen shows. A device that means to clear the
    // rest of the line sends EL after the CR, which the test below covers.
    expect(clean('Building configuration...\rDone\n')).toBe('Doneding configuration...\n');
  });

  it('keeps only the final state of a repeatedly rewritten line', () => {
    expect(clean('10%\r50%\r100%\n')).toBe('100%\n');
  });

  it('resolves erase-in-line after a carriage return', () => {
    expect(clean('Building configuration...\r\x1b[KDone\n')).toBe('Done\n');
  });

  it('handles cursor-back and cursor-column moves', () => {
    expect(clean('abcdef\x1b[3DXYZ\n')).toBe('abcXYZ\n');
    expect(clean('abcdef\x1b[1GZ\n')).toBe('Zbcdef\n');
  });

  it('pads with spaces when the cursor moves past the end of the line', () => {
    expect(clean('ab\x1b[6Gz\n')).toBe('ab   z\n');
  });

  it('trims the trailing spaces an overwrite leaves behind', () => {
    expect(clean('interface Vlan1        \r\x1b[0Kinterface Vlan1\n')).toBe(
      'interface Vlan1\n',
    );
  });
});

describe('a paged show running-config', () => {
  /**
   * The §11 acceptance check. This is a real-shaped IOS pager exchange: output, a
   * --More-- prompt, the erase sequence when space is pressed, then more output.
   */
  it('produces a readable log with no backspace artifacts', () => {
    const erase = `${'\b'.repeat(8)}${' '.repeat(8)}${'\b'.repeat(8)}`;
    const raw = [
      'Building configuration...\r\n',
      '\r\n',
      'Current configuration : 1543 bytes\r\n',
      '!\r\n',
      'version 12.2\r\n',
      `--More--${erase}`,
      'hostname core-sw-01\r\n',
      '!\r\n',
      `--More--${erase}`,
      'interface Vlan1\r\n',
      ' ip address 10.1.1.5 255.255.255.0\r\n',
      'end\r\n',
    ].join('');

    const output = clean(raw);

    expect(output).toBe(
      [
        'Building configuration...',
        '',
        'Current configuration : 1543 bytes',
        '!',
        'version 12.2',
        'hostname core-sw-01',
        '!',
        'interface Vlan1',
        ' ip address 10.1.1.5 255.255.255.0',
        'end',
      ].join('\n') + '\n',
    );
    expect(output).not.toContain('\b');
    expect(output).not.toContain('--More--');
    expect(output).not.toMatch(/\x1b/);
  });

  it('reaches the same result when chunk boundaries fall anywhere', () => {
    const erase = `${'\b'.repeat(8)}${' '.repeat(8)}${'\b'.repeat(8)}`;
    const raw = `version 12.2\r\n--More--${erase}hostname core-sw-01\r\n`;
    const whole = clean(raw);

    for (let split = 1; split < raw.length; split += 1) {
      expect(clean(raw.slice(0, split), raw.slice(split))).toBe(whole);
    }
  });
});

describe('encoding', () => {
  it('reassembles a UTF-8 character split across chunks', () => {
    const bytes = Buffer.from('café\n', 'utf8');
    const sanitizer = new StreamSanitizer();
    // The é is two bytes; split between them.
    const cut = bytes.indexOf(0xc3) + 1;
    const out =
      sanitizer.write(bytes.subarray(0, cut)) +
      sanitizer.write(bytes.subarray(cut)) +
      sanitizer.flush();
    expect(out).toBe('café\n');
  });

  it('drops stray control bytes but keeps tabs', () => {
    expect(clean('a\x00b\x07c\td\n')).toBe('abc\td\n');
  });
});
