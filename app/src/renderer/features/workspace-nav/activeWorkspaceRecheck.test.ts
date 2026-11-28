import { describe, expect, it } from 'vitest';
import {
  ACTIVE_WORKSPACE_RECHECK_LIMIT,
  ACTIVE_WORKSPACE_RECHECK_MS,
  activeWorkspaceRecheckInterval,
} from './api';

// VERM-123: a tentative active-workspace answer is re-checked, a bounded
// number of times, instead of being cached as the answer.
describe('activeWorkspaceRecheckInterval', () => {
  it('re-checks a tentative answer', () => {
    expect(activeWorkspaceRecheckInterval({ tentative: true }, 1)).toBe(ACTIVE_WORKSPACE_RECHECK_MS);
  });

  it('does not poll a settled answer, or before there is one', () => {
    expect(activeWorkspaceRecheckInterval({ tentative: false }, 1)).toBe(false);
    expect(activeWorkspaceRecheckInterval(undefined, 0)).toBe(false);
  });

  it('stops after the limit, leaving only refocus to re-check', () => {
    expect(activeWorkspaceRecheckInterval({ tentative: true }, ACTIVE_WORKSPACE_RECHECK_LIMIT)).toBe(ACTIVE_WORKSPACE_RECHECK_MS);
    expect(activeWorkspaceRecheckInterval({ tentative: true }, ACTIVE_WORKSPACE_RECHECK_LIMIT + 1)).toBe(false);
  });
});
