# UI Design & Wireframes

D2 and Mermaid wireframe diagrams live here.

## Design language — monday.com Vibe

Vermilian targets a **monday.com** look and feel. Wireframes should reflect:

- **Left-rail navigation** — project list on the left, content on the right (mirrors monday.com's board/group structure)
- **Board / list switcher** — task list can toggle between board (kanban columns) and table (dense rows) views
- **Colour-coded chips** — priority and status rendered as pill/chip components with Vibe's semantic colours (red = Critical/Show-stopper, orange = Major, blue = Normal, grey = Minor; status colours follow Vibe's `positive`/`warning`/`negative`/`info` tokens)
- **Inline editing** — clicking a field opens an inline editor; no modal dialogs for routine field updates
- **Sticky header row** — column headers stay visible when scrolling long task lists

Reference: [monday.com Vibe Design System](https://style.monday.com) and [Vibe GitHub](https://github.com/mondaycom/vibe).

## Templates

- [`_template-wireframe.d2`](_template-wireframe.d2) — D2 sketch-mode wireframe (Kroki / wiki.js)
- [`_template-wireframe.mmd`](_template-wireframe.mmd) — Mermaid screen-flow / wireframe (Kroki / wiki.js)

## Conventions

- Use D2 `sketch: true` for low-fidelity layout wireframes (boxes and regions).
- Use Mermaid `flowchart` or `sequenceDiagram` for user flows and interaction sequences.
- Name files after the screen or flow: `screen-task-list.d2`, `flow-create-task.mmd`.
- One screen or flow per file. Link related files in their comment headers.
- Add a comment block at the top of every file with: screen/flow name, renderer, and last-reviewed date.
- Annotate regions with the Vibe component name where known (e.g. `// Vibe: Table`, `// Vibe: Chips`, `// Vibe: NavigationBar`).
