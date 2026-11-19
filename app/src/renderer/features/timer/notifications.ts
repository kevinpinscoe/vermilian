// `enabled` is the OS notifications setting from Settings → Timer.
export function fireNotification(enabled: boolean, title: string, body: string) {
  if (!enabled) return;
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}
