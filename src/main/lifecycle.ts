/** Shutdown sequencing (§5.3). Kept out of `index.ts` so it can be tested. */

/** How long the last log flush may hold the app open before it is abandoned. */
export const FLUSH_DEADLINE_MS = 3000;

/**
 * Waits for the final flush, but never for longer than the deadline.
 *
 * Quitting is deferred until the buffers are on disk, so the last couple of seconds of
 * a session are not lost. A log on a network share that has gone away can take that
 * from "a moment" to "forever", though, and an app that will not quit is worse than a
 * log missing its last few lines — so the wait is bounded, and a failure is reported
 * rather than swallowed.
 *
 * Resolves either way: the caller's job is to quit, not to decide whether it may.
 */
export function flushWithDeadline(
  flush: () => Promise<void>,
  deadlineMs = FLUSH_DEADLINE_MS,
  report: (message: string, error?: unknown) => void = console.error,
): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      report(`NS3H: logs did not finish flushing within ${deadlineMs} ms; quitting anyway.`);
      resolve();
    }, deadlineMs);

    void flush()
      .catch((error) => report('NS3H: failed to flush logs on quit:', error))
      .finally(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}
