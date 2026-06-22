# ADR-0002: State management — TanStack Query (server) + Zustand (local UI)

Date: 2026-05-27
Status: Accepted

## Context

Vermilian's renderer manages two distinct kinds of state:

- **Server state** — YouTrack issues, projects, work items. Fetched via the REST API, written back via PATCH/POST/DELETE. Needs optimistic updates, rollback on API error, automatic refetch, and cache invalidation when an issue is mutated from a different view.
- **Local UI state** — active workspace, selected project, board `Group by` selection, current filter values, focus-mode flag, Pomodoro timer phase, theme, panel open/closed.

Two spec acceptance criteria put particular pressure on the choice:

- `task-detail.md` requires inline edits that save on blur with an optimistic update and **revert + error toast** on failure (server state pattern).
- `task-timer.md` requires a single source of truth for "which task is currently being timed" that the entire app can read (the project board, task-detail panel, and focus-mode overlay all depend on it).

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **Redux Toolkit + RTK Query** | One library covers both kinds of state. Excellent DevTools. Industry standard. | Significant boilerplate for a small app. Mental overhead (slices, thunks, listeners) larger than this app needs. |
| **Zustand only** | Tiny API. Easy mental model. | Would re-implement server-cache features (refetch, stale-while-revalidate, optimistic update + rollback) by hand. |
| **TanStack Query + React Context** | Mature server-state caching via TanStack Query. Skips an extra library for UI state. | React Context boilerplate (Provider + custom hooks per slice) grows quickly with the number of UI state slices. |
| **TanStack Query + Zustand** | Each library does one thing well. TanStack Query's `useMutation` `onMutate` / `onError` matches the inline-edit rollback requirement exactly. Zustand stores UI state with ~10 lines and no Provider tree. | Two libraries instead of one. |
| **Jotai** | Atom model is powerful for fine-grained reactivity. | Less common than Zustand; team-onboarding cost. No built-in server cache; would still need TanStack Query alongside. |

## Decision

Use **TanStack Query for server state and Zustand for local UI state**.

- **TanStack Query** owns every YouTrack REST API call. Queries (`useQuery`) for reads; mutations (`useMutation`) for writes with `onMutate` for optimistic updates and `onError` for rollback. Query keys are namespaced by entity and ID (e.g., `['issues', projectId, filters]`, `['issue', issueId]`).
- **Zustand** owns local UI state in a small number of slice stores: `useWorkspaceStore`, `useBoardUIStore`, `useTimerStore`, `useThemeStore`. No middleware in MVP.
- The Electron main process does not run either library — it exposes IPC methods that the renderer calls via the preload contextBridge. Main-process state (API tokens, in-flight Claude calls) is plain TypeScript modules.

## Consequences

- The inline-edit acceptance criterion in `task-detail.md` maps directly to `useMutation({ onMutate, onError, onSuccess })` — the rollback is `setQueryData` to the pre-mutation snapshot.
- The `task-timer.md` "one timer at a time" rule is enforced by `useTimerStore` — starting a timer when one is already running is a single store action that fires the confirmation prompt.
- Cross-view cache invalidation (e.g., creating a task in one board should appear in stand-up scope counts) uses `queryClient.invalidateQueries`.
- DevTools: the TanStack Query devtools panel is opt-in (`<ReactQueryDevtools />`); Zustand has no built-in devtools — use `@redux-devtools/extension` only if needed.
- Persistence (cached data surviving app restart) is **out of scope** for MVP. Every launch refetches from YouTrack.
- The open question "State management library" in `docs/requirements.md` is resolved — remove from the open questions list.
