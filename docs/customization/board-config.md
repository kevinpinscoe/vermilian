# Board Configuration

Each project board has its own configuration: visible columns, column order and width, group-by field, chip colors, and saved views. Configuration is stored in a `_vermilian-config` YouTrack Knowledge Base Article so it syncs automatically across machines connected to the same YouTrack instance.

## Views

A board can have multiple saved views (tabs shown below the board header). Each view has its own column layout, group-by field, and sort order. Two built-in views ship by default: **Main table** and **Board** (Kanban).

Switch views by clicking the tab. The active view is persisted and restored on next launch.

## Columns (Main table view)

Click **Hide** in the toolbar to open the columns panel. From there you can:

- **Show/hide** individual columns with checkboxes
- **Reorder** columns by dragging the handle

Available columns: Task (summary), Status, Priority, Category, Ticket #, Ticket link, Tracking link, Due Date, Notes, Date entered.

Column visibility and order are per-view and saved automatically.

## Group by

Use the **Group by** dropdown in the toolbar to group tasks by:

- **Status** (default)
- **Priority**
- **Category**

The selection is per-view and persisted.

## Sorting

Click any column header in the Main table view to sort by that column (ascending first, then descending on a second click). An arrow indicator shows the active sort direction. Sort applies within each group; it does not change group order.

## Chip colors

Open **Board Settings** (gear icon in the toolbar) → **Colors** tab to override the default chip colors for Status, Priority, and Category values on a per-board basis. Overrides are layered on top of the workspace default palette defined in the board settings panel.

## Drag and drop

**Within a board (Main table and Kanban):** Drag any task row/card to a different group header to update its group-by field (e.g. drag from "To do" to "In Progress" when grouped by Status). A 2 px blue drop indicator appears on the target group.

**Kanban columns:** Dragging a card between columns updates the Status (or whichever field the board is grouped by) immediately via an optimistic update. The card animates back to its original column if the API call fails.

## Resetting to defaults

**Board Settings → Reset to defaults** removes all per-board overrides and restores the default column set, colors, and group-by selection for that board.
