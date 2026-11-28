import { useEffect, useRef } from 'react';
import { useUnsavedStore } from '../../stores/unsaved';

/**
 * Registers an editor's unsubmitted changes while `dirty`, so quitting asks
 * about them (VERM-123). `save` submits them the way the editor's own Save
 * button does and resolves whether that worked. The latest `save` is always
 * the one called, so it may close over current state.
 */
export function useUnsavedDraft(id: string, label: string, dirty: boolean, save: () => Promise<boolean> | boolean): void {
  const register = useUnsavedStore((s) => s.register);
  const unregister = useUnsavedStore((s) => s.unregister);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!dirty) return;
    register(id, { label, save: () => saveRef.current() });
    return () => unregister(id);
  }, [id, label, dirty, register, unregister]);
}
