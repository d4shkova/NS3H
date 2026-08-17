import { describe, expect, it, vi } from 'vitest';
import { flushWithDeadline } from '../src/main/lifecycle.js';

describe('the last flush before quitting', () => {
  it('waits for the flush and then lets the quit proceed', async () => {
    let flushed = false;
    await flushWithDeadline(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      flushed = true;
    }, 1000);
    expect(flushed).toBe(true);
  });

  it('gives up on a flush that hangs, rather than holding the app open', async () => {
    const report = vi.fn();
    // A log on a share that has gone away never settles. The app still has to quit.
    await flushWithDeadline(() => new Promise<void>(() => {}), 20, report);
    expect(report).toHaveBeenCalledWith(expect.stringMatching(/did not finish flushing/));
  });

  it('quits on a failed flush too, and says what went wrong', async () => {
    const report = vi.fn();
    await flushWithDeadline(() => Promise.reject(new Error('disk full')), 1000, report);
    expect(report).toHaveBeenCalledWith(
      expect.stringMatching(/failed to flush/),
      expect.any(Error),
    );
  });

  it('does not leave the deadline timer behind when the flush wins', async () => {
    // A stray timer would keep the loop alive after the quit was requested.
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    await flushWithDeadline(() => Promise.resolve(), 1000);
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });
});
