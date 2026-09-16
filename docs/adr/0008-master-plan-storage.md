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

## Consequences

- The "Priority Desk Master Plan storage" open question in `docs/requirements.md` is
  resolved: the "KB article, or a dedicated planning project" phrasing is replaced with
  the settled decision, linking here.
- VERM-7's Epic-context read path and VERM-8's later recommendation step both depend on
  Epic references being `idReadable` strings inside this article's prose, not on any new
  schema.
- Authoring and maintaining the article's content is Kevin's own hands-on work (per the
  requirements doc's "Ask for recommendation" → "Audit record" note) — Vermilian does not
  write to it programmatically in VERM-7 or later.
- A future need for structured, queryable per-epic milestone tracking (called out in
  `docs/requirements.md` as "Epic-context delivery-step scope" beyond VERM-7's minimum) is
  not ruled out by this decision, but is not designed here — it would be a follow-on ADR
  if it needs more structure than a KB article's prose can hold.
