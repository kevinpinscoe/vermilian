# PLAN — VERM-9: Priority Desk Daily Review

Tracked in [VERM-9](https://youtrack.kevininscoe.com/issue/VERM-9). Depends on the Manual
desk (VERM-5/VERM-6, merged); does not depend on AI recommendation (VERM-8) — Daily Review
never calls Claude.

## Constraints (Kevin, given before starting)

1. Deterministic panel only — no Claude call, no scoring, no interpretation. Daily Review
   reports current state; it does not generate it.
2. "Focus items needing attention" = Focus is `Yes` **and** Focus rank is unset. No other
   rule (no overdue dates, no priority thresholds, no staleness, no AI-derived urgency)
   unless the ticket is amended to require one.
3. The three agent-work sections (awaiting review / needing input / failed) render as
   empty/unavailable states — never fabricated from ordinary YouTrack fields — because no
   agent-execution metadata store exists in Vermilian yet.
4. Entry point mirrors Stand-up exactly: a top-bar button beside `standup-btn`, opening a
   modal built the same way `StandupModal` is.
5. Do not autonomously reprioritize anything; do not close or accept any issue from this
   view.

## Design decisions

### No new data store, no Claude — reuse what VERM-4/5/6 and Stand-up already built

Every section is derived from data Vermilian already fetches:

| Section | Source |
| --- | --- |
| Recently completed | `youtrack.getIssuesForStandup()`'s `done` bucket (main process) — the same function Stand-up uses, called directly with no Claude step afterward |
| Now / Next / Then | `useWorkspaceFocusRankHolders()` (`project-board/focus.ts`) — identical to Priority Desk's own Now mode, verbatim |
| Blocked focused work | Derived client-side from the same per-project `['youtrack','issues',shortName]` board query: any issue with `isFocusRank(fields.focusRank)` and `fields.status === 'BLOCKED'` |
| Needs attention | Same board query: `fields.focus === 'Yes'` and `!isFocusRank(fields.focusRank)` |
| Agent work (3 sections) | No data source. Static "not available yet" panels. |

No second local database, no new YouTrack query shape beyond what Stand-up already sends,
no new field. This is the point of the epic's own guardrail ("no new local issue
database").

### Scope and window — fixed, not configurable

Unlike Stand-up, Daily Review has no scope/window config step. It is always scoped to the
**active workspace** and a **fixed 48-hour window** for "recently completed" — matching
Stand-up's own default window. A decision surface that opens straight to its content, with
no form to fill in first, is "bounded" in the sense the acceptance criteria ask for; a
configurable window would reopen the "forced daily planning" surface the epic explicitly
guards against. If Kevin wants this configurable later, that is a follow-up, not part of
this ticket's scope.

### New IPC: `dailyReviewGet` — completed work only

The board query (`getIssues`, `includeResolved: false`) already covers Now/Next/Then,
blocked-focused, and needs-attention — all unresolved issues. It cannot answer "recently
completed", which requires resolved issues within a time window; that is what
`getIssuesForStandup` is for. So the only new main-process work is a thin handler that
calls it and returns the `done` bucket, with no Claude call:

```ts
// shared/ipc.ts
export interface DailyReviewTask {
  idReadable: string;
  summary: string;
  priority: string | null;
}
export interface DailyReviewGetResult {
  ok: boolean;
  error?: string;
  completed?: DailyReviewTask[];
}
```

```ts
// main/ipc.ts — IPC.dailyReviewGet handler
// 1. Load config + YouTrack token (no Claude key required).
// 2. Resolve active-workspace project short names (same lookup standupGenerate
//    already does for scope: 'active-workspace').
// 3. cutoffMs = Date.now() - 48h.
// 4. const { done } = await youtrack.getIssuesForStandup(url, token, shortNames, cutoffMs);
// 5. Map to DailyReviewTask[] and return { ok: true, completed }.
```

### Blocked-focused and needs-attention: derived, not fetched separately

Both come from the exact same `['youtrack','issues',shortName]` query
`useWorkspaceFocusRankHolders` already issues per active-workspace project (same
`staleTime`, same cache key) — so `DailyReviewModal` rides that cache rather than adding
new requests. A new hook, `useDailyReviewBoardData()` in
`renderer/features/daily-review/boardData.ts`, runs the same `useQueries` shape and
derives two lists from the combined `BoardIssue[]`:

```ts
export function deriveBlockedFocused(issues: BoardIssue[]): BoardIssue[] {
  return issues.filter((i) => isFocusRank(i.fields.focusRank) && i.fields.status === 'BLOCKED');
}
export function deriveNeedsAttention(issues: BoardIssue[]): BoardIssue[] {
  return issues.filter((i) => i.fields.focus === 'Yes' && !isFocusRank(i.fields.focusRank));
}
```

Both are pure and unit-tested directly (no DOM, no React Query) — same convention as
`focus.ts`'s `holdersOfRank`/`decideRankAssignment`.

### Entry point

`AppShell.tsx` gets a `daily-review-btn` beside `standup-btn`, toggling
`showDailyReview`, exactly mirroring `showStandup`. `DailyReviewModal` takes no
scope/window props (see above) — just `onClose`.

### Agent-work sections — explicitly inert

Three fixed sections, each an `AttentionBox type="informative"` (or equivalent) reading
along the lines of "Agent work tracking isn't set up yet — nothing to show here." No IPC
call backs them. This is what "must degrade cleanly if agent-execution metadata is not yet
implemented" means in practice: the feature ships with these sections permanently in their
not-yet-available state until Vermilian actually has agent-execution metadata, which is
out of scope for VERM-9.

## Out of scope

- Any AI-generated summary text (that is what Stand-up is for).
- A configurable scope/window step.
- Any new local persistence — Daily Review reads, it never writes.
- Real agent-execution status — no such store exists yet.
