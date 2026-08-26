/**
 * The bits of the file menu that are worth testing on their own: reading a permission
 * string back into the number a user would type, and judging a name before it is sent.
 *
 * Types only from `@shared`, and nothing from the renderer — so this stays a plain
 * module that a unit test can import without a DOM.
 */

/** Longest name POSIX and SMB both accept in a single path segment. */
const MAX_NAME = 255;

/**
 * `-rw-r--r--` back to `644`, which is what the permissions box starts at.
 *
 * Returns an empty string for anything that is not a POSIX permission string — SMB has
 * no mode to show and its column reads `dir` or `—`, and the box then starts blank
 * rather than at a number that was never true.
 */
export function octalFromPermissions(permissions: string): string {
  if (!/^[dl-][rwxsStT-]{9}$/.test(permissions)) return '';

  let mode = 0;
  for (let index = 0; index < 9; index += 1) {
    // Set-uid, set-gid and the sticky bit are drawn over the execute column; each of
    // them means execute is set as well, except in its capital form.
    const bit = permissions[index + 1];
    const set = bit !== '-' && bit !== 'S' && bit !== 'T';
    if (set) mode |= 1 << (8 - index);
  }
  return mode.toString(8).padStart(3, '0');
}

/**
 * Why a name cannot be used, or null when it can.
 *
 * Main checks this too — it has to, since nothing from the renderer is trusted — but
 * saying it here is what turns a round trip and an error strip into a message under the
 * box the user is still typing in.
 */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'A name is needed.';
  if (trimmed === '.' || trimmed === '..') return '`.` and `..` are the directory itself.';
  if (/[\\/]/.test(trimmed)) {
    return 'A name cannot contain a slash — this renames in place, it does not move.';
  }
  if (trimmed.length > MAX_NAME) return `A name can be at most ${MAX_NAME} characters.`;
  return null;
}

/** Why a permission string cannot be used, or null when it can. */
export function modeProblem(mode: string): string | null {
  return /^[0-7]{3,4}$/.test(mode.trim())
    ? null
    : 'Three or four octal digits, as in 644, 755 or 0640.';
}
