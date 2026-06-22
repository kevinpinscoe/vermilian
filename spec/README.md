# SDD — Spec Driven Design

Vermilian is built spec-first. Feature specs define what the app must do before any code is written. Claude Code implements against the specs; you communicate new requirements by writing or updating spec files.

## What a spec is

A spec is a Markdown file in `spec/features/` that answers three questions about one feature:

1. **What is it?** — one-paragraph plain-language description
2. **What must it do?** — a checklist of acceptance criteria, each independently verifiable
3. **What does it look like?** — a link to or embedded wireframe from `docs/design/`

Specs describe observable behavior, not internal code structure.

## How to use SDD with Claude

1. Write or update a spec file in `spec/features/`.
2. Tell Claude: "Implement `spec/features/<name>.md`."
3. Claude reads the spec, asks clarifying questions if needed, then writes code that satisfies every acceptance criterion.
4. If a requirement changes, update the spec first — then ask Claude to re-implement.

**Never ask Claude to implement something that does not have a spec.** If the behavior is not written down, it cannot be verified.

## Directory layout

```
spec/
├── README.md                    ← this file
├── phases/                      ← one spec per development phase
│   ├── phase-0-dev-env.md
│   ├── phase-1-design.md
│   ├── phase-2-coding.md
│   ├── phase-3-testing.md
│   └── phase-4-release.md
└── features/                    ← one spec per app feature (written in Phase 1)
    ├── workspace-navigation.md      ← workspace switcher, folder tree, left rail
    ├── project-board.md             ← per-project board: Main table + Kanban, drag-drop, inline edit
    ├── board-configuration.md       ← columns, colour overrides, group-by, saved views
    ├── task-detail.md               ← right-side detail panel, inline editing, keyboard nav
    ├── create-task.md               ← full create-task modal
    ├── create-task-ai.md            ← natural-language task creation via Claude
    ├── task-timer.md                ← Pomodoro + focus mode + YouTrack worklog
    ├── standup-report.md            ← daily stand-up via Claude
    └── settings.md                  ← connection, AI, timer, daily notes, appearance
```

Phase spec files (`phases/`) are written at project start and describe phase-level deliverables and exit criteria. Feature spec files (`features/`) are written during Phase 1 and remain the authoritative definition of each feature through Phases 2–4.

## Spec template

Copy this when creating a new feature spec:

```markdown
# Feature: <Feature Name>

## Description

One paragraph explaining what this feature is and why it exists.

## Acceptance criteria

- [ ] ...
- [ ] ...
- [ ] ...

## Wireframe

See: `docs/design/<screen>.d2` or `docs/design/<screen>.mmd`

## Open questions

- [ ] ...
```
