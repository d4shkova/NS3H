import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { LogReader } from '../src/main/logging/reader.js';

let dir: string;
let reader: LogReader;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ns3h-reader-'));
  reader = new LogReader(async () => dir);
});

async function write(name: string, body: string): Promise<string> {
  const path = join(dir, name);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, body, 'utf8');
  return path;
}

describe('opening', () => {
  it('reports line count and size', async () => {
    const path = await write('a.log', 'one\ntwo\nthree\n');
    const doc = await reader.open(path);
    expect(doc.lineCount).toBe(3);
    expect(doc.bytes).toBeGreaterThan(0);
  });

  it('does not invent a trailing blank line', async () => {
    expect((await reader.open(await write('b.log', 'only\n'))).lineCount).toBe(1);
    expect((await reader.open(await write('c.log', 'no newline'))).lineCount).toBe(1);
    expect((await reader.open(await write('d.log', ''))).lineCount).toBe(0);
  });

  it('refuses a file outside the log directory', async () => {
    await expect(reader.open('/etc/passwd')).rejects.toThrow(/outside the log directory/i);
    await expect(reader.open(join(dir, '..', 'escape.log'))).rejects.toThrow(
      /outside the log directory/i,
    );
  });

  it('refuses anything that is not a .log', async () => {
    await write('notes.txt', 'x');
    await expect(reader.open(join(dir, 'notes.txt'))).rejects.toThrow(/only \.log/i);
  });

  it('refuses to read at all when no log directory is set', async () => {
    const orphan = new LogReader(async () => null);
    await expect(orphan.open(join(dir, 'a.log'))).rejects.toThrow(/no log directory/i);
  });
});

describe('windowed reads', () => {
  it('returns only the requested slice', async () => {
    const path = await write('w.log', Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n'));
    await reader.open(path);

    const window = await reader.lines(path, 100, 5);
    expect(window).toEqual(['line 100', 'line 101', 'line 102', 'line 103', 'line 104']);
  });

  it('clamps a window that runs past the end', async () => {
    const path = await write('short.log', 'a\nb\nc\n');
    await reader.open(path);
    expect(await reader.lines(path, 2, 50)).toEqual(['c']);
    expect(await reader.lines(path, 99, 10)).toEqual([]);
  });

  it('reads a file it was not explicitly told to open', async () => {
    const path = await write('lazy.log', 'x\ny\n');
    expect(await reader.lines(path, 0, 2)).toEqual(['x', 'y']);
  });
});

describe('search', () => {
  it('finds every matching line, case-insensitively', async () => {
    const path = await write(
      's.log',
      ['interface Vlan1', ' ip address 10.1.1.5', 'INTERFACE Vlan2', 'end'].join('\n'),
    );
    await reader.open(path);

    const matches = await reader.search(path, 'interface');
    expect(matches.map((m) => m.line)).toEqual([0, 2]);
    expect(matches[0].column).toBe(0);
  });

  it('reports the column of the first hit on a line', async () => {
    const path = await write('col.log', 'aaa needle bbb\n');
    await reader.open(path);
    expect((await reader.search(path, 'needle'))[0].column).toBe(4);
  });

  it('returns nothing for an empty query', async () => {
    const path = await write('e.log', 'anything\n');
    expect(await reader.search(path, '')).toEqual([]);
  });
});

describe('a very large log', () => {
  it('opens and reads a 50 MB file without loading it into the renderer', async () => {
    // §11 — "a 50 MB log opens in the viewer without freezing the UI". The viewer only
    // ever asks for a window; this asserts the cost of that window is independent of
    // the file's size.
    const line = 'x'.repeat(99);
    const path = await write('big.log', `${Array.from({ length: 500_000 }, () => line).join('\n')}\n`);

    const started = Date.now();
    const doc = await reader.open(path);
    const openMs = Date.now() - started;

    expect(doc.lineCount).toBe(500_000);
    expect(doc.bytes).toBeGreaterThan(47 * 1024 * 1024); // 50 MB decimal

    const windowStarted = Date.now();
    const window = await reader.lines(path, 400_000, 100);
    expect(window).toHaveLength(100);
    expect(Date.now() - windowStarted).toBeLessThan(50);
    expect(openMs).toBeLessThan(10_000);
  }, 60_000);
});
