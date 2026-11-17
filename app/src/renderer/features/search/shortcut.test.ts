import { describe, it, expect } from 'vitest';
import { isSearchShortcut, type ShortcutEvent } from './shortcut';

const ev = (over: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
  key: '/', ctrlKey: false, metaKey: false, altKey: false, target: { tagName: 'DIV' }, ...over,
});

describe('isSearchShortcut (VERM-61)', () => {
  it('fires on a bare "/" outside a text field', () => {
    expect(isSearchShortcut(ev())).toBe(true);
    expect(isSearchShortcut(ev({ target: null }))).toBe(true);
  });

  it('ignores other keys and modified "/"', () => {
    expect(isSearchShortcut(ev({ key: '?' }))).toBe(false);
    expect(isSearchShortcut(ev({ ctrlKey: true }))).toBe(false);
    expect(isSearchShortcut(ev({ metaKey: true }))).toBe(false);
    expect(isSearchShortcut(ev({ altKey: true }))).toBe(false);
  });

  it('never steals "/" from something the user is typing in', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'input']) {
      expect(isSearchShortcut(ev({ target: { tagName } }))).toBe(false);
    }
    expect(isSearchShortcut(ev({ target: { tagName: 'DIV', isContentEditable: true } }))).toBe(false);
  });
});
