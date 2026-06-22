# Feature: Create Task (AI / Natural Language)

## Description

The AI task creation feature lets the user describe a task in plain English. The description is sent to the Claude API, which extracts a structured set of YouTrack field values from it. The user sees the proposed values in an editable preview form — identical in layout to the standard create-task form — and can adjust any field before submitting to YouTrack. This feature requires a Claude API key to be configured in Settings; without it the entry point is disabled with an explanatory tooltip.

## Acceptance criteria

### Entry point and gating

- [ ] An **AI create** button (magic wand or sparkle icon, labelled "AI create") sits adjacent to the **New task** (`+`) button in the left rail header.
- [ ] If no Claude API key is configured in Settings, the button is disabled. Hovering it shows a Vibe `Tooltip`: "Configure a Claude API key in Settings to use AI task creation."
- [ ] The keyboard shortcut **A** (when no text input is focused and AI is configured) also opens the AI create dialog.

### Input dialog

- [ ] Clicking the enabled button opens a Vibe `Modal` with a single multi-line text area labelled "Describe your task."
- [ ] A subtitle below the label reads: "Describe what needs to be done. Include any relevant details — priority, deadline, project, category, or related ticket numbers."
- [ ] The text area is auto-focused when the modal opens.
- [ ] A **Generate** button and a **Cancel** button are in the modal footer. Cancel closes without creating anything.
- [ ] The Generate button is disabled while the text area is empty.

### Claude API call

- [ ] Clicking Generate sends the description to the Claude API with a system prompt that instructs the model to extract YouTrack task fields as structured JSON.
- [ ] The request is made from the Electron main process (not the renderer) so the API key is never exposed to the renderer context.
- [ ] The Claude model used is configurable via Settings under **Model for task creation**; the default is `claude-haiku-4-5-20251001` (see [ADR-0006](../../docs/adr/0006-claude-model-selection.md)). This is a **separate** setting from the model used for stand-up reports.
- [ ] While the API call is in flight, the text area and Generate button are disabled and a spinner replaces the button label.
- [ ] The expected JSON response shape is:

  ```json
  {
    "summary": "string (required)",
    "project": "string or null — matched to a known project name",
    "priority": "Show-stopper | Critical | Major | Normal | Minor | null",
    "status": "To do | In Progress | Done | ... | null",
    "category": "OPS | COMPANY | ... | null",
    "due_date": "ISO 8601 date string or null",
    "ticket": "string or null",
    "notes": "string or null",
    "clarification_needed": "string or null — if the model cannot extract a summary"
  }
  ```

- [ ] If `clarification_needed` is non-null, the input modal stays open and the clarification text is displayed beneath the text area as a Vibe `Banner` (info). The user can refine the description and re-generate.

### Review and edit form

- [ ] On a successful extraction (non-null `summary`), the input modal transitions to a pre-filled create-task form with all extracted values populated.
- [ ] The review form is identical in layout and behaviour to the standard create-task form (see `spec/features/create-task.md`) — all fields are editable.
- [ ] A banner at the top of the form reads: "AI-generated — please review before creating." This banner is informational (Vibe `Banner`, type `info`) and non-dismissible.
- [ ] Fields Claude could not confidently extract are left blank (not filled with a guess).
- [ ] If Claude extracts a project name that does not match any known YouTrack project, the Project field is left blank and a Vibe inline error is shown beneath it: "Could not match a project — please select one."
- [ ] The user can go back to the description input by clicking a **← Re-describe** link.
- [ ] Submission follows the same flow as the standard create-task form, including the `Date time entered` auto-stamp.

### Error handling

- [ ] If the Claude API call fails (network error, quota exceeded, invalid key), the input modal stays open and a Vibe `Banner` (danger) shows the error. The Generate button returns to its enabled state.
- [ ] If the API returns a response that cannot be parsed as valid JSON, treat it as an extraction failure: keep the modal open, show a Banner: "Could not parse a structured task — please try rephrasing."

## Wireframe

See: `docs/design/screen-create-task-ai.d2` and `docs/design/flow-create-task-ai.mmd`

## Open questions

<!-- Resolved questions (kept here for traceability):
- Same model as stand-up: resolved — separate Settings field; default Haiku 4.5 for create, Sonnet 4.6 for stand-up (ADR-0006).
- Multi-turn refinement: resolved — single extraction + manual edit in MVP. `← Re-describe` returns to the input and runs a fresh single-shot extraction.
-->

- [ ] Should the model's response use Anthropic's tool-use API for structured output (more reliable JSON) or free-form JSON prompting? Recommend tool-use; confirm during implementation.
