# ADR-0009: Priority Desk ranks are set with explicit controls, not drag-and-drop

Date: 2026-11-04
Status: Accepted

## Context

`docs/requirements.md` § Priority Desk, the Priority Desk wireframes, and the original mockup
described dragging a Choose-next card into a Now/Next/Then slot. VERM-6's scope instead assigned
ranks through the Focus rank control delivered in VERM-4, so that was what shipped, and no
drag-to-slot exists. Preparing human acceptance under
[VERM-10](https://youtrack.kevininscoe.com/issue/VERM-10) surfaced the conflict as finding K3 in
[`priority-desk-acceptance.md`](../priority-desk-acceptance.md).

## Options considered

| Option | Pros | Cons |
|--------|------|------|
| Keep the Focus rank controls and correct the documents | One tested path for rank changes on every surface; explicit about which rank is chosen; no new code | No direct-manipulation gesture on the desk |
| Build drag-to-slot to match the older wording | Matches the original mockup | New interaction to build and test for a result the rank control already gives; delays acceptance |

## Decision

Kevin decided on 2026-11-04 to keep the existing Focus rank controls: reliable, explicit priority
selection matters more to him than drag-and-drop. Drag-to-slot is not a Priority Desk requirement,
and it is not to be built solely to satisfy the older wording.

## Consequences

- Ranks are assigned through the star and rank badge (`FocusControl`) on board rows, Kanban cards,
  the task detail panel, and desk cards. The rank invariant's conflict dialog applies to all of them.
- `docs/requirements.md`, `docs/design/README.md`, `flow-priority-desk.mmd` and
  `screen-priority-desk-choose-next.d2` are corrected to match.
- `docs/design/priority-desk-mockup.html` keeps its drop zones as a record of the original idea. It
  is not a specification of this behavior.
- Drag-and-drop between board groups and between project boards is a separate feature and is
  unaffected.
