# ADR-0006: Claude model defaults for AI features

Date: 2026-05-27
Status: Accepted

## Context

Vermilian uses the Anthropic Claude API in two places:

1. **AI task creation** (`spec/features/create-task-ai.md`) — extract a structured JSON shape (8–10 fields) from one or two sentences of natural-language task description. Latency-sensitive: the user is staring at a `Generating…` spinner during the call.
2. **Daily stand-up report** (`spec/features/standup-report.md`) — summarize 5–30 task records into a three-section markdown stand-up brief. Prose quality matters; latency tolerance is higher.

`docs/requirements.md` lists this as an open question. The `settings.md` spec already provides **two separate model fields** ("Model for task creation" and "Model for stand-up reports") that the user can override. This ADR locks in the **defaults** that ship in v0.1.0.

The available Claude 4.x models at the cutoff of this ADR:

| Model | ID | Profile |
|---|---|---|
| Opus 4.7 | `claude-opus-4-7` | Most capable; highest cost and latency |
| Sonnet 4.6 | `claude-sonnet-4-6` | Balanced — quality / cost / latency |
| Haiku 4.5 | `claude-haiku-4-5-20251001` | Fastest and cheapest; strong at structured-output tasks |

## Options considered

| Default pair | Pros | Cons |
|---|---|---|
| **Haiku 4.5 for create / Sonnet 4.6 for stand-up** | Each use case matched to its workload. Create is fast (good for "generate task" UX); stand-up gets the narrative quality. | Two different model IDs to keep in sync if Anthropic ships replacements. |
| Sonnet 4.6 for both | One mental model. Current spec default. | Create is slower than necessary; you pay Sonnet prices for a task Haiku does just as well. |
| Haiku 4.5 for both | Cheapest and fastest. | Stand-up summaries less polished. |
| Opus 4.7 for stand-up / Haiku 4.5 for create | Best possible stand-up prose. | Cost overkill — daily stand-ups don't need Opus reasoning. |

## Decision

Ship the following defaults in v0.1.0:

- **AI task creation**: `claude-haiku-4-5-20251001`
- **Daily stand-up report**: `claude-sonnet-4-6`

Both are editable in Settings (any model ID string is accepted; the field is not validated against a fixed allowlist).

The `create-task-ai.md` spec previously stated `claude-sonnet-4-6` as the create-time default — that spec is updated to reflect this ADR.

## Consequences

- The AI create flow benefits from Haiku's lower latency on the structured-extraction path.
- Settings shows two distinct model fields; users on a tighter budget can drop stand-up to Haiku 4.5 with one edit.
- When Anthropic ships new model versions, this ADR will need a revision (or a follow-up ADR) — defaults are not auto-upgraded.
- The Electron main process is the only place that holds the model IDs at runtime (it makes the API calls) — the renderer reads them through IPC but never sends API requests directly.
- The open question "AI model selection" in `docs/requirements.md` is resolved — remove from the open questions list.
