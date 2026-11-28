import { IS_E2E } from './e2e';

/**
 * Whether closing the last window quits the app (Windows, Linux) or leaves it
 * running without one (macOS). The e2e suite runs on Linux, so
 * VERMILIAN_E2E_WINDOW_CLOSE=keep-running gives it the macOS behaviour to test
 * (VERM-123 review).
 */
export function windowCloseQuits(): boolean {
  if (IS_E2E && process.env.VERMILIAN_E2E_WINDOW_CLOSE === 'keep-running') return false;
  return process.platform !== 'darwin';
}
