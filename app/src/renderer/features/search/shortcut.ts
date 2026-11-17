// The board search's keyboard shortcut (VERM-61): "/" focuses the search box,
// unless the user is already typing somewhere or holding a modifier.
// Pure: unit-tested without a DOM.

export interface ShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: { tagName?: string; isContentEditable?: boolean } | null;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function isSearchShortcut(e: ShortcutEvent): boolean {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return false;
  const t = e.target;
  if (t && (TYPING_TAGS.has((t.tagName ?? '').toUpperCase()) || t.isContentEditable)) return false;
  return true;
}
