import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireNotification } from './notifications';

// Stands in for the browser's Notification and records what was sent.
function stubNotification(permission: NotificationPermission) {
  const sent: Array<{ title: string; body?: string }> = [];
  class FakeNotification {
    static permission = permission;
    constructor(title: string, options?: { body?: string }) {
      sent.push({ title, body: options?.body });
    }
  }
  vi.stubGlobal('Notification', FakeNotification);
  vi.stubGlobal('window', { Notification: FakeNotification });
  return sent;
}

describe('fireNotification', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the notification when the setting is on', () => {
    const sent = stubNotification('granted');
    fireNotification(true, 'Pomodoro complete', 'Time for a 5-minute break.');
    expect(sent).toEqual([{ title: 'Pomodoro complete', body: 'Time for a 5-minute break.' }]);
  });

  it('sends nothing when the setting is off', () => {
    const sent = stubNotification('granted');
    fireNotification(false, 'Pomodoro complete', 'Time for a 5-minute break.');
    expect(sent).toEqual([]);
  });

  it('sends nothing without OS permission, even when the setting is on', () => {
    const sent = stubNotification('denied');
    fireNotification(true, 'Pomodoro complete', 'Time for a 5-minute break.');
    expect(sent).toEqual([]);
  });

  it('does nothing where notifications are unavailable', () => {
    vi.stubGlobal('window', {});
    expect(() => fireNotification(true, 'Pomodoro complete', 'Time for a 5-minute break.')).not.toThrow();
  });
});
