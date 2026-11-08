# Live acceptance harness (pilot)

Automates a bounded set of the Priority Desk checklist cases
(`docs/priority-desk-acceptance.md`) against a **real YouTrack server** and the
**real packaged application**, with evidence. It complements the deterministic
fake-YouTrack suite in `app/e2e/`; it does not replace it, and it does not replace
Kevin's human acceptance.

**Generated reports are supporting evidence only.** VERM-10's comments remain the
authoritative acceptance record. Nothing the harness produces closes a ticket,
approves acceptance, unblocks VERM-11, merges, or releases.

Commands are in the repository `RUNBOOK.md` → *Step 6 — Live acceptance harness*.

## What it covers

| Checklist ID | File | Verifies |
| --- | --- | --- |
| A5/A6 | `a5-a6-occupied-rank.live.ts` | The occupied-rank dialog names the holder. Keep changes neither issue. Move transfers the rank and keeps both stars. The transfer back works. Each step is checked on screen and on the server. |
| A7/A8 | `a7-a8-duplicate-rank.live.ts` | An independent API client creates a duplicate rank. After a full restart the warning shows and no winner is chosen, so both still hold the rank on the server. The UI repair produces the right persisted state. |
| A11 | `a11-persistence.live.ts` | Star, rank and Why now set through the UI reach YouTrack, then survive a complete process exit and a relaunch on the same profile. |
| B9 | `b9-focus-worklog.live.ts` | **Success:** the reported worklog exists on the server with the reported minutes and the app identity as author. **Rejection:** there is no false success and no work item. The recovery path is recorded, not asserted. |
| E8 | `e8-done-ranked.live.ts` | A ranked issue set to Done in the UI leaves the desk, Daily Review's focus slots, *Blocked focused work* and *Needs attention* after a restart, and its stored Focus and rank are unchanged. |
| E9 | `e9-e10-completed-rank.live.ts` | A Done issue does not reserve its retained rank: giving that rank to an active issue raises no conflict and no repair state, and the Done issue's stored values are untouched. |
| E10 | `e9-e10-completed-rank.live.ts` | Reopening it (by another client) makes the retained rank collide. After a restart the repair state names both, nothing changes on the server until the user chooses, and the choice persists. |
| HARNESS | `harness-selftest.live.ts` | The binary launches on an isolated empty profile with the fake services off, and the trace, screenshots and log are captured. It needs no server. |

Test titles start with the checklist ID, and the report keys every row by it.

## Design rules

- **Never the fake services.** The launcher strips every `VERMILIAN_E2E*` variable,
  then asks the running main process to confirm that none reached it.
- **Two identities.**
  - The *application identity* is the dedicated harness account the app runs as.
  - The *verifier* is an independent client that prepares fixtures and checks server state. It
    goes through `parzival exec … youtrack-claude-code`, so its token never leaves parzival's
    curl config.
  - Every interaction under test is a UI click. Neither client drives the application through
    IPC.
- **Isolation is proven, not assumed.** Vermilian finds its server-side
  configuration by the title `_vermilian-config`. If it finds none, it creates one in the
  VERM project, so a separate local profile isolates nothing on the server. The preflight
  therefore requires all of these:
  - The application identity can see no `_vermilian-config` article, and holds no
    `CREATE_ARTICLE` in VERM. The app then runs on its local profile alone, and Kevin's
    configuration is out of its reach. A refused write (HTTP 403) is not accepted as
    isolation.
  - Both harness projects are absent from every workspace in Kevin's configuration, so harness
    ranks never appear on his desk.
  - The application identity is a dedicated login. It is never Kevin's and never the
    verifier's.
- **Disposable fixtures only.**
  - **Identification:** a fixture's summary starts with `[VLH]` and its description carries the
    harness marker. An issue with only one of the two stops the run.
  - **Stray Focus:** any non-fixture issue holding Focus in a harness project stops the run.
    The harness never edits it.
  - **Reset:** every scenario resets all fixtures in both projects before it starts, so no
    scenario depends on another.
- **Serial, no retries.** One worker, `retries: 0`. Each run writes a new timestamped
  directory, so a later diagnostic rerun never hides the first failure.
- **Results are classified, never softened.**

  | Status | Meaning |
  | --- | --- |
  | **Pass** | Every assertion held. |
  | **Fail** | A failed `expect` is a candidate application defect. Any other error is reported as *unclassified, needs review*. |
  | **Blocked** | A missing prerequisite, or a harness failure. Not evidence about the application. |
  | **Not run** | The test was skipped or interrupted. |

  A Blocked scenario fails the run. Nothing is skipped silently.
- **Evidence is captured on the Electron app itself.** Playwright's `use: { trace, screenshot }`
  page options do not reach windows of a manually launched Electron app. `harness/app.ts`
  therefore starts tracing on the `ElectronApplication`'s own context and captures:
  - a trace and a screenshot for every launch;
  - renderer errors and warnings, and the main process's stdout and stderr;
  - the app's own state files.

  Server values are attached before and after each mutation, with credentials redacted.
- **Build identity in every run.** The manifest records:
  - the build kind: **pinned acceptance build** (by `app.asar` hash) or **development build**;
  - the source commit, with how it was established;
  - the executable path and the `app.asar` SHA-256;
  - the harness commit and whether its tree was dirty;
  - the OS, time zone, launch flags, and the fake-service variables that were removed.

## Settings

The harness reads only environment variables. None of them defaults to a real account or
project.

| Variable | Required | Meaning |
| --- | --- | --- |
| `VERMILIAN_LIVE_YOUTRACK_URL` | yes | YouTrack URL the app is configured with |
| `VERMILIAN_LIVE_APP_LOGIN` | yes | Login the app's token must resolve to: the dedicated harness account |
| `VERMILIAN_LIVE_APP_TOKEN_FILE` | one of these two | File holding that account's token, such as the temporary file a broker renders for the life of the run. The app reads it through its token-file setting |
| `VERMILIAN_LIVE_APP_TOKEN_COMMAND` | one of these two | Shell command printing that account's token. The app and the preflight both run it |
| `VERMILIAN_LIVE_PROJECT` | yes | Harness project short name, with time tracking **enabled** |
| `VERMILIAN_LIVE_REJECT_PROJECT` | yes | Second harness project, with time tracking **disabled** (B9 rejection) |
| `VERMILIAN_LIVE_EXECUTABLE` | no | Build under test. Default: this checkout's `out/` |
| `VERMILIAN_LIVE_EVIDENCE_DIR` | no | Evidence root. Default `app/live-results/` (gitignored). On k-fed hosts use `~/evidence/VERM-10` |
| `VERMILIAN_LIVE_VERIFIER_URL` | no | Verifier base URL. Default `http://127.0.0.1:9000` |
| `VERMILIAN_LIVE_VERIFIER_AS`, `VERMILIAN_LIVE_VERIFIER_PROFILE` | no | parzival identity and profile. Default `ai` / `youtrack-claude-code` |
| `VERMILIAN_LIVE_FORBIDDEN_LOGINS` | no | Logins the app identity must not be. Default `admin,Claude_Code` |
| `VERMILIAN_LIVE_OPEN_STATE`, `VERMILIAN_LIVE_DONE_STATE` | no | Status names. Default `To do` / `Done` |
| `VERMILIAN_LIVE_ACCEPT_GLBL_OBSERVER` | no | `1` accepts the inherited GLBL Observer role (see *Isolation rule*). Only with Kevin's approval. Default: strict isolation |

## Server setup

The live scenarios need this setup, so that they never touch Kevin's workspace, the TEST fixtures
or real VERM issues. Without it, every live scenario reports **Blocked** with the failing preflight
check.

1. **A dedicated YouTrack account** for the application identity (`vermilian-harness`). It can:
   - read and update issues in the two harness projects, and add work items in the first;
   - **not** read VERM's articles, so it cannot see `_vermilian-config`;
   - **not** create articles in VERM.

   The preflight enforces this as an allowlist over the account's own permission cache (see
   *Isolation rule*), and also checks that the account can read no VERM issue and no article
   outside the harness projects.
2. **A route for that account's token to the application.** Vermilian takes a token only as a raw
   value from a command, a file or its keyring. A broker profile renders it into a temporary file
   named by `VERMILIAN_LIVE_APP_TOKEN_FILE`, and the run happens inside that broker command. The
   verifier's own credential is never used for this.
3. **Two harness projects**, in no workspace, each with `Focus`, `Focus rank`, `Why now` and a
   `Status` with `To do` and `Done`:
   - `VLH`, with time tracking enabled;
   - `VLHX`, with time tracking disabled.

   `Status` must use the same value set as TEST. A new YouTrack project attaches `Status`
   automatically with the server's default value set, which has neither `To do` nor `Done`.
4. **Verifier permissions** for `Claude_Code` on both projects: read, create and update issues,
   and read work items.

Kevin provisions all of this with an administrator script kept in his private YouTrack
administration repository, not here. The script:

- refuses to write anything in dry-run mode;
- stops if a new account would inherit any role from an auto-join group;
- changes an existing VLH or VLHX project only when its name and description identify it;
- never widens a team on a rerun.

The broker rule for the harness token lets only the AI session use it, through `exec`. Neither
`get` nor `mount` is allowed, and the token has no human or service identity.

B9's success case writes a real one-minute work item to a disposable `[VLH]` fixture as the
harness account. Kevin approved that on 2026-11-08.

## Isolation rule

**Strict, the original design and the default.** The application identity holds permissions
only in the two harness projects, and nothing global.

**GLBL exception: opt-in, approved by Kevin on 2026-11-08.** Every new Hub account joins
*Registered Users*, which holds *Observer* in Hub's Global project (GLBL). A role in GLBL applies
in every project. Kevin's administrator dry run confirmed that Observer grants exactly three Hub
permissions. With `VERMILIAN_LIVE_ACCEPT_GLBL_OBSERVER=1`, the preflight accepts exactly those,
held globally:

- `user-read-basic` and `user-read`: read other users' profiles;
- `profile-updateSelf`: edit the account's own profile, and no other user, group or role.

Anything else still blocks the run:

- any YouTrack permission (issues, comments, articles, attachments, work items) held globally or
  outside the harness projects;
- any other global permission;
- any readable VERM issue;
- any visible article outside the harness projects.

What the exception does expose, the settings and metadata of the other projects, is recorded in
the preflight result on every run. `harness/isolation.ts` holds the rule.

## Decisions (2026-11-08, VERM-10)

These are now in `docs/requirements.md` and the checklist, and the harness asserts them.

- **B7: the Choose next count** is the number of cards displayed, capped at seven. Dismissing a
  card removes it at once, and another eligible issue may fill its place, so the count falls only
  when fewer than seven eligible candidates remain. `e2e/priority-desk-choose-next.spec.ts` covers
  both cases.
- **K6/E8: completion and focus.** A Done issue leaves Now/Next/Then, *Blocked focused work* and
  *Needs attention*, and stays eligible for *Recently completed*. Its stored `Focus` and
  `Focus rank` are not cleared, but it reserves no rank. If it is reopened into a collision, the
  repair state lets the user choose; nothing picks a winner. E8, E9 and E10 cover this live.

## Coverage gaps (beyond this pilot)

Recorded together rather than as separate tickets.

- **Not automated live:**
  - A1–A4 and A9–A10, which the fake suite largely covers;
  - B1–B8 and B10, including the B8 Monday expiry;
  - C1–C5, the epic and Master Plan cases, which need VERM issues;
  - D1–D7, which make paid Claude calls and post audit comments on real tickets;
  - E1–E7.
- **The deterministic suite always runs the build in its own checkout's `app/out/`.** It has no
  executable override, so it cannot be pointed at the pinned acceptance binary from another
  checkout. The live harness can run against either build through `VERMILIAN_LIVE_EXECUTABLE`.
- **Drag-and-drop row reordering** is still `test.fixme` in `e2e/dnd.spec.ts`. That is
  unrelated to the Priority Desk.
- **E8 to E10 are live-only end to end.** The deterministic fake YouTrack drops resolved issues
  from `getIssues`, but the real client returns them (finding K6). A fake-suite test would pass for
  the wrong reason, so none was added. The K6 correction's logic is unit-tested instead
  (`project-board/focus.test.ts` and `daily-review/boardData.test.ts`, named E8 to E10), and the
  live cases remain the end-to-end check.
- **No refresh control (K4).** A7's external-change detection relies on a full restart, as the
  checklist does.
