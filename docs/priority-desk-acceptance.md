# Priority Desk human acceptance checklist

Kevin runs this by hand, one section at a time, under
[VERM-10](https://youtrack.kevininscoe.com/issue/VERM-10). The parent epic is
[VERM-3](https://youtrack.kevininscoe.com/issue/VERM-3). Section A decides whether
[VERM-4](https://youtrack.kevininscoe.com/issue/VERM-4) can close, with Kevin's approval.

Nothing here authorizes a release. [VERM-11](https://youtrack.kevininscoe.com/issue/VERM-11)
stays blocked until acceptance is complete.

## Acceptance build

Kevin designated this build on 2026-11-08. It is the previous build plus the K6 correction
(finding K6 below). It is an acceptance candidate, not a release.

| Item | Value |
| --- | --- |
| Source commit | `7cf54b1cfa550d3e96649f4efd1fbaf77176acb5` (branch `VERM-3`, PR #125, not merged) |
| Application version | 1.2.9 (the version number was not bumped; this is not a release) |
| Build location | `~/.local/share/vermilian-acceptance/7cf54b1-k6/Vermilian-linux-x64/Vermilian` |
| Built | 2026-11-08 21:23 UTC by `pnpm test:live:package`, from a clean tree |
| `app.asar` SHA-256 | `d3127c4447ba7c5e18d6bd1252df251df087a997301b9514bcba86a2861e8e0c` |
| Contains VERM-4 to VERM-9 | Yes. `main` at `f147cf4` plus the harness and the K6 fix |

The copy lives outside every checkout, so packaging or removing a worktree does not replace it. Do
not rebuild into that directory while testing.

**To launch it**, from `~/Projects/public/vermilian`:

```bash
bash private/launch-acceptance-build-7cf54b1.sh
```

The script is gitignored and lives only on the FLDW. It compares `app.asar` with the hash above and
refuses to launch on a mismatch, or while another Vermilian is running. `--verify` runs the check
without launching. If the test environment ever requires a rebuild, stop and record why, because
results from before the rebuild would need re-baselining.

### Previous acceptance build (historical)

Superseded on 2026-11-08 because the live harness confirmed K6 on it (E8, E9 and E10 failed). It is
kept unchanged for comparison, with its own launcher, `private/launch-acceptance-build.sh`.

| Item | Value |
| --- | --- |
| Source commit | `0348099ddf3b34c0b0c51f076210c6ada3190a18` (`main`, 2026-09-29) |
| Build location | `~/Projects/public/vermilian/app/out/Vermilian-linux-x64/Vermilian` |
| Built | 2026-11-04 06:35 EST by `pnpm package` |
| `app.asar` SHA-256 | `44d4ee7e866a6b2ea7c162001fb9966eb3255e94fce37ddc7d957a4355855055` |
| Live harness | 6 of 9 passed. E8, E9, E10 failed (`~/evidence/VERM-10/20261108T205731Z/`) |

## How to record results

- Tests are run one at a time, and each result is **Pass**, **Fail**, or **Blocked**.
- **VERM-10's comments are the authoritative live record.** This file's boxes are updated from them
  by pull request, at the end of each section.
- Put anything odd in **Notes**, even on a pass.
- Classify every finding in [Findings](#findings). Do not mix the three categories.
- Stop after any section. The sections are safe to run on different days.

## Setup

Every step here only touches throwaway `ACC` tasks, the `TEST` project, and open VERM tickets.
The 33 open issues already in `TEST` are fixtures for other work: **do not edit them.**

### S1. Close other copies of Vermilian

The acceptance build shares its settings and credentials with any installed Vermilian. Run only
one at a time.

### S2. Create an Acceptance workspace

This is done by hand in the app: the `Claude_Code` YouTrack user cannot edit the `_vermilian-config`
article (403, 2026-11-04).

1. Open the workspace switcher at the top of the left rail and click **+ New workspace**.
2. Name it `Acceptance` and confirm. It is now the active workspace.
3. Click **+ Add projects** in the rail, tick your **TEST** and **VERM** projects, and save. Both
   should read "unassigned" in the picker. If either names another workspace, stop and note it,
   because adding it would move it out of that workspace.

**Why this is needed:** the Priority Desk only reads projects in the active workspace. Your
`Kevin` workspace holds only the KEVIN project, and VERM is in no workspace at all.

### S3. Check the test tasks

Claude Code created these on 2026-11-04 at Kevin's direction. Check that they appear on the **TEST**
board. Each has Priority `Critical`, which keeps it above the `Normal` fixtures in Choose next, and
Status `To do`.

| Checklist name | Issue | Summary begins |
| --- | --- | --- |
| ACC-1 | `TEST-40` | `ACC-1 alpha` |
| ACC-2 | `TEST-41` | `ACC-2 bravo` |
| ACC-3 | `TEST-42` | `ACC-3 charlie` |
| ACC-4 | `TEST-43` | `ACC-4 delta` |
| ACC-5 | `TEST-44` | `ACC-5 echo` |

### S4. Check the remaining prerequisites

- **Stand-up** in the top bar is enabled. That shows a Claude API key is configured, which
  section D needs.
- The YouTrack web UI is open in a browser. A7 needs it.

### Refreshing

Vermilian has no refresh button. **Restart** means: quit the app and launch it again. Use a restart
whenever a test asks you to pick up a change made outside Vermilian.

---

## A. Foundation (VERM-4)

### A1. Focus from the task board

- **Testing:** the star toggle on a table row.
- **Go to:** TEST project → **Main table** tab → the `ACC-1` row.
- **Do:** click the star. Click it again. Click it a third time.
- **Expect:** filled star with a `–` badge, then outline with no badge, then filled with `–` again.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### A2. Focus from a Kanban card

- **Testing:** the same control on a card.
- **Go to:** TEST project → **Kanban** tab → the `ACC-2` card.
- **Do:** click the star.
- **Expect:** filled star with a `–` badge. The card does not open.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### A3. Focus from task details

- **Testing:** the same control in the detail panel.
- **Go to:** click the `ACC-3` task to open its details.
- **Do:** click the star beside the issue ID at the top of the panel.
- **Expect:** filled star with a `–` badge.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### A4. Rank values 1 to 3

- **Testing:** assigning a free rank.
- **Go to:** TEST project → **Main table**.
- **Do:** click the `–` badge on `ACC-1` and choose **1**. Give `ACC-2` rank **2** and `ACC-3`
  rank **3**.
- **Expect:** the menu offers only 1, 2 and 3. Each badge shows its number, with no dialog.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### A5. An occupied rank asks first

- **Testing:** no silent replacement, including a fourth rank while all three are full.
- **Go to:** TEST project → **Main table**.
- **Do:** star `ACC-4`, click its `–` badge, choose **1**. In the dialog click **Keep** (the button
  names `ACC-1`'s issue ID).
- **Expect:** the dialog says "Focus rank 1 is already taken" and names `ACC-1`. After **Keep**,
  `ACC-1` is still 1 and `ACC-4` is still `–`.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### A6. Moving a rank is your decision

- **Testing:** the other answer to the same dialog.
- **Go to:** TEST project → **Main table**.
- **Do:** choose **1** on `ACC-4` again and click **Move rank here**. Then choose **1** on `ACC-1`
  and click **Move rank here** to put it back.
- **Expect:** each time the old holder shows `–` and stays starred. It ends with `ACC-1` at 1 and
  `ACC-4` at `–`.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### A7. A duplicate rank is detected

- **Testing:** a duplicate created outside Vermilian.
- **Go to:** the YouTrack web UI → `ACC-4`.
- **Do:** set **Focus rank** to `2` and save. Restart Vermilian, then open **Priority Desk**.
- **Expect:** a warning reads "Focus rank 2 is held by 2 issues". The Next slot reads "2 issues share
  Focus rank 2 — resolve above." Vermilian has not picked a winner.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### A8. You resolve the duplicate

- **Testing:** human-controlled repair.
- **Go to:** the warning on **Priority Desk**.
- **Do:** click **Keep** … **at rank 2** for `ACC-2`.
- **Expect:** the warning disappears and `ACC-2` is on the Next card. `ACC-4` shows `–`, still starred,
  on the TEST board.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### A9. Why now editing and display

- **Testing:** the reason field.
- **Go to:** open `ACC-1`'s details and find the **Why now** field.
- **Do:** type `Acceptance reason one` and click away. Then open **Priority Desk**.
- **Expect:** the field keeps the text, and the Now card shows it in quotation marks.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:** The table column for Why now is hidden by default; that is by design.

### A10. Removing Focus keeps the reason

- **Testing:** clearing Focus clears the rank but not Why now.
- **Go to:** the TEST board → `ACC-1`.
- **Do:** click the star off. Open `ACC-1`'s details. Then star it again and give it rank **1**.
- **Expect:** with the star off, the badge is gone and **Why now** still reads
  `Acceptance reason one`. Rank 1 goes back on without a dialog.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### A11. Everything survives a restart

- **Testing:** persistence in YouTrack.
- **Go to:** restart Vermilian, then open **Priority Desk**.
- **Do:** compare the cards with `ACC-1` in the YouTrack web UI.
- **Expect:** Now is `ACC-1` with its reason, Next is `ACC-2`, Then is `ACC-3`. The web UI shows
  `Focus` = Yes, `Focus rank` = 1 and the same `Why now` on `ACC-1`.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

**Section A outcome:** [ ] All pass, VERM-4 can be proposed for closure  [ ] Findings recorded

---

## B. Priority Desk (VERM-5 and VERM-6)

Start state: `ACC-1` rank 1, `ACC-2` rank 2, `ACC-3` rank 3, `ACC-4` starred with no rank.

### B1. Now, Next and Then cards

- **Testing:** the desk's position, default mode and rank order.
- **Go to:** the left rail.
- **Do:** check that **Priority Desk** sits above **All tasks**, and click it.
- **Expect:** **Now** mode is selected. Now is `ACC-1`, Next is `ACC-2`, Then is `ACC-3`.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### B2. What a card shows

- **Testing:** card contents.
- **Go to:** **Priority Desk**, Now mode.
- **Do:** read the Now and Next cards.
- **Expect:** issue ID, summary, project, a `Critical` chip, and the star with its rank. The Now card
  has its reason. The Next card reads "No reason given yet." The Priority is still `Critical`.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### B3. Blocker warning on a card

- **Testing:** `docs/requirements.md` asks for a blocker/dependency warning on Now-mode cards.
- **Go to:** open `ACC-2`'s details.
- **Do:** set **Status** to `BLOCKED`, then look at its Next card. Leave it `BLOCKED` for section E.
- **Expect (per the requirement):** a visible warning on the card.
- **Heads-up:** finding K1 says this was not built, so a **Fail** is likely. Please confirm it.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### B4. Empty slots are allowed

- **Testing:** nothing fills a slot on its own.
- **Go to:** the Then card's rank badge.
- **Do:** click the badge and choose **Clear rank**.
- **Expect:** Then reads "Empty is fine" and "Nothing forces this slot to fill." Nothing moves in.
  `ACC-3` stays starred.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### B5. Choose next candidates

- **Testing:** the bounded list.
- **Go to:** **Priority Desk** → **Choose next**.
- **Do:** count the cards and read the IDs. Click a Status pill, then **All**.
- **Expect:** at most seven cards, and the button count matches. `ACC-3`, `ACC-4` and `ACC-5` are
  shown ahead of the `Normal` fixtures, with `ACC-3` and `ACC-4` starred. `ACC-1` and `ACC-2` are
  absent because they are ranked. The pills narrow the list and **All** restores it.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### B6. Moving an issue into focus

- **Testing:** a candidate becomes a card.
- **Go to:** the `ACC-3` candidate card.
- **Do:** click its `–` badge and choose **3**. Switch to **Now**.
- **Expect:** `ACC-3` leaves the grid and appears on the Then card.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### B7. Not this week

- **Testing:** dismissal.
- **Go to:** **Choose next** → the `ACC-5` card.
- **Do:** click **Not this week**. Then restart Vermilian and return to **Choose next**.
- **Expect:** the card leaves at once. Another eligible issue may take its place, so the count
  falls only if fewer than seven eligible candidates remain. The count is the cards on screen,
  capped at seven (decided 2026-11-08). `ACC-5` is still gone after the restart. Its Priority is
  unchanged in the web UI.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:** There is no undo or list of dismissed issues (finding K5). Leave `ACC-5` open for B8.

### B8. Not this week expires

- **Testing:** the dismissal lasts only through the local Monday-to-Sunday week.
- **Go to:** **Choose next**, on or after **Monday 2026-11-09** if the dismissal was made this week.
- **Do:** look for `ACC-5`.
- **Expect:** it is back with no action from you.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:** The automated suite covers this logic; this is the live confirmation.

### B9. Start focus uses the timer

- **Testing:** the Now card's timer action.
- **Go to:** **Now** → the `ACC-1` card.
- **Do:** click **Start focus**, confirm the countdown, wait a moment, click **Stop & log**.
- **Expect:** a focus overlay names `ACC-1` and counts down. Stopping shows "Logged N min to …" and
  the overlay closes.
- **Heads-up:** finding K2. Time tracking is disabled on `TEST`, so the log may be refused. You would
  then see "Failed to log worklog" with the overlay still open. To get out, close the window and
  choose to stop and quit. The next launch may offer to recover that timer. Record exactly what you
  see.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### B10. The desk survives a restart

- **Testing:** persistence.
- **Go to:** restart Vermilian → **Priority Desk**.
- **Do:** compare the cards with where you left them.
- **Expect:** the same three cards, with `ACC-3` in Then.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

---

## C. Epic context (VERM-7)

These use the real open children of VERM-3. Setting Focus on them is reversible and is undone in
[Cleanup](#cleanup).

### C1. Epic filter

- **Testing:** native relationships drive the filter.
- **Go to:** **Priority Desk** → **Choose next**.
- **Do:** click the **VERM-3** pill. Then click **All epics**.
- **Expect:** with VERM-3 selected, only `VERM-4`, `VERM-10` and `VERM-11` show. The epic `VERM-3`
  itself never appears as a card, and the Done children do not. **All epics** restores the list.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### C2. Parent epic on a card

- **Testing:** VERM-3 is shown as the parent of VERM-4, following the link correction of 2026-11-04.
- **Go to:** **Now**. Clear the rank on the Then card. Then go to **Choose next**, star `VERM-4`, and
  give it rank **3**.
- **Do:** switch to **Now** and read the Then card.
- **Expect:** a line reads "Epic: VERM-3" followed by the epic's summary.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### C3. A task with no epic

- **Testing:** no invented epic.
- **Go to:** **Now** → the `ACC-1` card.
- **Do:** read the card.
- **Expect:** no Epic line and no Outcome line.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### C4. Master Plan outcome

- **Testing:** the epic resolves to its outcome in the `_vermilian-master-plan` article.
- **Go to:** **Now** → the `VERM-4` card.
- **Do:** read the card and look above the cards for a warning banner.
- **Expect:** "Outcome: Build the Priority Desk". No Master Plan warning banner.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### C5. Vermilian agrees with YouTrack

- **Testing:** the link matches on both sides.
- **Go to:** `VERM-4` in the YouTrack web UI.
- **Do:** read its links.
- **Expect:** `VERM-4` is a **subtask of** `VERM-3`, the same parent as card C2.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

---

## D. AI recommendations (VERM-8)

**Before starting, know that:**

- Each **Ask for recommendation** is a paid Claude call. It sends the summaries, descriptions and
  links of the shown candidates to Anthropic, along with the selected Master Plan outcome. With the
  VERM-3 filter on, those are only `VERM-4`, `VERM-10` and `VERM-11`.
- Each of the three choices adds one audit comment to the top-ranked issue. Those comments stay on
  those real tickets.

**Setup:** on **Now**, click each rank badge and choose **Clear rank**, or use the star on `VERM-4`,
until all three slots are empty. On **Choose next**, click the **VERM-3** pill.

### D1. Outcome must be chosen first

- **Testing:** the button stays disabled without an outcome.
- **Go to:** **Choose next** with the VERM-3 filter on.
- **Do:** hover over **Ask for recommendation**, then click the **Build the Priority Desk** pill.
- **Expect:** disabled with the hint "Select a Master Plan outcome first." It enables once the pill is
  selected.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### D2. Understandable reasoning, and nothing changes

- **Testing:** the proposal only proposes.
- **Go to:** the same screen.
- **Do:** click **Ask for recommendation**. Read the panel. Switch to **Now** and back **without**
  clicking any of the three choices. If switching closes the panel, ask again in D4.
- **Expect:** a Ranked list, plus Alternates if any. Each item has Outcome, Dependencies, Urgency,
  Effort and Risk lines that make sense to you. **No score.** The Now slots are still empty.
- **If it asks a question instead:** "Need more to go on" with no choice buttons is valid. Note it,
  confirm no comment was added, and ask again.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### D3. Dependency readiness

- **Testing:** dependencies are considered. `VERM-11` depends on `VERM-10`, which is not finished.
- **Go to:** the **Dependencies** lines in the panel.
- **Do:** read the `VERM-11` entry.
- **Expect:** it says `VERM-11` is waiting on `VERM-10`, and it is not ranked ahead of `VERM-10`.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### D4. Keep my order

- **Testing:** the no-change choice.
- **Go to:** the panel. Ask again if it closed.
- **Do:** click **Keep my order**.
- **Expect:** the panel closes. All three Now slots stay empty. The top-ranked issue gains one audit
  comment in the web UI.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### D5. Star only

- **Testing:** stars without ranks.
- **Go to:** **Ask for recommendation** again.
- **Do:** click **Star only**. Check **Now**, then the stars in **Choose next**. Afterwards click those
  stars off.
- **Expect:** the top three ranked issues are starred, none has a rank, and the Now slots stay empty.
  One new audit comment.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### D6. Apply to desk respects an occupied slot

- **Testing:** it never displaces your work.
- **Go to:** in the Acceptance workspace, set `ACC-1` to rank **1** so a slot is taken. Return to
  **Choose next**, keep the VERM-3 pill on, and ask again.
- **Do:** click **Apply to desk**.
- **Expect:** "Couldn't apply" names rank 1 and `ACC-1`. `ACC-1` keeps rank 1 and nothing else changes.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### D7. Apply to desk with your approval

- **Testing:** the only choice that assigns ranks.
- **Go to:** clear `ACC-1`'s rank and ask again.
- **Do:** before clicking, check that **Now** is empty. Ask again if needed, then click **Apply to
  desk** and open **Now**.
- **Expect:** the proposal's top three become Now, Next and Then, only after your click. One new audit
  comment.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

---

## E. Daily Review (VERM-9)

**Setup:**

1. Clear the VERM issues' stars so they return to unfocused.
2. Set `ACC-1` to rank **1** and `ACC-2` to rank **2**. `ACC-2` is still `BLOCKED` from B3.
3. Leave `ACC-4` starred with no rank.
4. Click `ACC-3`'s star off, then set its **Status** to `Done`.

### E1. Opens straight to its content

- **Testing:** no form and no AI call.
- **Go to:** the top bar.
- **Do:** click **Daily Review**.
- **Expect:** a window titled "Daily Review" with today's date, with no scope or window step first.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### E2. Current focus slots

- **Testing:** agreement with the desk.
- **Go to:** the "Now / Next / Then" section.
- **Do:** read it.
- **Expect:** `ACC-1`, then `ACC-2`, then "Empty".
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### E3. Blocked focused work

- **Testing:** ranked and blocked.
- **Go to:** the "Blocked focused work" section.
- **Do:** read it.
- **Expect:** `ACC-2` only.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:** A blocked issue that is starred but unranked shows under Needs attention instead; that
  is what VERM-9 specified.

### E4. Focused but unranked

- **Testing:** decisions left half made.
- **Go to:** the "Needs attention" section.
- **Do:** read it.
- **Expect:** `ACC-4`. Ranked issues are absent.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### E5. Recently completed

- **Testing:** the fixed 48-hour window.
- **Go to:** the "Recently completed" section.
- **Do:** read it.
- **Expect:** `ACC-3` is listed along with anything else finished in this workspace in the last 48
  hours. These rows are not clickable, by design.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### E6. Agent-work placeholders

- **Testing:** the documented limitation: Vermilian has no agent-execution data yet.
- **Go to:** "Agent work awaiting review", "Agent work needing input" and "Failed agent work".
- **Do:** read each.
- **Expect:** each reads "Agent-execution tracking isn't set up yet, so there's nothing to show here."
  No real issues are listed as agent work.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### E7. Read-only, with a way into the work

- **Testing:** the review changes nothing.
- **Go to:** "Now / Next / Then".
- **Do:** click `ACC-1`.
- **Expect:** the window closes and `ACC-1`'s details open. No field changed.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### E8. A finished issue leaves focus

- **Testing:** what happens to a ranked issue once it is Done.
- **Go to:** open `ACC-1`'s details.
- **Do:** set **Status** to `Done`. Restart Vermilian, then open **Priority Desk** and **Daily Review**.
- **Expect:** `ACC-1` is gone from Now/Next/Then, *Blocked focused work* and *Needs attention*. It
  may appear under *Recently completed*. In the web UI its `Focus` and `Focus rank` are unchanged:
  Vermilian does not clear them (decided 2026-11-08).
- **Live harness:** failed on the previous build (finding K6); passed on this build
  (`~/evidence/VERM-10/20261108T212524Z/`). Your manual result is still needed.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:** Leave `ACC-1` Done for E9 and E10.

### E9. A finished issue's rank is free

- **Testing:** a Done issue does not reserve its rank.
- **Go to:** **Priority Desk** → **Choose next**, after E8.
- **Do:** give `ACC-2` rank **1**, the rank `ACC-1` kept when it was finished.
- **Expect:** `ACC-2` takes the Now slot at once. No "Focus rank 1 is already taken" question and no
  repair banner appear.
- **Live harness:** failed on the previous build; passed on this build. Your manual result is still
  needed.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

### E10. Reopening a ranked issue that collides

- **Testing:** a reopened issue's retained rank collides with an active one.
- **Go to:** `ACC-1` in the web UI, after E9.
- **Do:** set its Status back to `To do`. Restart Vermilian and open **Priority Desk**.
- **Expect:** the repair banner names `ACC-1` and `ACC-2` at rank 1, and neither has been moved or
  cleared. Choose which keeps rank 1; the other stays focused, unranked.
- **Live harness:** failed on the previous build; passed on this build. Your manual result is still
  needed.
- **Result:** [ ] Pass  [ ] Fail  [ ] Not tested
- **Notes:**

---

## F. Project Runway usability assessment

**This assesses your intended workflow. These are not acceptance criteria**, and a "No" here does not
fail VERM-10. Do this with your own real tasks in mind. Record gaps as usability problems or future
enhancements. Nothing here gets built during this exercise.

| # | Can I… | Yes / Partly / No | What is missing |
| --- | --- | --- | --- |
| F1 | Open Vermilian and immediately identify my primary focus? | | |
| F2 | See my next two commitments without searching a long task list? | | |
| F3 | Distinguish actionable work from blocked work? | | |
| F4 | Distinguish intentionally deferred work from blocked work? | | |
| F5 | Understand why each focused issue was selected? | | |
| F6 | Resume interrupted work without reconstructing the previous session? | | |
| F7 | Keep control of priorities, with no AI reordering on its own? | | |

**Could Vermilian replace the Markdown task lists as the daily Project Runway?**
[ ] Yes  [ ] Yes, after the items below  [ ] Not yet

Two things to weigh:

- From the code, the app starts on the workspace's All tasks view, with the desk one click away. It
  is not the first screen you see, which bears on F1.
- The desk only covers projects in the active workspace (see S2), which bears on all of them. Your
  `Kevin` workspace holds only the KEVIN project today.

---

## Cleanup

Do this only after Kevin has completed acceptance and approved cleanup.

1. Delete the five `ACC` tasks from their detail panels, or leave them Done.
2. Clear Focus and rank on `VERM-4`, `VERM-10` and `VERM-11`. The audit comments stay on the tickets.
3. Switch back to your `Kevin` workspace.
4. Use **Manage workspaces…** to delete `Acceptance`. TEST and VERM become unassigned again, unless
   you decide VERM belongs in `Kevin`.

---

## Findings

Findings K1 to K6 came from preparation, before any human test. **The rest are yours to add.**

### Acceptance defects

Existing documented functionality does not behave as specified. Give the behavior, steps, expected
and observed result.

**K1. Now cards have no blocker or dependency warning (candidate; confirm in B3).**

- **Behavior:** `docs/requirements.md` § Priority Desk, "Now mode", lists "a blocker/dependency warning"
  on each card.
- **Steps:** set a ranked issue to `BLOCKED` and view its card.
- **Expected:** a visible warning.
- **Observed in the code:** `PriorityDesk.tsx` renders none. VERM-5's scope list left it out, so it
  was never built. Blocked focused work does appear in Daily Review (E3).

**K2. Stop & log may fail where time tracking is disabled (unverified; confirm in B9).**

- **Behavior:** Start focus uses the existing timer, and stopping posts a YouTrack worklog.
- **Steps:** start and stop a focus timer on a `TEST` issue.
- **Expected:** the worklog is logged and the overlay closes.
- **Observed in the code:** `enabled: false` was read live from the time-tracking settings of `TEST`
  and `VERM` on 2026-11-04. If YouTrack refuses the write, `AppShell.tsx` keeps the timer and overlay
  running and shows a five-second error. This has not been run against the live instance.

**K6. Done issues kept their focus slot. Fixed in the acceptance build (`7cf54b1`).**

- **Behavior:** the desk and Daily Review describe their data as unresolved issues, but no requirement
  states what happens to a ranked issue when it closes.
- **Steps:** rank an issue, set it to `Done`, and restart.
- **Expected (decided 2026-11-08):** it leaves Now/Next/Then, *Blocked focused work* and *Needs
  attention*, and stays eligible for *Recently completed*. Its stored `Focus` and `Focus rank` are
  not cleared, but it reserves no rank. A collision after reopening is shown for repair (E9, E10).
- **Observed in the code:** `getIssues` ignores its `includeResolved` argument and returns resolved
  issues (the live `VERM` response includes the Done tickets). `useWorkspaceFocusRankHolders` and
  `deriveNeedsAttention` do not filter them out. The automated suite has no test for it. Choose next
  excludes only `Done`, as the requirement words it, so `Wont do` issues remain eligible.
- **Confirmed (2026-11-08):** the live harness failed E8, E9 and E10 on the previous build
  (`~/evidence/VERM-10/20261108T205731Z/`). That evidence is kept.
- **Fixed in `7cf54b1`:** in `project-board/focus.ts` and `daily-review/boardData.ts`, an issue that is
  resolved or `Done` holds no slot, reserves no rank, and is left out of *Blocked focused work* and
  *Needs attention*. Its stored `Focus` and `Focus rank` are not touched. A reopened issue counts
  again, so a collision goes to the repair banner. `getIssues` and the boards are unchanged. Unit
  tests named E8 to E10 cover it.
- **Verified:** E8, E9 and E10 passed live on the acceptance build, and so did all nine live cases
  (`~/evidence/VERM-10/20261108T212524Z/`).

Add others here:

### Resolved decisions

**K3. Rank controls are the intended interaction, not drag-to-slot.** Kevin decided on 2026-11-04
that reliable, explicit priority selection matters more than drag-and-drop. It is not a defect. The
requirements were corrected: see [ADR-0009](adr/0009-priority-desk-rank-controls.md).

### Usability problems

Works technically, but is hard to use or understand.

- **K4.** There is no refresh control. Queries do not refetch on window focus, so a change made
  outside Vermilian can stay invisible until a restart (A7).
- **K5.** "Not this week" has no undo and no list of what is dismissed. Dismissed work simply
  vanishes until the following Monday (B7, F4).

Add others here:

### Future enhancements

A Project Runway capability that was not part of the original requirements. Nothing here is filed or
built automatically.

Add here:

---

## Verification baseline

Automated results for the build above, recorded 2026-11-04 on the FLDW with node 24.15.0 and pnpm
11.5.0. All commands ran from `app/`, in order.

| Step | Command | Result |
| --- | --- | --- |
| Install | `pnpm install --frozen-lockfile` | exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0 |
| Unit tests | `pnpm test` | exit 0, 336 passed in 23 files |
| Packaging | `pnpm package` | exit 0 |
| End-to-end | `pnpm test:e2e` | exit 0, 158 passed, 2 skipped |

The two skipped tests are existing `test.fixme` entries for row drag-and-drop in `e2e/dnd.spec.ts`,
and they have nothing to do with the Priority Desk.

**What these results do not show:** the e2e suite runs against an in-memory fake YouTrack and a fake
Claude. Nothing in it exercises the live instance or a real Claude call. That is what this checklist
is for.

The table above is for the previous build. For the acceptance build (`7cf54b1`, 2026-11-08):
`pnpm test` 345 passed, `pnpm typecheck` clean, `pnpm lint` 0 errors, `pnpm test:e2e` 160 passed and
2 skipped (the same two), and CI passed on PR #125.

### Live acceptance harness

Supporting evidence only (`app/e2e-live/HARNESS.md`). VERM-10's comments remain the record, and the
harness does not replace any human test here. It ran as the dedicated `vermilian-harness` account on
the disposable `VLH` and `VLHX` projects, with the approved GLBL Observer exception.

| Build | Result | Evidence |
| --- | --- | --- |
| Previous (`0348099`, `44d4ee7e…`) | 6 of 9 passed. E8, E9, E10 failed (K6) | `~/evidence/VERM-10/20261108T205731Z/` |
| Acceptance (`7cf54b1`, `d3127c44…`) | E8, E9, E10 passed | `~/evidence/VERM-10/20261108T212501Z/` |
| Acceptance (`7cf54b1`, `d3127c44…`) | All 9 passed: A5/A6, A7/A8, A11, B9 success, B9 rejection, E8, E9, E10, HARNESS | `~/evidence/VERM-10/20261108T212524Z/` |

A1 to A4 are not automated and remain **pending** Kevin's manual run.

### Implementation against requirements

Comparing the source and tests with `docs/requirements.md`, ADR-0007 and each ticket's scope:

| Ticket | Scope | Source and tests | Gaps |
| --- | --- | --- | --- |
| VERM-4 | Focus, rank and Why now fields, three edit surfaces, rank invariant and repair | Present. `e2e/focus-toggle.spec.ts`. Fields read live on all 40 active projects | None found |
| VERM-5 | Rail entry, Now mode, Start focus, repair state | Present. `e2e/priority-desk.spec.ts` | K1, K2, K6 |
| VERM-6 | Choose next, seven-card cap, ordering, Status filter, Not this week | Present. `e2e/priority-desk-choose-next.spec.ts` | K5 |
| VERM-7 | Parent epic, Epic filter, Master Plan display | Present. `e2e/priority-desk-master-plan.spec.ts` | None found |
| VERM-8 | Bounded recommendation, evidence, three choices, audit comment | Present. `e2e/priority-desk-recommendation.spec.ts` | None found |
| VERM-9 | Deterministic review, placeholders | Present. `e2e/daily-review.spec.ts` | K6 |

### VERM-3 and VERM-4 relationship

Corrected in YouTrack on 2026-11-04 and read back from both sides: `VERM-3` is **parent for** `VERM-4`,
and `VERM-4` is **subtask of** `VERM-3`. VERM-4's "is required for VERM-5" link was left alone.

Vermilian's own parser (`getIssues`) was run against the live `VERM` response: it resolves `VERM-4`'s
parent epic to `VERM-3`, and `VERM-3` to no parent. The parser ignores link direction and keys off the
linked issue's `Epic` type, so the old inverted link never changed what it displayed. C2 confirms the
result on screen.
