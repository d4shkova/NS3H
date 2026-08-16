import { homedir, platform } from 'node:os';
import { posix, win32 } from 'node:path';

/**
 * Node's own `join` uses the separator of the machine it runs on, not of the
 * platform being described. Everything here takes the target platform as an
 * argument, so pick the separator from that instead — otherwise a Linux path
 * resolved on a Windows machine comes back with backslashes.
 */
function pathFor(os: string) {
  return os === 'win32' ? win32 : posix;
}

/**
 * All config lives in one directory:
 *   Linux   ~/.config/ns3h/
 *   macOS   ~/Library/Application Support/ns3h/
 *   Windows %APPDATA%\ns3h\
 *
 * Resolved without Electron's `app` so it stays unit-testable and usable before
 * the app is ready.
 */
export function configDirectory(
  env: NodeJS.ProcessEnv = process.env,
  os: string = platform(),
  home: string = homedir(),
): string {
  const { join } = pathFor(os);
  if (os === 'win32') {
    return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'ns3h');
  }
  if (os === 'darwin') {
    return join(home, 'Library', 'Application Support', 'ns3h');
  }
  return join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'ns3h');
}

export const ConfigFile = {
  hosts: 'hosts.json',
  credentials: 'credentials.json',
  settings: 'settings.json',
  knownHosts: 'known-hosts.json',
} as const;

export function configPath(
  file: string,
  dir: string = configDirectory(),
  os: string = platform(),
): string {
  return pathFor(os).join(dir, file);
}
