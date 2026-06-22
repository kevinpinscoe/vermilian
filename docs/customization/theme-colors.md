# Theme & Colors

Vermilian supports light and dark mode via the monday.com Vibe design system. Theme selection is persisted per-user in Settings → Appearance.

## Switching themes

**Settings → Appearance → Theme** — choose Light or Dark. The change applies immediately without a restart.

## Overriding palette values (source edit)

Fine-grained color overrides are defined in `app/src/renderer/theme.ts`. Two independent palettes let the left navigation rail and the main board area have different text colors.

### CSS custom properties

| Variable | Where it applies |
|---|---|
| `--nav-header-text-color` | Left rail — workspace name, "All tasks" link |
| `--nav-primary-text-color` | Left rail — project names |
| `--nav-secondary-text-color` | Left rail — folder names, issue-count badges |
| `--primary-text-color` | Board — task titles, column headers |
| `--secondary-text-color` | Board — issue IDs, secondary labels |

Edit the `DARK_PALETTE` and `LIGHT_PALETTE` objects in `theme.ts` and restart the app (`pnpm start`).

### Tuning colors live with DevTools

You can find the right color values without editing source by using the Electron DevTools color picker:

1. Run the app (`pnpm start` from `app/`).
2. Open DevTools: **Cmd+Option+I** (macOS) or **Ctrl+Shift+I** (Linux/Windows).
3. In the **Elements** panel, find `<style id="vermilian-theme-overrides">`.
4. Click any hex value — the browser's built-in color picker opens inline.
5. Adjust until satisfied, then copy the final values back into `theme.ts`.

## Board chip colors

Status, Priority, and Category chips use per-board color mappings defined in the `_vermilian-config` YouTrack Knowledge Base Article (so they sync across machines). Override them per board via **Board Settings** (the gear icon in the board toolbar) → **Colors** tab.

Default palettes are defined in `app/src/renderer/features/project-board/colors.ts` and are used as the base when no board-level override exists.
