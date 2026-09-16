import { describe, it, expect } from 'vitest';
import { currentWeekMonday, isDismissedThisWeek } from './dismissals';
import type { Dismissals } from '../../../shared/boardConfig';

describe('currentWeekMonday', () => {
  it('returns the same date for a Monday', () => {
    // 2026-09-14 is a Monday.
    expect(currentWeekMonday(new Date(2026, 8, 14))).toBe('2026-09-14');
  });

  it('returns the preceding Monday for a mid-week date', () => {
    // 2026-09-16 is a Wednesday in the week starting 2026-09-14.
    expect(currentWeekMonday(new Date(2026, 8, 16))).toBe('2026-09-14');
  });

  it('returns the preceding Monday for a Sunday (end of the local week)', () => {
    // 2026-09-20 is a Sunday, still in the week starting 2026-09-14.
    expect(currentWeekMonday(new Date(2026, 8, 20))).toBe('2026-09-14');
  });

  it('rolls into the next week on the following Monday', () => {
    expect(currentWeekMonday(new Date(2026, 8, 21))).toBe('2026-09-21');
  });

  it('handles a month boundary', () => {
    // 2026-09-30 is a Wednesday; that week starts Monday 2026-09-28.
    expect(currentWeekMonday(new Date(2026, 8, 30))).toBe('2026-09-28');
  });
});

describe('isDismissedThisWeek', () => {
  const dismissals: Dismissals = {
    'ws-1:ISS-1': { workspace: 'ws-1', issueId: 'ISS-1', dismissedWeekOf: '2026-09-14' },
  };

  it('is true when the dismissal matches the given week', () => {
    expect(isDismissedThisWeek(dismissals, 'ws-1', 'ISS-1', '2026-09-14')).toBe(true);
  });

  it('is false once the given week has moved past the dismissal — expiration needs no cleanup', () => {
    expect(isDismissedThisWeek(dismissals, 'ws-1', 'ISS-1', '2026-09-21')).toBe(false);
  });

  it('is false for an issue with no dismissal at all', () => {
    expect(isDismissedThisWeek(dismissals, 'ws-1', 'ISS-2', '2026-09-14')).toBe(false);
  });

  it('is false for the same issue in a different workspace', () => {
    expect(isDismissedThisWeek(dismissals, 'ws-2', 'ISS-1', '2026-09-14')).toBe(false);
  });
});
