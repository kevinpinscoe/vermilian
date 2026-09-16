# PLAN — VERM-7: Priority Desk Epic context and Master Plan

Tracked in [VERM-7](https://youtrack.kevininscoe.com/issue/VERM-7). Depends on VERM-6
(Choose next), which shipped without the active-Epic filter this ticket completes.

## Scope

- Read native YouTrack Epic → Subtask issue links; no synthetic field, no custom-field
  surrogate for Epic membership.
- Show a task's parent Epic on Now-mode cards when resolvable.
- Populate and wire the active-Epic filter in Choose next (deferred by VERM-6).
- Settle the Master Plan storage decision (ADR-0008: YouTrack Knowledge Base article) and
  document its minimum template.
- Out of scope: AI recommendation (VERM-8), Daily Review, automated Epic restructuring,
  automated issue-link writes, Epic re-parenting UI.

## Design decisions

### 1. Master Plan storage — ADR-0008

Decision: a single YouTrack Knowledge Base article, matching the existing
`_vermilian-config` pattern, rather than a dedicated planning project. See
`docs/adr/0008-master-plan-storage.md`.

### 2. Epic/Subtask relationship resolution — do not trust the direction bucket alone

YouTrack's `Subtask` issue-link type is directed: `sourceToTarget: "parent for"`,
`targetToSource: "subtask of"`. Querying `/api/issues/{id}/links` returns both direction
buckets (`OUTWARD`, `INWARD`) for every link type, each carrying the issues on the other
side of a link stored in that direction.

**Live data proves the stored direction is not reliable evidence of which side is the
parent.** VERM-3 (Type `Epic`) and its five subtasks were inspected directly against the
production instance (2026-09-16): four subtasks (VERM-5, 6, 7, 8, 9) carry the expected
`INWARD` "Subtask" link back to VERM-3. The fifth, VERM-4 (Type `Task`, the Foundation
delivery step), carries an **`OUTWARD`** "Subtask" link *to* VERM-3 — i.e. the link was
authored in the reverse direction from every other subtask, and a naive "children are
whatever's in the parent's OUTWARD bucket" reading would both miss VERM-4 as a subtask of
VERM-3 and misread it as VERM-3's parent.

**Resolution:** for a given issue, collect every issue appearing in either direction
bucket of its own `Subtask`-type link (`linkType.name === 'Subtask'`), then treat as its
parent Epic whichever of those linked issues has its own `Type` field equal to `Epic`.
This is direction-independent and survives the reversed-link case, because it keys off
what the linked issue *is* rather than which bucket the link landed in. A task with no
Subtask-type link, or one whose only Subtask-type links point at non-Epic issues, has no
parent Epic.

This needs the linked issue's `Type` field, so the links query embeds
`issues(idReadable,summary,customFields(name,value(name)))` rather than a bare
`issues(idReadable,summary)`.

### 3. Fetch shape — bounded, shared, no per-card N+1

`youtrack.ts`'s existing per-project issue query (`getIssues`, called once per project in
the active workspace via `useQueries` — see `candidates.ts`) already returns every
`BoardIssue` a card needs. Extending that single query's `fields` string to also embed
`links(...)` costs nothing beyond a slightly larger response for the same one request per
project; it introduces **no new IPC channel and no new React Query cache key**. Resolved
`parentEpic` rides on `BoardIssue` itself, under the existing `['youtrack','issues',
shortName]` cache Now mode, Choose next, and the boards already share.

`BoardIssue.parentEpic: { id: string; idReadable: string; summary: string } | null` is a
top-level field, deliberately **not** added to `FIELD_DEFS`/`BoardIssueFields` — it is
issue-link metadata, not a custom field, and does not belong in the field registry that
drives board columns, the create-task form, or `patchIssue`.

### 4. Active-Epic filter — derived, not enumerated

The filter's options are the distinct `parentEpic` values found across every issue
already fetched for the active workspace (before Status/dismissal/rank filtering) — no
hard-coded list, no additional query. Selecting one adds a conjunctive
`issue.parentEpic?.id === epicFilter` check in `computeCandidates`, alongside every
existing VERM-6 eligibility rule (workspace scope, Status ≠ Done, no Focus rank 1–3, not
dismissed this week, the Status filter). Ordering (`Due Date` → `Priority` →
`idReadable`) and the seven-item cap are unaffected — the Epic filter narrows the
eligible set the same way the Status filter already does, before sorting and capping run.

## Master Plan template (documented, not built)

Minimum structure for the KB article, one Master Plan article covering every workspace:

```
## <Outcome / theme name>
- Active epics: VERM-3, ...        (native YouTrack idReadable references)
- Success measure: <what "done" looks like, measurably>
- Target window: <date range or milestone>
- Risks / dependencies: <free text>
```

Referencing active Epics by their `idReadable` — the same identifier Vermilian already
displays everywhere — is what lets VERM-8's AI recommendation step deterministically
resolve "the epics under this outcome" back to real YouTrack issues without inventing a
second identifier scheme.

## Task breakdown

See `CHECKPOINT.md` at the repository root (primary working tree) for the live,
timestamped task list. This file records the design; that one tracks progress.

## Verification

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm package`, `pnpm test:e2e`, plus a
visual QA pass against the dev server with the fake YouTrack backend
(`VERMILIAN_E2E=1`), before the pull request is opened.
