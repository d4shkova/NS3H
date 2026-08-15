import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  disambiguate,
  formatDuration,
  quickFolderSegments,
  sanitiseDeviceFolder,
  sessionFileName,
} from '../src/main/logging/paths.js';
import { SessionLogWriter, formatFooter, formatHeader } from '../src/main/logging/writer.js';
import { LogService, META_FILE } from '../src/main/logging/index.js';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/config.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ns3h-logs-'));
});

const settings = (logDirectory: string | null): (() => Promise<Settings>) =>
  async () => ({ ...DEFAULT_SETTINGS, logDirectory });

describe('log paths', () => {
  it('strips the characters no filesystem accepts', () => {
    expect(sanitiseDeviceFolder('core/sw:01?*"<>|\\')).toBe('coresw01');
  });

  it('collapses whitespace to underscores', () => {
    expect(sanitiseDeviceFolder('core sw  01')).toBe('core_sw_01');
  });

  it('trims to 120 characters', () => {
    expect(sanitiseDeviceFolder('a'.repeat(300))).toHaveLength(120);
  });

  it('refuses to produce a hidden folder or a reserved Windows name', () => {
    expect(sanitiseDeviceFolder('...hidden')).toBe('hidden');
    expect(sanitiseDeviceFolder('CON')).toBe('CON_');
    expect(sanitiseDeviceFolder('///')).toBe('unnamed');
  });

  it('disambiguates a collision with the short host id', () => {
    expect(disambiguate('core-sw-01', 'hst_c3d4')).toBe('core-sw-01_c3d4');
  });

  it('names session files by local date and time', () => {
    expect(sessionFileName(new Date(2026, 7, 14, 10, 15, 0))).toBe('2026-08-14_101500.log');
  });

  it('puts quick connections under _quick/<address>', () => {
    expect(quickFolderSegments('10.1.1.99')).toEqual(['_quick', '10.1.1.99']);
  });

  it('formats durations the way the footer reads', () => {
    expect(formatDuration(47_000)).toBe('47s');
    expect(formatDuration(32 * 60_000 + 12_000)).toBe('32m12s');
    expect(formatDuration(3 * 3_600_000 + 4 * 60_000 + 5_000)).toBe('3h04m05s');
  });
});

describe('log format', () => {
  it('writes the header block from §5.2', () => {
    const header = formatHeader({
      host: 'core-sw-01 (10.1.1.5:22)',
      protocol: 'ssh',
      user: 'admin',
      started: new Date(2026, 7, 14, 10, 15, 0),
      crypto: {
        kex: 'diffie-hellman-group14-sha1',
        cipher: 'aes128-cbc',
        mac: 'hmac-sha1',
        hostKey: 'ssh-rsa SHA256:abc123',
      },
    });

    expect(header).toContain('=== NS3H session ===');
    expect(header).toMatch(/^Host: {7}core-sw-01 \(10\.1\.1\.5:22\)$/m);
    expect(header).toMatch(/^KEX: {8}diffie-hellman-group14-sha1$/m);
    expect(header).toMatch(/^Cipher: {5}aes128-cbc$/m);
    expect(header).toContain('====================');
  });

  it('omits the crypto lines for serial and records the port settings instead', () => {
    const header = formatHeader({
      host: 'console-rtr-03 (/dev/ttyUSB0:0)',
      protocol: 'serial',
      started: new Date(),
      serial: {
        path: '/dev/ttyUSB0',
        baudRate: 9600,
        dataBits: 8,
        parity: 'none',
        stopBits: 1,
        flowControl: 'none',
      },
    });

    expect(header).not.toContain('KEX:');
    expect(header).not.toContain('Cipher:');
    expect(header).toContain('/dev/ttyUSB0');
    expect(header).toMatch(/^Settings: {3}9600 8N1$/m);
  });

  it('closes with the end time and duration', () => {
    expect(formatFooter(new Date(2026, 7, 14, 10, 47, 12), 32 * 60_000 + 12_000)).toContain(
      '(duration 32m12s)',
    );
  });
});

describe('SessionLogWriter', () => {
  it('writes a header, the cleaned stream, and a footer', async () => {
    const path = join(dir, 'session.log');
    const writer = await SessionLogWriter.open(path, {
      host: 'core-sw-01 (10.1.1.5:22)',
      protocol: 'ssh',
      user: 'admin',
      started: new Date(),
    });

    writer.write(Buffer.from('\x1b[31mRouter>\x1b[0m enable\r\n'));
    writer.write(Buffer.from(`--More--${'\b'.repeat(8)}${' '.repeat(8)}${'\b'.repeat(8)}done\r\n`));
    await writer.close();

    const text = await readFile(path, 'utf8');
    expect(text).toContain('=== NS3H session ===');
    expect(text).toContain('Router> enable\ndone\n');
    expect(text).toContain('=== Session ended');
    expect(text).not.toMatch(/\x1b|\x08/);
  });

  it('creates the directory it is asked to write into', async () => {
    const path = join(dir, 'nested', 'deeper', 'session.log');
    const writer = await SessionLogWriter.open(path, {
      host: 'x',
      protocol: 'ssh',
      started: new Date(),
    });
    await writer.close();
    expect(await readFile(path, 'utf8')).toContain('NS3H session');
  });

  it('ignores writes after close rather than throwing', async () => {
    const path = join(dir, 'session.log');
    const writer = await SessionLogWriter.open(path, {
      host: 'x',
      protocol: 'ssh',
      started: new Date(),
    });
    await writer.close();
    writer.write(Buffer.from('late\r\n'));
    await writer.flush();
    expect(await readFile(path, 'utf8')).not.toContain('late');
  });
});

describe('LogService', () => {
  const request = {
    hostId: 'hst_c3d4',
    name: 'core-sw-01',
    address: '10.1.1.5',
    port: 22,
    protocol: 'ssh',
    user: 'admin',
  };

  it('does not log at all until a directory is chosen', async () => {
    const service = new LogService(settings(null));
    expect(await service.begin(request)).toBeNull();
  });

  it('logs a saved host under its friendly name', async () => {
    const service = new LogService(settings(dir));
    const writer = await service.begin(request, new Date(2026, 7, 14, 10, 15, 0));
    await writer?.close();

    expect(await readdir(join(dir, 'core-sw-01'))).toContain('2026-08-14_101500.log');
  });

  it('logs a quick connection under _quick/<address>', async () => {
    const service = new LogService(settings(dir));
    const writer = await service.begin(
      { ...request, hostId: undefined, name: '10.1.1.99', address: '10.1.1.99' },
      new Date(2026, 7, 14, 15, 2, 0),
    );
    await writer?.close();

    expect(await readdir(join(dir, '_quick', '10.1.1.99'))).toContain('2026-08-14_150200.log');
  });

  it('records the host id in .meta.json so old logs stay attributable', async () => {
    const service = new LogService(settings(dir));
    await (await service.begin(request))?.close();

    const meta = JSON.parse(await readFile(join(dir, 'core-sw-01', META_FILE), 'utf8'));
    expect(meta.hostId).toBe('hst_c3d4');
    expect(meta.names).toHaveLength(1);
    expect(meta.names[0].name).toBe('core-sw-01');
  });

  it('keeps a rename history and leaves the old logs where they are', async () => {
    const service = new LogService(settings(dir));
    await (await service.begin(request))?.close();
    // Same host, renamed: new sessions log under the new name.
    await (await service.begin({ ...request, name: 'dist-sw-01' }))?.close();

    expect(await readdir(join(dir, 'core-sw-01'))).toHaveLength(2); // log + meta
    const oldMeta = JSON.parse(await readFile(join(dir, 'core-sw-01', META_FILE), 'utf8'));
    const newMeta = JSON.parse(await readFile(join(dir, 'dist-sw-01', META_FILE), 'utf8'));
    expect(oldMeta.hostId).toBe('hst_c3d4');
    expect(newMeta.hostId).toBe('hst_c3d4');
  });

  it('separates two different hosts that sanitise to the same folder name', async () => {
    const service = new LogService(settings(dir));
    await (await service.begin(request))?.close();
    await (await service.begin({ ...request, hostId: 'hst_9999' }))?.close();

    expect(await readdir(dir)).toEqual(
      expect.arrayContaining(['core-sw-01', 'core-sw-01_9999']),
    );
  });

  it('records the negotiated crypto in the header so failures stay diagnosable', async () => {
    const service = new LogService(settings(dir));
    const writer = await service.begin({
      ...request,
      crypto: {
        kex: 'diffie-hellman-group1-sha1',
        cipher: '3des-cbc',
        mac: 'hmac-sha1',
        hostKey: 'ssh-rsa SHA256:abc',
      },
    });
    await writer?.close();

    const text = await readFile(writer!.path, 'utf8');
    expect(text).toContain('diffie-hellman-group1-sha1');
    expect(text).toContain('3des-cbc');
  });
});
