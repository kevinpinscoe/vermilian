# Contributing to vermilian

## Workflow

This repo is hosted on GitHub (`git@github.com:kevinpinscoe/vermilian.git`) and is a solo personal project. The working pattern is:

- **Design, spec, ADR, docs, and one-off fixes**: commit directly to `main`. All commits are SSH-signed (`commit.gpgsign = true`); unsigned commits should not land on `main`.
- **Substantive feature implementation (Phase 2+) and anything touching `app/src/`**: use a branch from the table below and open a PR for review before merging, even when reviewing your own work — the PR gives a checkpoint to read the diff in one view and run CI before merging.
- **AI-generated content from Claude Code** is committed with `Co-Authored-By: Claude Opus <noreply@anthropic.com>` (or the appropriate model name) in the trailer. The same direct-to-`main` vs. branch-and-PR rule applies based on what the AI changed, not who wrote it.

Steps for branch-and-PR work:

1. Create a branch from `main` using the naming convention below.
2. Add or modify files.
3. Validate any diagrams render correctly (see below).
4. Open a PR; fill in all sections of the template.
5. Self-review the diff before merging.

## Branch naming

| Type | Pattern | Example |
|------|---------|---------|
| Architecture diagram | `design/arch-<topic>` | `design/arch-api-layer` |
| UI wireframe | `design/ui-<screen>` | `design/ui-task-list` |
| ADR | `adr/<number>-<slug>` | `adr/0002-state-management` |
| Requirements / specs | `spec/<feature-slug>` | `spec/task-list` |
| Feature implementation | `feat/<feature-slug>` | `feat/task-list` |
| Bug fix | `fix/<short-description>` | `fix/token-refresh` |
| Phase 0 env / tooling | `phase0/<step>` | `phase0/node-setup` |

## Diagram conventions

### File naming

- D2 files: `<name>.d2`
- Mermaid files: `<name>.mmd`
- Place architecture diagrams in `docs/architecture/`, wireframes in `docs/design/`

### Rendering — Kroki

POST the raw diagram source to your Kroki instance:

```bash
# D2
curl -s -X POST https://<kroki-host>/d2 \
  -H 'Content-Type: text/plain' \
  --data-binary @path/to/diagram.d2 -o out.svg

# Mermaid
curl -s -X POST https://<kroki-host>/mermaid \
  -H 'Content-Type: text/plain' \
  --data-binary @path/to/diagram.mmd -o out.svg
```

### Rendering — wiki.js

Embed in a wiki.js page using fenced code blocks with the Kroki plugin active:

````
```kroki
d2
<paste D2 source here>
```
````

````
```kroki
mermaid
<paste Mermaid source here>
```
````

Native Mermaid blocks also work if the Mermaid module is enabled in wiki.js:

````
```mermaid
<paste Mermaid source here>
```
````

## AI assistance (Claude Code)

Claude Code is used to generate and iterate on design artifacts. When a PR contains AI-generated content, note the scope in the PR description under the **AI assistance** section of the template. This keeps the design rationale traceable.
