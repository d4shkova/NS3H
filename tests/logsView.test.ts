import { describe, expect, it } from 'vitest';
import { keepsLogFolderOpen, useConfig } from '../src/renderer/stores/config.js';

describe('the folder open on the Logs screen', () => {
  it('counts reading a log as still being on Logs', () => {
    expect(keepsLogFolderOpen({ kind: 'logs' })).toBe(true);
    expect(keepsLogFolderOpen({ kind: 'log-viewer', path: '/logs/a.log', title: 'a' })).toBe(true);
  });

  it('counts anywhere else as leaving', () => {
    expect(keepsLogFolderOpen({ kind: 'hosts' })).toBe(false);
    expect(keepsLogFolderOpen({ kind: 'transfer' })).toBe(false);
    expect(keepsLogFolderOpen({ kind: 'quick' })).toBe(false);
    expect(keepsLogFolderOpen({ kind: 'settings' })).toBe(false);
  });

  it('survives opening a log and coming back, so the file can be deleted where it was', () => {
    const store = useConfig.getState();
    store.setExpandedLogFolder('core-sw-01');
    store.setView({ kind: 'log-viewer', path: '/logs/core-sw-01/a.log', title: 'a' });
    expect(useConfig.getState().expandedLogFolder).toBe('core-sw-01');

    useConfig.getState().setView({ kind: 'logs' });
    expect(useConfig.getState().expandedLogFolder).toBe('core-sw-01');
  });

  it('is dropped on the way to another section', () => {
    const store = useConfig.getState();
    store.setExpandedLogFolder('core-sw-01');
    store.setView({ kind: 'hosts' });
    expect(useConfig.getState().expandedLogFolder).toBeNull();
  });
});
