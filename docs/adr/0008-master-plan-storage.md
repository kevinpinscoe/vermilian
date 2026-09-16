# ADR-0008: Master Plan storage — a YouTrack Knowledge Base article

Date: 2026-09-16
Status: Accepted

## Context

`docs/requirements.md` § Priority Desk defines a minimum Master Plan contract —
`Outcome/theme → active epics → success measure → target window → risks/dependencies` —
needed so the later "Ask for recommendation" step (VERM-8) has an unambiguous planning
source to reason against. Until now the requirements doc left *where* that article lives
as an open choice: "a single Master Plan article — a YouTrack Knowledge Base article, or
an issue in a dedicated planning project." [VERM-7](https://youtrack.kevininscoe.com/issue/VERM-7)
requires that choice be settled before Epic-context work depends on it.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **YouTrack Knowledge Base article** | YouTrack stays the sole source of truth. Vermilian already has an established integration pattern for exactly this shape of document — the `_vermilian-config` Article (`findVermilianArticle`/`createVermilianArticle`/`updateVermilianArticle`/`getVermilianArticle` in `api/youtrack.ts`, ADR-0007's "Not this week" persistence). A KB article is prose/strategy, not an issue with a workflow, assignee, or resolution state — it doesn't need any of the machinery an issue carries. | The existing `_vermilian-config` client is JSON-shaped, not prose-shaped, so the Master Plan needs its own (simpler) article read/write path rather than reusing that one directly. |
| **A dedicated planning-project issue** | Issues already have comments, links, and a `Status` lifecycle, which a strategy document doesn't need but which are "free" if reused. | Forces a planning/strategy document to pretend to be portfolio metadata — it would need a `Status`, could be accidentally resolved or reassigned, and its content would live in an issue description that isn't meant to be edited the way a document is. Creates a project whose only purpose is holding prose, which is what a Knowledge Base already exists for. Epic/task execution is already represented by native YouTrack issues and links; a planning-project issue duplicates that representation instead of sitting beside it. |
| **A local file/second store inside Vermilian** | Not seriously considered — rejected for the same reason ADR-0007 rejected a local ranking store: it breaks "YouTrack is the source of truth" and cannot be seen or edited from the YouTrack web UI or another Vermilian install. | — |

## Decision

**The Vermilian Master Plan is stored as a YouTrack Knowledge Base article.**

- YouTrack remains the source of truth for the Master Plan, exactly as it already is for
  every issue, field, comment, and link Vermilian reads.
- Vermilian already has an established Knowledge Base integration pattern
  (`_vermilian-config`, ADR-0007) — this reuses the same mechanism rather than inventing a
  second one.
- The Master Plan is planning/context material — prose describing outcomes and themes —
  not an issue pretending to carry portfolio metadata it doesn't need.
- This avoids standing up a dedicated planning project solely to hold strategy prose.
- Epic and task execution continue to be represented entirely by native YouTrack issues
  and issue links (VERM-7's Epic-context work); the Master Plan references those Epics by
  `idReadable` rather than re-modeling them.
- Vermilian does not become a second portfolio database — the Master Plan article is a
  single document Kevin edits by hand, not a target for automated writes (see
  `docs/requirements.md` § Priority Desk, "Ask for recommendation" → "Audit record").

### Minimum documented structure

```
## <Outcome / theme name>
- Active epics: VERM-3, ...        (native YouTrack idReadable references)
- Success measure: <what "done" looks like, measurably>
- Target window: <date range or milestone>
- Risks / dependencies: <free text>
```

One article, one section per outcome/theme, referencing active Epics by their
`idReadable` — the identifier Vermilian already displays everywhere — so a later
recommendation call can resolve "the epics under this outcome" back to real issues
without a second identifier scheme.

## Implementation (VERM-7)

The template above was documented first and built second, in the same ticket. The live
article — `_vermilian-master-plan`, project `VERM`, top-level (no `parentArticle`, a
sibling of `_vermilian-config` rather than its child) — exists on the production
instance as `VERM-A-2`. Its identity (the article `summary` and owning project
`shortName`) is what the code matches on; the article's own YouTrack id/URL is never
committed to application code, only recorded in the VERM-7 issue history.

### Discovery — exact match, complete search, never a silent guess

`findMasterPlanArticle` (`api/youtrack.ts`) matches **both** the exact article summary
and the owning project, via the project-scoped `/api/admin/projects/VERM/articles`
endpoint rather than the global `/api/articles` listing `_vermilian-config`'s own finder
uses — a `_vermilian-config`-style `$top=500` request would be a *bounded* search, and a
bounded search that happens to find zero or one match is not evidence of completeness.
Discovery instead pages (`$skip`/`$top`) to exhaustion within `VERM` before deciding:

| Situation | Result |
|---|---|
| No matching article, search complete | `none` — a supported empty state |
| Exactly one matching article | `found` |
| More than one matching article | `ambiguous` — every match's id is returned; **never** resolved by picking the first |
| A page request fails outright | `discovery-error` — never collapsed into `none` |
| Every request succeeds but a safety cap on page count is hit before completeness can be established | `discovery-incomplete` — distinct from both `none` and `discovery-error`, so a bounded search is never read as proof of absence or uniqueness |

### Parsing — structured diagnostics, not silent degradation

`parseMasterPlan` (`shared/masterPlan.ts`, pure, no Electron) splits the article on
`##` headings (ignoring any `#`-level title line before the first one) and reads the
four documented fields per section. It never throws. Its result carries a `status` —
`valid` (every section parsed cleanly), `partial` (at least one usable section, plus
diagnostics for what wasn't), or `unusable` (nothing usable extracted) — and a list of
typed diagnostics (`missing-field`, `unparseable-section`, `no-outcome-sections`,
`duplicate-epic-outcome`). A malformed section never hides a well-formed sibling
section: `partial` still returns every outcome it could parse.

### Epic → outcome association, and its own ambiguity case

`resolveEpicOutcome` matches a task's *native* `BoardIssue.parentEpic.idReadable`
against each outcome's `Active epics` list, case-insensitively and trimmed
(`normalizeEpicRef`) — matching only; the identifier shown on a card is always
`parentEpic.idReadable` verbatim, never anything read back out of the article. If the
same Epic idReadable is listed under more than one outcome, that Epic's association is
itself ambiguous: `resolveEpicOutcome` returns `conflict` (not the first match), the
card keeps showing its Epic line with no Outcome line, and `parseMasterPlan` folds the
conflict into its diagnostics (`duplicate-epic-outcome`) so it reaches the same banner
as every other Master Plan problem.

### No persistent cache — refresh follows Priority Desk's own lifecycle

Unlike `_vermilian-config`'s `articleConfig.ts` singleton (load once, debounced write,
long-lived in-memory cache), the Master Plan article is edited by hand in YouTrack at
arbitrary times, so a long-lived cache would hide those edits. `main/services/masterPlan.ts`
re-fetches and re-parses on every call; the renderer's own `useMasterPlan()` hook governs
refresh cadence with the same React Query `staleTime: 60_000` Priority Desk's issue
queries already use (`candidates.ts`), so a hand-edit surfaces on the article's next
ordinary refresh with no separate "reload Master Plan" action.

### Display — a diagnostic banner, not a console warning

A persistent, dismissible banner (`MasterPlanDiagnosticBanner`, mirroring the existing
`FocusRankRepairBanner`) surfaces every non-clean discovery/parse state — ambiguous
articles, a failed or incomplete discovery, or malformed/partial/conflicting content —
stating plainly that the rest of Priority Desk still works. Dismissal is scoped to a
signature of the *current* problem (`masterPlanDiagnosticSignature`: the diagnostic kind
plus, for a loaded article, its `updated` revision) for the current renderer session
only — a new problem, or the same kind of problem against a changed article revision,
reopens the banner even if a prior one was dismissed. A missing article (`none`) and a
cleanly loaded article show no banner at all; they are not diagnostics.

## Consequences

- The "Priority Desk Master Plan storage" open question in `docs/requirements.md` is
  resolved: the "KB article, or a dedicated planning project" phrasing is replaced with
  the settled decision, linking here.
- VERM-7 does not stop at documenting the template — it also builds deterministic
  discovery, parsing, and Epic→outcome association against the live article, so VERM-8's
  later recommendation step *consumes* an association VERM-7 already establishes, rather
  than resolving Epics to outcomes itself.
- Authoring and maintaining the article's content is Kevin's own hands-on work (per the
  requirements doc's "Ask for recommendation" → "Audit record" note) — Vermilian finds,
  reads, parses, and displays the article, but never creates, overwrites, or
  auto-repairs it.
- A future need for structured, queryable per-epic milestone tracking (called out in
  `docs/requirements.md` as "Epic-context delivery-step scope" beyond VERM-7's minimum) is
  not ruled out by this decision, but is not designed here — it would be a follow-on ADR
  if it needs more structure than a KB article's prose can hold.
