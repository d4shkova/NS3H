/** Log location rules (§5.1). Pure string work, kept separate so it is easy to test. */

const ILLEGAL = /[/\\:*?"<>|]/g;
const MAX_FOLDER = 120;

/** Folder for a saved host: its friendly name, made safe for every platform. */
export function sanitiseDeviceFolder(name: string): string {
  const cleaned = name
    .replace(ILLEGAL, '')
    .replace(/\s+/g, '_')
    .replace(/^\.+/, '') // a leading dot would hide the folder
    .slice(0, MAX_FOLDER)
    .replace(/[._]+$/, '');
  // Windows reserves these regardless of extension.
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
  if (!cleaned || reserved.test(cleaned)) return cleaned ? `${cleaned}_` : 'unnamed';
  return cleaned;
}

/** On collision, the short host id disambiguates without changing the readable part. */
export function disambiguate(folder: string, hostId: string): string {
  return `${folder}_${hostId.slice(-4)}`;
}

function two(value: number): string {
  return String(value).padStart(2, '0');
}

/** `2026-08-14_101500.log`, in local time — the wall clock the user was working by. */
export function sessionFileName(date: Date): string {
  const stamp =
    `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}` +
    `_${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
  return `${stamp}.log`;
}

/** Quick connections have no friendly name, so they go under `_quick/<address>/`. */
export function quickFolderSegments(address: string): [string, string] {
  return ['_quick', sanitiseDeviceFolder(address) || 'unknown'];
}

export function formatTimestamp(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offset = `${sign}${two(Math.floor(Math.abs(offsetMinutes) / 60))}${two(Math.abs(offsetMinutes) % 60)}`;
  return (
    `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ` +
    `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())} ${offset}`
  );
}

/** `32m12s`, `1h04m12s`, `47s` — as it appears in the session footer. */
export function formatDuration(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h${two(minutes)}m${two(seconds)}s`;
  if (minutes > 0) return `${minutes}m${two(seconds)}s`;
  return `${seconds}s`;
}
