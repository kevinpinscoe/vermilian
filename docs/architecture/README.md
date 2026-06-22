# Architecture Diagrams

D2 and Mermaid architecture diagrams live here.

## Templates

- [`_template.d2`](_template.d2) — D2 architecture template (Kroki / wiki.js)
- [`_template.mmd`](_template.mmd) — Mermaid architecture template (Kroki / wiki.js / native)

## Conventions

- Prefix template files with `_` so they sort to the top and are not mistaken for real diagrams.
- Name real diagrams descriptively: `api-layer.d2`, `data-model.mmd`, `deployment.d2`.
- One concern per file; compose a high-level overview diagram that references the others in its comments.
- Add a comment block at the top of every diagram file with: description, renderer, and last-reviewed date.
