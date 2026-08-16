import { describe, expect, it } from 'vitest';
import type { FileConnection } from '../src/shared/transfer.js';
import {
  reconcileTabs,
  sessionTab,
  sourceIdFor,
  standaloneTab,
} from '../src/renderer/stores/transfers.js';

const connection = (id: string, label = id): FileConnection => ({
  id,
  label,
  protocol: 'sftp',
  home: '/home/admin',
});

describe('addressing a transfer', () => {
  it('sends a session over SFTP by default and SCP when asked', () => {
    const tab = sessionTab('ses_ab12', 'sw1 (10.1.1.5)');
    expect(sourceIdFor(tab)).toBe('ses_ab12');
    expect(sourceIdFor({ ...tab, mode: 'scp' })).toBe('ses_ab12:scp');
  });

  it('addresses a standalone connection by its id alone', () => {
    const tab = standaloneTab(connection('trc_1'));
    expect(sourceIdFor(tab)).toBe('trc_1');
    // Its protocol is fixed at connect time, so the mode never rewrites the id.
    expect(sourceIdFor({ ...tab, mode: 'scp' })).toBe('trc_1');
  });

  it('opens a standalone tab where the connection said its home was', () => {
    expect(standaloneTab({ ...connection('trc_1'), home: '/var/tmp' }).path).toBe('/var/tmp');
  });
});

describe('squaring tabs against what is open', () => {
  it('adopts a connection that is live in main but has no tab', () => {
    // The bug this exists for: a second connection, open and paid for in the main
    // process, with nothing on screen to reach it by.
    const result = reconcileTabs([], [connection('trc_1'), connection('trc_2')], [], null);

    expect(result.tabs.map((tab) => tab.key)).toEqual(['trc_1', 'trc_2']);
    expect(result.adopted).toEqual(['trc_1', 'trc_2']);
  });

  it('keeps the tabs it already has, and does not duplicate them', () => {
    const existing = [standaloneTab(connection('trc_1'))];
    const result = reconcileTabs(existing, [connection('trc_1')], [], 'trc_1');

    expect(result.tabs).toHaveLength(1);
    expect(result.adopted).toEqual([]);
    expect(result.activeKey).toBe('trc_1');
  });

  it('drops a tab whose connection is gone', () => {
    const existing = [standaloneTab(connection('trc_1')), standaloneTab(connection('trc_2'))];
    const result = reconcileTabs(existing, [connection('trc_2')], [], 'trc_1');

    expect(result.tabs.map((tab) => tab.key)).toEqual(['trc_2']);
    // The focus was on the tab that went; it moves rather than pointing at nothing.
    expect(result.activeKey).toBe('trc_2');
  });

  it('drops a session tab when its session closes, and keeps the standalone ones', () => {
    const existing = [
      sessionTab('ses_aa', 'sw1'),
      standaloneTab(connection('trc_1')),
      sessionTab('ses_bb', 'sw2'),
    ];
    const result = reconcileTabs(existing, [connection('trc_1')], ['ses_bb'], 'ses_aa');

    expect(result.tabs.map((tab) => tab.key)).toEqual(['trc_1', 'ses_bb']);
    expect(result.activeKey).toBe('ses_bb');
  });

  it('reports nothing open as nothing open', () => {
    const result = reconcileTabs([sessionTab('ses_aa', 'sw1')], [], [], 'ses_aa');
    expect(result).toEqual({ tabs: [], activeKey: null, adopted: [] });
  });

  it('preserves where each tab was left', () => {
    const existing = [{ ...standaloneTab(connection('trc_1')), path: '/var/log', browsable: false }];
    const [tab] = reconcileTabs(existing, [connection('trc_1')], [], 'trc_1').tabs;

    expect(tab.path).toBe('/var/log');
    expect(tab.browsable).toBe(false);
  });
});
