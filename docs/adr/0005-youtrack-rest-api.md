# ADR-0005: YouTrack REST API namespace and version policy

Date: 2026-05-27
Status: Accepted

## Context

`docs/requirements.md` lists "Which YouTrack REST API version to target (v3?)" as an open question. JetBrains YouTrack does not version its REST API with numbered major versions; the `/api/...` namespace iterates in place over time. The only meaningful version split is between the modern `/api/...` namespace and the legacy `/rest/...` namespace, which has been deprecated since 2017.

All Phase 1 feature specs (`task-detail.md`, `create-task.md`, `standup-report.md`, etc.) and the reference bash scripts in `scripts/YouTrack/hosted/` already call `/api/...`. The question is really about pinning a single, durable policy for which namespace Vermilian targets and what minimum server version (if any) to declare.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **Target `/api/...` only ("current" YouTrack as the floor)** | Matches everything already in the repo. Zero migration. Forward-compatible with future YouTrack releases. | If a future YouTrack release removes an endpoint, no formal floor to lean on — must update client. |
| **Pin a minimum YouTrack server version explicitly** | Documents the exact server contract. Enables guarded `Banner` if the connected instance is older. | Requires identifying the version of the live self-hosted instance now; adds an API call (`/api/admin/telemetry` or similar) to detect on connect. |
| **Support `/rest/...` legacy as a fallback** | Backwards compatibility with very old YouTrack instances. | Doubles client surface; the legacy namespace is deprecated and shapes don't match modern responses. No real-world need. |

## Decision

- **Vermilian targets the modern `/api/...` namespace only.** The legacy `/rest/...` namespace is rejected.
- **No explicit minimum YouTrack server version is declared.** The floor is "current" — whatever the live self-hosted instance at `https://youtrack.example.com` is running. If an API call returns 404/410 against a newer YouTrack release, the client treats that as a regression to file against this ADR, not a configurable fallback.
- The following are **not** mandated by this ADR — they are code-level conventions:
  - Centralizing `fields=` selector strings as named constants
  - Pagination policy (`$top`/`$skip` vs fetch-all-with-cap)
  - Normalization of `customFields` array into a flat object at the API-client boundary

## Consequences

- The YouTrack API client module (`src/main/api/youtrack.ts`) only knows the `/api` namespace. No version negotiation, no namespace toggle.
- If JetBrains ships a breaking change to `/api`, Vermilian needs a client-side fix — but the fix is bounded because the legacy namespace is not in scope as a fallback.
- Test fixtures for Phase 3 should record real `/api/...` responses from the live instance, not handwritten mock shapes.
- The open question "Which YouTrack REST API version" in `docs/requirements.md` is resolved — remove from the open questions list.
