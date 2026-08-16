import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClientChannel } from 'ssh2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ScpTransport } from '../src/main/files/scp.js';

const SCP = '/usr/bin/scp';

/**
 * The SCP protocol is undocumented by design, and the only authority on it is the
 * implementation everything else talks to. So this drives OpenSSH's own `scp -f` and
 * `scp -t` as the far end, with the child process's stdio standing in for the exec
 * channel: if NS3H and OpenSSH disagree about a byte, this is where it shows up rather
 * than half way through a firmware push.
 *
 * Skipped where OpenSSH is not installed — the unit tests in `scp.test.ts` cover the
 * exchange against a scripted device, and they run everywhere.
 */
describe.skipIf(!existsSync(SCP))('interoperating with OpenSSH scp', () => {
  let root = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'ns3h-interop-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Runs the real scp locally, wired up the way an ssh2 exec channel would be. */
  function localScp(mode: '-f' | '-t') {
    return (command: string): Promise<ClientChannel> => {
      // The transport builds `scp -f <path>`; the path is what the child needs.
      const path = command.split(' ').slice(2).join(' ');
      const child = spawn(SCP, [mode, path], { stdio: ['pipe', 'pipe', 'pipe'] });

      // The transport reads from the same object it writes to, which is what a duplex
      // channel is; stdin is that object here, with stdout's data spliced onto it.
      const channel = child.stdin as unknown as ClientChannel;
      child.stdout.on('data', (chunk) => channel.emit('data', chunk));
      child.on('close', () => channel.emit('close'));
      return Promise.resolve(channel);
    };
  }

  it('downloads what OpenSSH serves in source mode, byte for byte', async () => {
    const body = randomBytes(300_000);
    const source = join(root, 'firmware.bin');
    const into = join(root, 'downloaded');
    await writeFile(source, body);
    await mkdir(into, { recursive: true });

    const transport = new ScpTransport(localScp('-f'));
    let reported = 0;
    const target = await transport.download(
      source,
      into,
      ({ transferred }) => (reported = transferred),
    );

    expect(await readFile(target)).toEqual(body);
    expect(reported).toBe(body.length);
  }, 30_000);

  it('uploads what OpenSSH receives in sink mode, byte for byte', async () => {
    const body = randomBytes(300_000);
    const source = join(root, 'upload.bin');
    const into = join(root, 'received');
    await writeFile(source, body);
    await mkdir(into, { recursive: true });

    const transport = new ScpTransport(localScp('-t'));
    await transport.upload(source, into, () => {});

    expect(await readFile(join(into, 'upload.bin'))).toEqual(body);
  }, 30_000);
});
