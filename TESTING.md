# TESTING.md — DnD feature test plan (2026-06-06)

Covers commit `96e9ed8`: row reorder, column reorder/resize, cross-board drag.

Open the Main table view on any project with at least 3 tasks in the same group before starting.

---

## 1 — Row reordering within a group

- [x] Hover a task row — drag handle (⠿) appears at left edge
- [-] Drag a row downward within its group — 2 px blue drop indicator line appears above the target row
- [-] Release — row moves to the new position; order is visually stable (no flash/revert)
- [ ] Reload the app — the manual row order is restored (persisted to config Article)
- [ ] Drag the same row back to its original position — order updates again
- [ ] Drag a row to a *different* group header — field value changes (existing between-group behaviour still works); manual order of the source group is not corrupted
- [ ] With a sort active (e.g. sort by Due Date asc), drag a row — manual order takes over and the sort arrow no longer applies to that group

---

## 2 — Column header reorder

- [-] Hover a non-Summary column header — small ⠿ drag handle appears at left of header text
- [ ] Drag a column header left — vertical blue border indicator appears on the left side of the target column
- [ ] Drag a column header right — vertical blue border indicator appears on the right side of the target column
- [ ] Release — column moves to the new position in both the header row and all data rows
- [ ] Reload — column order is restored
- [ ] Clicking a header (without dragging) still sorts the column (sort still works after reorder feature added)
- [ ] Hidden columns (toggled off via Hide panel) are not affected by header reorder

---

## 3 — Column resize

- [ ] Hover the right edge of any non-Summary column header — cursor changes to `col-resize`
- [ ] Drag the right edge to the right — column expands live while dragging
- [ ] Drag the right edge to the left — column shrinks; minimum width is 40 px (cannot drag below that)
- [ ] Release — width snaps to nearest 8 px (e.g. dragging to ~100 px lands at 96 or 104)
- [ ] Reload — resized width is restored
- [ ] Data cells in that column match the new header width

---

## 4 — Cross-board drag

*Requires at least 2 projects in the same workspace.*

- [ ] Start dragging a task row from the board — all project entries in the left rail show a dashed blue outline (cross-board drop targets highlighted)
- [ ] While still dragging, move the cursor over a **different** project in the left rail — project row highlights on hover
- [ ] While still dragging, move back over the board area — drop indicator returns to normal board behaviour
- [ ] Drop the task on a different project in the left rail — confirmation dialog appears: "Move task to another project" with the correct task ID + summary and target project name
- [ ] Click **Cancel** in the dialog — task stays in the source board; no API call made
- [ ] Drag again and drop on a different project, then click **Move** — task disappears from the current board; success toast appears ("Moved 'KP-XX' to 'Project Name'")
- [ ] Navigate to the destination project — moved task appears there
- [ ] Drop on the **same** project the task already belongs to — no dialog (task stays, nothing happens) *(or dialog appears with same project — note behaviour)*
- [ ] Drag a task but release over an empty area (not a nav project, not a group) — nothing happens; no dialog

---

## 5 — Regression checks

- [ ] Between-group drag (drag row to a different group header in the same board) still works
- [ ] Kanban card drag (drag card between status columns) still works
- [ ] Workspace nav folder/project reorder still works
- [ ] Column show/hide via the Hide panel still works; re-shown columns appear at end
- [ ] Sort by column click still works after column reorder
