// Priority Desk Choose-next — "Not this week" dismissals (VERM-6). Persisted to
// the _vermilian-config Article's `dismissals` map (shared/boardConfig.ts),
// keyed by workspace + issue. A dismissal excludes an issue from the
// Choose-next candidate set only through the end of the local calendar week it
// was made in — no separate cleanup job, no autonomous re-eligibility logic
// (docs/requirements.md § Priority Desk, "'Not this week' expiration"). Split
// the same way focus.ts is: pure, unit-testable logic here; hooks wrap it for
// the React component.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dismissalKey, type Dismissals, type NotThisWeekDismissal } from '../../../shared/boardConfig';

export const DISMISSALS_QUERY_KEY = ['priorityDesk', 'dismissals'];

// ─── Pure logic ─────────────────────────────────────────────────────────────

/**
 * The ISO date (YYYY-MM-DD) of the Monday starting the local calendar week
 * containing `date`. Computed in local time deliberately — the expiration
 * rule is "the local calendar week", not UTC.
 */
export function currentWeekMonday(date: Date = new Date()): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0 = Sunday .. 6 = Saturday
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - daysSinceMonday);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** True only while `issueId`'s dismissal (if any) was made in the same local
 * week as `weekOf`. Once the current week's Monday moves past a stale entry,
 * this returns false automatically — that IS the expiration, no cleanup step
 * required. A stale entry left in the map is simply never matched again. */
export function isDismissedThisWeek(
  dismissals: Dismissals,
  workspaceId: string,
  issueId: string,
  weekOf: string,
): boolean {
  const entry = dismissals[dismissalKey(workspaceId, issueId)];
  return entry !== undefined && entry.dismissedWeekOf === weekOf;
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

export function useDismissals() {
  return useQuery<Dismissals>({
    queryKey: DISMISSALS_QUERY_KEY,
    queryFn: () => window.vermilian.getDismissals(),
    staleTime: 60_000,
  });
}

export function useDismissIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entry: NotThisWeekDismissal) => window.vermilian.saveDismissal(entry),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: DISMISSALS_QUERY_KEY });
    },
  });
}
