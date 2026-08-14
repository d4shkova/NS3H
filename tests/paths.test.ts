import { describe, expect, it } from 'vitest';
import { configDirectory, configPath } from '../src/main/store/paths.js';

describe('config directory', () => {
  it('follows the XDG location on Linux', () => {
    expect(configDirectory({}, 'linux', '/home/will')).toBe('/home/will/.config/ns3h');
    expect(configDirectory({ XDG_CONFIG_HOME: '/cfg' }, 'linux', '/home/will')).toBe('/cfg/ns3h');
  });

  it('uses Application Support on macOS', () => {
    expect(configDirectory({}, 'darwin', '/Users/will')).toBe(
      '/Users/will/Library/Application Support/ns3h',
    );
  });

  it('uses APPDATA on Windows', () => {
    expect(configDirectory({ APPDATA: 'C:\\Users\\will\\AppData\\Roaming' }, 'win32', 'C:\\Users\\will')).toContain(
      'ns3h',
    );
  });

  it('joins file names onto the directory', () => {
    expect(configPath('known-hosts.json', '/cfg/ns3h')).toBe('/cfg/ns3h/known-hosts.json');
  });
});
