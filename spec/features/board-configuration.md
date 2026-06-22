# Feature: Board configuration

## Description

Every project board (`project-board.md`) has a set of configuration knobs the user can adjust without leaving the board: which columns are visible and in what order, the colour mapping for each enum chip value, the active `Group by` field, and the list of saved views (Main table, Board, plus any user-defined ones). All of this is per-board and stored in a single YouTrack Knowledge Base Article named `_vermilian-config` so the configuration syncs across machines automatically.

This spec defines the **configuration model and editor UX**. The board itself (rendering, drag-and-drop, inline editing) is specified in `project-board.md`. Workspace-level defaults (default colour palette, default column set for new boards) are specified in `workspace-navigation.md`.

## Acceptance criteria

### Configuration model

- [ ] Each board's configuration is a JSON object with the shape:

  ```jsonc
  {
    "boardId": "youtrack-project-id",
    "views": [
      {
        "id": "main-table",
        "name": "Main table",
        "type": "table",          // "table" | "kanban"
        "groupBy": "Status",       // field name; "None" allowed for table
        "columns": [               // table only; kanban ignores
          { "field": "summary", "width": 320, "visible": true },
          { "field": "ticket", "width": 100, "visible": true },
          // …
        ],
        "sort": { "field": "dueDate", "direction": "asc" }, // optional
        "issueOrderByGroup": {     // group label → array of issue IDs (for manual reorder)
          "To do": ["KP-42", "KP-37", "KP-12"]
        }
      }
    ],
    "activeViewId": "main-table",
    "colors": {                    // per-board overrides on workspace palette
      "Status": { "Working on it": "#00C875", "Pending IT": "#FDAB3D" },
      "Priority": { "Critical": "#E2445C" },
      "Category": { "OPS": "#0073EA" }
    }
  }
  ```

- [ ] The `_vermilian-config` Article contains a single top-level JSON object with `workspaces`, `boards` (keyed by `boardId`), and a `version` integer for future migrations. Each board entry conforms to the shape above.

### Storage and sync

- [x] On app start, the main process fetches the `_vermilian-config` Article via the YouTrack API. If it does not exist, the main process creates it (an empty `{ "version": 1, "workspaces": [], "boards": {} }` payload). *(articleConfig.ts `_load`; caches the article ID in `userData/article-config-id.txt` to avoid re-listing all articles on every startup.)*
- [x] Configuration writes are debounced (default 1.5 s after the last edit). The full document is rewritten on each save (no delta updates in MVP). *(articleConfig.ts `scheduleSave`.)*
- [x] If a write fails (network, 4xx, conflict), a Vibe `Toast` (danger) appears: *"Could not sync configuration — retrying."* Retries follow exponential backoff up to 30 s. *(articleConfig.ts `scheduleRetry`, 2 s → 30 s cap; the local file always holds the latest edit so nothing is lost while retrying. A `"Configuration synced."` positive toast confirms recovery.)*
- [x] If the Article was modified by a different machine since last read (a stale-write check via the Article's `updated` timestamp), the client refetches and **merges**: the remote document is taken as the base and this client's board edits are overlaid on top, then the merged result is written back. A `Toast` (warning) appears: *"Configuration was updated on another machine — changes merged."* **(Implementation note: this supersedes the original MVP "last-write-wins / discard local edits" policy — a non-destructive merge keeps both machines' edits instead of dropping the local one. Workspace structure and any board the remote also changed resolve remote-wins; locally-edited boards resolve local-wins.)**
- [x] Workspace structure (folders, project assignments) lives in the same Article — see `workspace-navigation.md` for that portion of the schema.

### Column editor (`Hide` toolbar button)

- [ ] Clicking `Hide` opens a Vibe right-side `Sidebar` panel labelled `Columns`.
- [ ] The panel lists every available column (defined as a closed set of YouTrack fields the client knows how to render: Summary, Ticket, Ticket link, Tracking link, Priority, Status, Category, Due Date, Notes, Date time entered, `idReadable`).
- [ ] Each row has a Vibe `Checkbox` (visible / hidden) and a drag handle. Reordering in the panel is mirrored on the board.
- [ ] Each row shows the column's current width as an editable number input. Setting `0` is treated as `auto`.
- [ ] Changes apply live to the board behind the panel (debounced save to the Article).
- [ ] A `Reset to workspace default` link at the bottom restores the workspace's default column set for new boards (configured in `workspace-navigation.md`).

### Colour editor (Board settings panel)

- [ ] An overflow-menu item `Board settings…` opens a side panel labelled `Board settings`.
- [ ] The panel has tabs: `Colours`, `Views`, `Danger zone`. (The Columns editor is its own panel reached from `Hide`, not here.)
- [ ] **Colours tab**: lists every enum-valued field that can be chip-rendered on this board (Status, Priority, Category). For each, the panel lists every enum value as a row:
  - Field value (e.g., `Working on it`)
  - A Vibe `Chip` preview rendered in the **current colour for this board** (workspace default OR per-board override)
  - A swatch picker (Vibe palette) for choosing a new colour. Selecting a swatch overrides the workspace default for this board only.
  - A custom-hex input next to the swatches for off-palette colours.
  - A `Reset` link that removes the per-board override and falls back to the workspace default.
- [ ] Per-board overrides apply immediately to the board behind the panel and persist on debounced save.
- [ ] **Views tab**: lists every saved view for this board. Each row: name (editable), type (`table` / `kanban`), `Duplicate`, `Delete`. A `+ New view` button at the bottom creates a new table view (default columns inherited from workspace; user can configure further).
- [ ] **Danger zone tab**: a single `Reset this board to defaults` button. Confirmation dialog. On confirm, deletes this board's entry from the config Article — the board re-derives entirely from the workspace defaults on next render.

### Default new-board behaviour

- [ ] When a project enters the workspace and is rendered for the first time, its board is constructed from the workspace defaults: default column set, default group-by (`Status`), default palette. No entry is written to the config Article until the user makes a configuration change (writes are lazy).

### Migration

- [~] The Article's `version` integer is read on every load. If the loaded version is greater than the client's supported version, the client refuses to cache it and warns the user. **Implemented:** `_load` skips caching and emits a `version-too-high` status; the renderer shows a persistent danger `Toast`: *"This Vermilian install is older than the configuration stored in YouTrack. Update Vermilian."* **Still owed:** the stronger spec behaviour — a blocking Vibe `Banner` that *refuses to render boards* (a render-block flag consulted by board components). Tracked separately. (This path is dormant until a config v2 ships, since the only version is currently `1`.)
- [ ] If the loaded version is **less** than the client's supported version, the client runs the documented migration step(s) in-memory and writes back the upgraded version on the next debounced save.

## Wireframe

See: `docs/design/screen-board-settings.d2`, `docs/design/screen-columns-panel.d2` (to be drawn)

## Open questions

- [ ] Should the user be able to share a board's configuration with another user (export/import JSON snippet) in MVP? Defer.
- [ ] Should the `Article` be human-editable directly in YouTrack, or should the schema be opaque? Recommend human-editable — keep keys readable, document in a comment block at the top of the JSON.
