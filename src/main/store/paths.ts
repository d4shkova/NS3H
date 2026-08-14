import { homedir, platform } from 'node:os';
import { join } from 'node:path';

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

export function configPath(file: string, dir: string = configDirectory()): string {
  return join(dir, file);
}
