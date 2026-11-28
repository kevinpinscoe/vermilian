import { beforeEach, describe, expect, it } from 'vitest';
import { useUnsavedStore } from './unsaved';

describe('unsaved-draft store (VERM-123)', () => {
  beforeEach(() => useUnsavedStore.setState({ drafts: {} }));

  it('registers and unregisters drafts by id', () => {
    const { register, unregister } = useUnsavedStore.getState();
    register('settings', { label: 'Settings', save: () => true });
    register('add-projects-ws-a', { label: 'Add projects to “A”', save: () => true });
    expect(Object.keys(useUnsavedStore.getState().drafts)).toEqual(['settings', 'add-projects-ws-a']);
    unregister('settings');
    expect(Object.keys(useUnsavedStore.getState().drafts)).toEqual(['add-projects-ws-a']);
  });

  it('replaces a draft registered again under the same id', () => {
    const { register } = useUnsavedStore.getState();
    register('settings', { label: 'Settings', save: () => true });
    register('settings', { label: 'Settings (2)', save: () => false });
    expect(useUnsavedStore.getState().drafts.settings.label).toBe('Settings (2)');
  });

  it('leaves the state untouched when unregistering an unknown id', () => {
    const before = useUnsavedStore.getState();
    before.unregister('nothing');
    expect(useUnsavedStore.getState()).toBe(before);
  });
});
