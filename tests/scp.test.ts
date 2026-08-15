import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import type { ClientChannel } from 'ssh2';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScpTransport, parseLsOutput } from '../src/main/files/scp.js';
import {
  formatControlLine,
  parseControlLine,
  quoteRemotePath,
} from '../src/main/files/scpProtocol.js';

/**
 * Stands in for the exec channel an SCP server is on the other end of. Whatever NS3H
 * writes arrives at `onWrite`, which is where a test plays the device's part.
 */
class FakeDevice extends Duplex {
  readonly written: Buffer[] = [];
  onWrite: ((chunk: Buffer, device: FakeDevice) => void) | null = null;

  _read(): void {}

  _write(chunk: Buffer, _encoding: string, done: () => void): void {
    const copy = Buffer.from(chunk);
    this.written.push(copy);
    this.onWrite?.(copy, this);
    done();
  }

  /** Bytes from the device to NS3H. */
  send(data: Buffer | string): void {
    this.push(typeof data === 'string' ? Buffer.from(data) : data);
  }

  finish(): void {
    this.push(null);
  }

  get sent(): Buffer {
    return Buffer.concat(this.written);
  }
}

const ACK = Buffer.from([0]);

function transportFor(device: FakeDevice): { transport: ScpTransport; commands: string[] } {
  const commands: string[] = [];
  const transport = new ScpTransport((command) => {
    commands.push(command);
    return Promise.resolve(device as unknown as ClientChannel);
  });
  return { transport, commands };
}

describe('remote path quoting', () => {
  it('leaves a device path exactly as typed', () => {
    // IOS hands the path to something that is not a shell; quotes would be taken
    // literally and the transfer would fail on a perfectly ordinary filename.
    expect(quoteRemotePath('flash:c2960-lanbasek9-mz.150-2.SE11.bin')).toBe(
      'flash:c2960-lanbasek9-mz.150-2.SE11.bin',
    );
    expect(quoteRemotePath('/var/tmp/config.txt')).toBe('/var/tmp/config.txt');
    expect(quoteRemotePath('bootflash:')).toBe('bootflash:');
  });

  it('quotes anything a shell would take apart', () => {
    expect(quoteRemotePath('/tmp/two words')).toBe("'/tmp/two words'");
    expect(quoteRemotePath('/tmp/$(reboot)')).toBe("'/tmp/$(reboot)'");
    expect(quoteRemotePath("/tmp/it's")).toBe("'/tmp/it'\\''s'");
  });
});

describe('control lines', () => {
  it('round-trips', () => {
    const line = formatControlLine({ mode: 0o644, size: 4096, name: 'image.bin' });
    expect(line).toBe('C0644 4096 image.bin\n');
    expect(parseControlLine(line.trim())).toEqual({ mode: 0o644, size: 4096, name: 'image.bin' });
  });

  it('keeps a name with spaces in it whole', () => {
    expect(parseControlLine('C0755 12 two words.txt').name).toBe('two words.txt');
  });

  it('refuses a line it cannot read rather than guessing', () => {
    expect(() => parseControlLine('not a control line')).toThrow('could not read');
  });
});

describe('downloading over SCP', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ns3h-scp-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('runs the source-mode exchange and writes the file', async () => {
    const body = Buffer.from('hostname sw1\n!\nend\n');
    const device = new FakeDevice();
    let acks = 0;

    device.onWrite = (chunk, self) => {
      if (chunk.length === 1 && chunk[0] === 0) {
        acks += 1;
        // First ack opens the exchange; the second says "send the bytes".
        if (acks === 1) self.send(`C0644 ${body.length} running.cfg\n`);
        else if (acks === 2) self.send(Buffer.concat([body, ACK]));
      }
    };

    const { transport, commands } = transportFor(device);
    const seen: number[] = [];
    const target = await transport.download('flash:running.cfg', root, ({ transferred }) =>
      seen.push(transferred),
    );

    expect(commands).toEqual(['scp -f flash:running.cfg']);
    expect(target).toBe(join(root, 'running.cfg'));
    expect(await readFile(target)).toEqual(body);
    // Progress is reported against the size the device declared, not a guess.
    expect(seen.at(-1)).toBe(body.length);
    // Ack, ack, and the closing ack: three single zero bytes and nothing else.
    expect(device.sent).toEqual(Buffer.from([0, 0, 0]));
  });

  it('reports the device’s own complaint, and leaves no partial file', async () => {
    const device = new FakeDevice();
    device.onWrite = (chunk, self) => {
      if (chunk.length === 1 && chunk[0] === 0) {
        // \x02 is a fatal error, and the text after it is the useful part.
        self.send(Buffer.concat([Buffer.from([2]), Buffer.from('flash:nope: No such file\n')]));
      }
    };

    const { transport } = transportFor(device);
    await expect(transport.download('flash:nope', root, () => {})).rejects.toThrow(
      'flash:nope: No such file',
    );
    expect(existsSync(join(root, 'nope'))).toBe(false);
  });

  it('does not leave a truncated file when the device cuts the transfer short', async () => {
    const device = new FakeDevice();
    let acks = 0;
    device.onWrite = (chunk, self) => {
      if (chunk.length === 1 && chunk[0] === 0) {
        acks += 1;
        if (acks === 1) self.send('C0644 4096 image.bin\n');
        else if (acks === 2) {
          self.send(Buffer.alloc(16, 0x41));
          self.finish(); // the connection drops mid-file
        }
      }
    };

    const { transport } = transportFor(device);
    await expect(transport.download('flash:image.bin', root, () => {})).rejects.toThrow(
      'still to send',
    );
    expect(existsSync(join(root, 'image.bin'))).toBe(false);
  });
});

describe('uploading over SCP', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ns3h-scp-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('announces the file, sends it, and waits for the verdict', async () => {
    const source = join(root, 'image.bin');
    const body = Buffer.alloc(2048, 0x42);
    await writeFile(source, body);

    const device = new FakeDevice();
    // The device speaks first, then acknowledges the control line and the body.
    device.onWrite = (_chunk, self) => self.send(ACK);
    setImmediate(() => device.send(ACK));

    const { transport, commands } = transportFor(device);
    const seen: number[] = [];
    const target = await transport.upload(source, 'flash:', ({ transferred }) =>
      seen.push(transferred),
    );

    expect(commands).toEqual(['scp -t flash:']);
    expect(target).toBe('flash:/image.bin');
    expect(seen.at(-1)).toBe(body.length);

    const sent = device.sent;
    expect(sent.subarray(0, 21).toString()).toBe(`C0644 ${body.length} image.bin\n`);
    expect(sent.subarray(21, 21 + body.length)).toEqual(body);
    // The end-of-file marker the protocol requires after the body.
    expect(sent.subarray(21 + body.length)).toEqual(ACK);
  });

  it('surfaces a refusal at the end, when the device has seen the whole file', async () => {
    const source = join(root, 'big.bin');
    await writeFile(source, Buffer.alloc(64, 0x43));

    const device = new FakeDevice();
    // A device acknowledges the control line, says nothing during the body, and gives its
    // verdict only after the end-of-file marker — which is where "no space" lands, once
    // the whole image has already crossed the wire. Counted rather than sniffed: file
    // content can look like anything, including a control line.
    let writes = 0;
    device.onWrite = (_chunk, self) => {
      writes += 1;
      if (writes === 1) self.send(ACK); // the control line
      else if (writes === 3) {
        self.send(Buffer.concat([Buffer.from([2]), Buffer.from('flash: No space left\n')]));
      }
    };
    setImmediate(() => device.send(ACK));

    const { transport } = transportFor(device);
    await expect(transport.upload(source, 'flash:', () => {})).rejects.toThrow('No space left');
  });
});

describe('listing over SCP', () => {
  it('parses a coreutils listing', () => {
    const output = [
      'total 16',
      'drwxr-xr-x 2 will will 4096 Aug 15 09:12 .',
      'drwxr-xr-x 8 will will 4096 Aug 14 21:03 ..',
      '-rw-r--r-- 1 will will  842 Aug 15 09:12 running.cfg',
      'drwxr-xr-x 2 will will 4096 Aug  2 11:44 archive',
      'lrwxrwxrwx 1 will will   11 Aug 15 09:10 latest -> running.cfg',
    ].join('\n');

    const entries = parseLsOutput(output, '/var/tmp');

    // Directories first, then files, each by name — and `.`/`..` are not entries.
    expect(entries.map((entry) => entry.name)).toEqual([
      'archive',
      'latest',
      'running.cfg',
    ]);

    const config = entries.find((entry) => entry.name === 'running.cfg')!;
    expect(config).toMatchObject({ path: '/var/tmp/running.cfg', directory: false, size: 842 });

    // A symlink is one entry named for the link, not the link plus its target.
    expect(entries.find((entry) => entry.name === 'latest')?.symlink).toBe(true);
  });

  it('skips lines that are not entries instead of failing the listing', () => {
    const output = ['ls: cannot access nope', '-rw-r--r-- 1 a b 5 Aug 15 09:12 real'].join('\n');
    expect(parseLsOutput(output, '/tmp').map((entry) => entry.name)).toEqual(['real']);
  });

  it('handles a listing with a year instead of a time', () => {
    const output = '-rw-r--r-- 1 will will 12 Jan  3  2024 old.cfg';
    expect(parseLsOutput(output, '/tmp')[0]?.name).toBe('old.cfg');
  });
});
