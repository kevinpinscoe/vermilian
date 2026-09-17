# PLAN — VERM-8: Priority Desk AI adviser (Ask for recommendation)

Tracked in [VERM-8](https://youtrack.kevininscoe.com/issue/VERM-8). Depends on VERM-7
(Epic context / Master Plan), merged.

## Constraints (Kevin, given before starting)

1. Consume existing Epic-to-outcome associations (`resolveEpicOutcome` from VERM-7) —
   never re-derive.
2. Never write `Focus`/`Focus rank`/`Status`/Epic links automatically — only via one of
   the three confirmation actions.
3. Use only the bounded candidate set (`useChooseNextCandidates`, ≤7) — never a wider query.
4. Require explicit user choice before applying anything.
5. Audit comment only after a ranked recommendation AND a user choice.
6. Clarification-only responses: no audit comment, no task changes.

## Design decisions

### Data scope — a fresh, bounded fetch, not the board cache

`BoardIssue` has no `description` field (never fetched anywhere in the app), and the
board's `links(...)` embed (VERM-7) only surfaces Subtask-type buckets' linked-issue Type.
The recommendation call needs the issue `description` and *all* link types (for
"dependency readiness"), so it uses a **new, separate fetch by exact id list** —
`getIssuesForRecommendation(url, token, ids)` — called only with the ids of the currently
displayed candidate cards (≤7). This is deliberately not folded into the shared
`['youtrack','issues',...]` cache: it is a one-shot, request-scoped payload, not board
state, and reusing that cache would either bloat every board load with `description` or
require a second field-shape variant of the same query key (rejected during VERM-7's
review for the same architectural reason).

### No numeric score

The Claude tool schema's evidence fields (`outcome_contribution`, `dependency_readiness`,
`urgency`, `effort`, `risk`) are free-text strings. There is no numeric field anywhere in
the request or response shape.

### Confirmation actions and field writes

- **Apply to desk** — assigns Focus rank 1/2/3 to the top three via the *existing*
  `useFocusMutations().setRank` (VERM-4), never a second ranking mechanism. If any of
  ranks 1-3 is already held by a *different* issue, the action is refused with a message
  pointing at the existing holder rather than silently displacing it or reimplementing the
  conflict-resolution dialog inline — a deliberate scope trim (see "Trims" below).
- **Star only** — `useFocusMutations().toggleFocus` on each of the top three not already
  Focus=Yes. No rank assigned.
- **Keep my order** — no field writes. Still a real "user choice" for audit purposes.

### Audit comment

`shared/recommendationAudit.ts` exports a pure `buildAuditComment(items, action)` —
unit-testable with no network/Electron dependency. The IPC handler calls it and posts the
result via a new `youtrack.postComment` (no such function existed before this ticket —
every comment on record so far was posted outside the app). Only ever called from the
confirmed-choice path, targeting the top-ranked issue.

### Clarification-only path

`RecommendationResult` is a discriminated union (`kind: 'ranked' | 'clarification'`). The
panel renders the question and offers no confirmation actions at all when `kind ===
'clarification'` — there is nothing to confirm, so no audit call is reachable from that
state by construction, not just by convention.

## Trims made under context/time constraints (flagged, not hidden)

- **No Settings UI for a dedicated recommendation model.** `AppConfig.modelForRecommendation`
  exists with a sensible default (`claude-sonnet-4-6`, matching ADR-0006's quality-over-speed
  choice for prose/reasoning tasks), but there is no Settings form field to override it yet —
  matches `modelForCreate`/`modelForStandup`'s *existence* but not their *editability*. Fast
  follow, not a correctness or safety gap.
- **Apply-to-desk conflict handling is refuse-not-resolve.** Rather than reusing the full
  displace-conflict dialog (`focus-rank-conflict-dialog`), a rank already held by a
  different issue blocks the action with a message rather than prompting to displace. Safer
  default (never a surprise reassignment), simpler to verify, at the cost of one extra
  manual step for the user in that specific collision case.

## Verification

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm package`, `pnpm test:e2e`, plus visual QA
against the packaged app with the fake backend.
