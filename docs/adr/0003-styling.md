# ADR-0003: Styling approach — monday.com Vibe Design System

Date: 2026-05-22
Status: Accepted

## Context

Vermilian targets a monday.com look and feel: colour-coded priority/status chips, left-rail project navigation, high-density board and list views, and inline field editing. A styling decision is needed before any Phase 2 UI code is written.

The candidates were:

1. **Tailwind CSS** — utility-first CSS; no component library included
2. **CSS Modules** — scoped CSS co-located with each component; no pre-built components
3. **styled-components** — CSS-in-JS; no pre-built components
4. **monday.com Vibe Design System (`@vibe/core`)** — official React component library for building monday.com-style applications; covers theming, data display, navigation, layout, inputs, popovers, feedback, and accessibility

## Options considered

| Option | Pros | Cons |
|--------|------|------|
| Tailwind CSS | Rapid utility styling; large community | No components; must build all UI from scratch; achieving monday.com fidelity requires significant custom work |
| CSS Modules | Zero runtime cost; scoped styles; no lock-in | No components; significant custom work for monday.com parity |
| styled-components | Colocated styles; dynamic theming | No components; runtime CSS-in-JS overhead; extra dependency |
| **Vibe Design System** | Ready-made monday.com components; official theming tokens; built-in dark/light mode; accessibility-ready; designed for exactly this use case | Opinionated — Vibe's aesthetic _is_ the constraint; customisation outside Vibe tokens requires care |

## Decision

Use **monday.com Vibe Design System** (`@vibe/core`) as the primary UI and styling layer.

- All colours, typography, spacing, and elevation come from Vibe design tokens.
- Tailwind CSS is **not** used — Vibe's token system replaces it.
- CSS Modules may be used for layout concerns that Vibe does not cover (e.g. the Electron window chrome), but all component-level styling goes through Vibe.
- Dark / light theme via Vibe's `ThemeProvider` — no custom theme implementation.

## Consequences

- Phase 2 scaffolding must install `@vibe/core` and configure its `ThemeProvider` at the app root.
- Wireframes (Phase 1) should annotate regions with the corresponding Vibe component name.
- The open question "Styling approach" in `docs/requirements.md` is resolved — remove from the open questions list.
- If a UI element has no Vibe equivalent, prefer composing from Vibe primitives before writing custom CSS.
- Vibe is a React-only library — this reinforces the React 18 + TypeScript choice and rules out alternatives (Svelte, Vue, etc.) for the renderer.
