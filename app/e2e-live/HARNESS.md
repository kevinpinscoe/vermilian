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
| E8 | `e8-done-ranked.live.ts` | A ranked issue set to Done in the UI must leave the desk and Daily Review after a restart. That is asserted. The stored Focus and rank are recorded as an observation pending a decision. |
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
| `VERMILIAN_LIVE_APP_TOKEN_COMMAND` | yes | Shell command printing that account's token. The app and the preflight both run it, and it is never recorded |
| `VERMILIAN_LIVE_PROJECT` | yes | Harness project short name, with time tracking **enabled** |
| `VERMILIAN_LIVE_REJECT_PROJECT` | yes | Second harness project, with time tracking **disabled** (B9 rejection) |
| `VERMILIAN_LIVE_EXECUTABLE` | no | Build under test. Default: this checkout's `out/` |
| `VERMILIAN_LIVE_EVIDENCE_DIR` | no | Evidence root. Default `app/live-results/` (gitignored). On k-fed hosts use `~/evidence/VERM-10` |
| `VERMILIAN_LIVE_VERIFIER_URL` | no | Verifier base URL. Default `http://127.0.0.1:9000` |
| `VERMILIAN_LIVE_VERIFIER_AS`, `VERMILIAN_LIVE_VERIFIER_PROFILE` | no | parzival identity and profile. Default `ai` / `youtrack-claude-code` |
| `VERMILIAN_LIVE_FORBIDDEN_LOGINS` | no | Logins the app identity must not be. Default `admin,Claude_Code` |
| `VERMILIAN_LIVE_OPEN_STATE`, `VERMILIAN_LIVE_DONE_STATE` | no | Status names. Default `To do` / `Done` |

## Server setup still required

This setup exists so the live scenarios can run without touching Kevin's workspace, the TEST
fixtures or real VERM issues. Until it is in place, every live scenario reports **Blocked** with
the failing preflight check.

1. **A dedicated YouTrack account** for the application identity, for example
   `vermilian-harness`. It needs:
   - read and update access on the two harness projects, plus `CREATE_WORK_ITEM` on the first;
   - **no** read access to VERM's articles, so it cannot see `_vermilian-config`;
   - **no** `CREATE_ARTICLE` in VERM.
2. **A route for that account's token to the application.** Vermilian takes a token only as a
   raw value from a command, a file or its keyring. The `youtrack-claude-code` parzival profile
   deliberately issues the `Claude_Code` token only as a curl config, so it cannot serve here,
   and extracting it would bypass that policy. This needs its own parzival rule, and that rule is
   Kevin's decision.
3. **Two harness projects.** Neither may be in any workspace, and each needs `Focus`, `Focus rank`,
   `Why now` and a `Status` with `To do` and `Done`.
   - The first has time tracking enabled.
   - The second has time tracking disabled.
4. **Verifier permissions** for `Claude_Code` on both projects: read, create and update issues,
   and read work items.

## Specification gaps

These are decisions, not test failures. The harness does not encode the current behavior as the
expected result.

- **B7: what the Choose next count means.** The badge counts *displayed* candidates. It is capped
  at seven, by design (`PriorityDesk.tsx`, VERM-6 review, 2026-09-16). When more than seven issues
  are eligible, as in TEST with 38 open issues, dismissing one lets the eighth fill the gap. The
  count then stays at 7, while the checklist's B7 expects "the count drops".
  **Recommendation:** keep the displayed count and correct B7 to expect that the dismissed card
  leaves and the next eligible issue takes its place. The count drops only when seven or fewer are
  eligible.
- **K6/E8: what completion does to a rank.** No requirement says whether completing a ranked issue
  clears its stored `Focus` and `Focus rank`, or only removes it from the active slots.
  **Recommendation:** exclude resolved issues from Now/Next/Then, Daily Review and rank-conflict
  checks, but do not clear the stored values automatically. That keeps the rule "Vermilian never
  writes Focus without the user's action", and a reopened issue keeps its context. The harness
  asserts only the exclusion, which is the part the checklist already states.

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
- **No refresh control (K4).** A7's external-change detection relies on a full restart, as the
  checklist does.
