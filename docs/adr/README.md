# Architecture Decision Records

ADRs capture significant design decisions, their context, and their consequences.

## Index

| # | Title | Status |
|---|-------|--------|
| [0001](_0001-template.md) | ADR template | — |
| [0002](0002-state-management.md) | State management — TanStack Query + Zustand | Accepted |
| [0003](0003-styling.md) | Styling approach — monday.com Vibe Design System | Accepted |
| [0004](0004-credential-storage.md) | Credential storage — Electron safeStorage | Accepted |
| [0005](0005-youtrack-rest-api.md) | YouTrack REST API namespace and version policy | Accepted |
| [0006](0006-claude-model-selection.md) | Claude model defaults for AI features | Accepted |

## Process

1. Copy `_0001-template.md` to `NNNN-<short-slug>.md` (zero-padded, next available number).
2. Fill in all sections. Leave **Status** as `Proposed` until discussed.
3. Open a PR with branch `adr/NNNN-<slug>`. Resolve discussion in the PR before merging.
4. Once merged, update the index table above.
5. If a decision is superseded, update the old ADR's Status field and link to the new one — do not delete it.
