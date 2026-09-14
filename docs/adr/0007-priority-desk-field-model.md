# ADR-0007: Priority Desk field model — dedicated Focus fields, not an overload of Priority

Date: 2026-09-14
Status: Accepted

## Context

The Priority Desk (`docs/requirements.md` § Priority Desk; investigated in
[VERM-1](https://youtrack.kevininscoe.com/issue/VERM-1), prepared in
[VERM-2](https://youtrack.kevininscoe.com/issue/VERM-2)) needs to answer a question YouTrack's
existing `Priority` field (`Show-stopper` / `Critical` / `Major` / `Normal` / `Minor`) cannot:
of several `Major`-priority issues across different projects, which one is the next actual
commitment? `Priority` expresses urgency/impact, set once and rarely revisited. The desk needs
something that changes daily — a small, explicit, human-set ranking — without disturbing the
urgency signal every other view in Vermilian already relies on.

The desk also needs a place to record *why* an issue was chosen, so the Now/Next/Then cards can
show a one-line reason instead of asking the reader to reconstruct it, and a place to persist
"Not this week" dismissals without inventing a second data store outside YouTrack.

Source idea: `~/ideation/ideation/ideas/vermilian-improvements-q3-2026/README.md`.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **Overload `Priority`** — treat `Show-stopper`/`Critical` as "in focus" | No new fields; nothing to add to the field registry | Conflates urgency with day-to-day sequencing. Every board, filter, and chip in the app that already reads `Priority` as urgency would need to special-case the overload. Cannot express *why* an issue is next, or its rank among several equally urgent issues. |
| **Dedicated `Focus` / `Focus rank` / `Why now` fields** | Ranking and urgency stay independent. `Focus rank` gives an explicit Now/Next/Then order that a single enum cannot. `Why now` gives the card its one-line reason without a free-text search through `Notes`. Fields are optional and additive — nothing else in Vermilian has to change to tolerate them. | Three more shared custom fields to add to every active project and to Vermilian's field registry. |
| **A separate local ranking store** (SQLite, JSON file, etc.) inside Vermilian | No YouTrack schema change at all | Breaks "YouTrack is the source of truth" (`docs/requirements.md` § Scope). A second store that can drift from YouTrack, that other YouTrack clients (the web UI, Vermilian on another machine) cannot see or edit, and that needs its own backup and sync story Vermilian does not otherwise have. |

## Decision

Add three shared, optional custom fields to every active project:

| Field | Type | Purpose |
|---|---|---|
| `Focus` | single-value enum: `Yes` / empty | Source-of-truth star, rendered as a filled or outline star in Vermilian. |
| `Focus rank` | integer, `1`–`3` or empty | Ordering for Now, Next, Then; setting a rank also sets `Focus`. |
| `Why now` | short text | Human-authored reason visible on the desk card. |

Setting `Focus rank` implies `Focus = Yes`. Clearing `Focus` clears the rank but preserves
`Why now`, so a deferred item's reasoning survives for later reconsideration rather than being
discarded. Setting a fourth rank while all three slots are full prompts which slot to replace —
it never silently evicts existing focus work.

Transient desk state that is not project data — specifically "Not this week" dismissals — is
**not** a fourth field. It is stored in the existing `_vermilian-config` YouTrack Knowledge Base
Article (already used for workspace/folder structure and per-board configuration; see
`docs/requirements.md` § Workspaces and organization), keyed by workspace and issue ID. This
keeps it syncing across machines the same way the rest of Vermilian's own configuration does,
without adding a fourth custom field for something that is Vermilian's own UI state rather than
a fact about the issue.

`Priority` is untouched. The desk reads it for the priority chip on a card, exactly as every
other view does; it never writes to it and never derives ranking from it.

## Consequences

- `Focus`, `Focus rank`, and `Why now` need to exist on every active project before the
  Foundation delivery step (`docs/requirements.md` § Priority Desk) can ship — this is
  schema work, in the same style as the `Issue domain` / `Edit host` / `Affected host` fields
  added under the host-and-domain-fields work.
- Vermilian's field registry, board rows, Kanban cards, and the task detail panel all gain one
  new editable field group; none of the existing `Priority`-reading code paths change.
- The AI recommendation step (delivery step 4) reasons over `Focus`/`Focus rank`/`Why now` and
  the bounded candidate set — it is documented as never writing any of the three fields itself,
  which this field model does not need to enforce technically; that constraint lives in the
  application layer, not the schema.
- A future desk feature that needs per-viewer state with no cross-machine sync requirement
  (not the case for "Not this week", which does need to sync) would still have grounds to use
  `localStorage`-style storage instead of the KB article — this ADR does not rule that out for
  a case that has not arisen yet.
- The "Priority Desk field model" open question in `docs/requirements.md` is resolved — kept in
  the open questions list as `[x]`, per that file's own traceability convention, with a link to
  this ADR.
