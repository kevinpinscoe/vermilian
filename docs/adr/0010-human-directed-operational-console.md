# ADR-0010: Vermilian is a human-directed operational console

Date: 2026-11-08
Status: Proposed

## Context

Vermilian began as a desktop client for a self-hosted YouTrack instance (`docs/requirements.md` §
Scope). The Priority Desk work under [VERM-3](https://youtrack.kevininscoe.com/issue/VERM-3) made
it more than a board viewer, and Kevin now intends Vermilian and ConTower, his Claude Code lane
manager, to become his two main operational consoles. The goal is fewer things competing for his
attention, less switching between applications, and less mental overhead. He wants to see
information, make decisions and control his workflows from these consoles instead of repeatedly
opening the applications underneath them.

Two existing documents already say AI must not decide on Kevin's behalf:

- `docs/requirements.md` § Priority Desk → Daily Review: "AI agents stay executors throughout:
  they can propose work and report results, never select priorities or close accepted work on
  their own."
- The "Ask for recommendation" requirement says the AI never writes a field, rank, status or epic
  link itself.

Neither document says what *is* allowed. Read too broadly, "human in the loop" would rule out
behavior Kevin wants: the Pomodoro timer logs elapsed time when it stops, and recovers an
interrupted timer after a forced exit. Both are deliberate, ADHD-supporting features. Read too
narrowly, the fact that Vermilian holds API access would seem to permit any write.

Kevin approved the principles below on 2026-11-08. This ADR records them so that later design
decisions, reviews and test plans can apply them consistently. It changes no application behavior
and adds nothing to the current release scope.

## Options considered

| Option | Pros | Cons |
| --- | --- | --- |
| Leave the principles implicit in individual requirements | No new document | Each feature re-argues the question. A reviewer can mistake authorized automation (timer logging) for autonomous action, or the reverse. |
| Record them only in `docs/requirements.md` | Close to the features they govern | Requirements say *what* Vermilian does. These are product-level reasons that span features, and later ConTower. |
| **A product-level ADR that the requirements reference** | One place to point to. Follows the ADR process. Does not replace any existing decision. | One more document to keep consistent with the requirements |

## Decision

Record the following as Vermilian's product-level principles.

### 1. Purpose

Vermilian is meant to become one of Kevin's two primary operational consoles, alongside ConTower.
Its purpose is to keep his attention, application switching and cognitive load to a minimum, while
he observes, decides and controls work from one place. Project Runway and the Priority Desk are
capabilities of Vermilian, not its whole purpose.

### 2. Three kinds of behavior

| Kind | What it is | Allowed? |
| --- | --- | --- |
| **A. Human decisions** | Kevin sets priorities, chooses actions, approves changes and authorizes workflows. | Always Kevin's. |
| **B. Authorized automation** | Once Kevin starts or authorizes a workflow, Vermilian carries out that workflow's expected operations automatically, within that authorization. | Yes. This is not a breach of human-in-the-loop. |
| **C. Autonomous decision-making** | An AI agent or the application decides on its own to take a consequential action outside workflow boundaries Kevin has already authorized. | No. API access alone never authorizes it. |

Examples of **B**:

- Pomodoro countdowns.
- Recording elapsed time when a timer stops.
- Recovering an interrupted timer after a restart.
- Saving application state.
- Refreshing and synchronizing data.
- Running an API action Kevin has explicitly approved.

Examples of **C**:

- Changing priorities or ranks on its own initiative.
- Closing or resolving issues on its own initiative.
- Deleting tickets on its own initiative.
- Starting unrelated work.

What matters is **whether Kevin authorized the action**, not whether it writes to a backend.
Creating, editing, closing or deleting an issue is legitimate when Kevin explicitly authorizes
it. Each one is class C only when an agent or the application decides on it by itself.

### 3. The Pomodoro timer stays as it is

The timer is an intentional ADHD productivity feature. It supports focus and removes the burden of
remembering to record elapsed work. Its automatic work-item logging and its crash recovery are
authorized automation (B), not autonomous behavior.

- They are not to be disabled or removed, and no extra approval prompts are to be added.
- The existing quit-confirmation dialog is unchanged.
- Testing continues for ordinary correctness: no duplicate work items, correct recovery and
  accurate elapsed time.

### 4. Authorized user capabilities are kept

Vermilian should eventually offer the actions Kevin would otherwise take directly in YouTrack or
Jira. A legitimate capability is not removed just because it modifies backend data.

#### Future Jira integration: constraints and testing approach

Jira support is outside VERM-3 and the current release. These constraints are recorded for when
it is planned, and they do not block VERM-10.

- **Credentials.** Jira API credentials represent Kevin's existing corporate identity. Kevin
  creates the API tokens and controls their scopes. The tokens are stored in OpenBao and reached
  through Parzival.
- **No test resources.** Separate Jira test accounts and new Jira test projects are prohibited.
- **Authorization.** Vermilian should eventually provide the legitimate operations Kevin would
  otherwise perform in Jira. Human authorization stays the controlling principle:
  - routine operations within a workflow Kevin has already authorized are permitted automation
    (class B);
  - independent consequential decisions by AI agents are not authorized (class C).

Testing differs from the isolated YouTrack harness, which uses dedicated disposable projects:

1. Automated API-contract and functional tests against synthetic responses and simulated Jira
   services.
2. Live verification through Kevin's corporate account and brokered credentials, reading only.
3. Narrowly scoped write tests, only on existing issues, and only when Kevin explicitly approves
   suitable targets and operations.
4. Verification of the resulting state and of any relevant side effects.
5. No speculative or unauthorized change to corporate Jira data.

If safe live write verification is not available, the test reports that limitation. It does not
create test resources or modify unrelated tickets to work around it.

### 5. Security controls live outside the consoles

- **OpenBao** is the credential store.
- **Parzival** brokers access to credentials.
- External, operation-level policy enforcement, where it applies, is a **future architectural
  objective**. It does not describe the present broker: today Parzival controls which identity
  can use which credential and in which mode (`exec`, `get`, `mount`), not which API operations
  a credential's holder performs. Within those bounds, the provider's own permissions are the
  limit.
- Provider permissions (YouTrack, Jira) remain authoritative.
- Human and AI execution contexts must remain distinguishable.
- Audit records identify the operation that was requested and the authorization behind it.

Hiding a credential from the user interface does not, by itself, make unrestricted API use safe.

This ADR does not design or change the broker infrastructure.

### 6. Personal and corporate data stay separate

When Jira is integrated, corporate data-handling requirements apply. Corporate issue content must
not flow automatically into:

- personal YouTrack configuration,
- personal backups,
- external AI services.

A single interface over both providers is allowed. It does not authorize storing or disclosing data
across that boundary.

### 7. Principles shared with ConTower, for future consideration

Principles 2, 5 and 6 are expected to apply to ConTower as well. This ADR does not change ConTower.
Any adoption there is ConTower's own decision, recorded in its own repository and its YouTrack
project (CT).

## Consequences

- Feature specs and reviews can classify a proposed behavior as A, B or C, rather than treating
  every write as suspect or every API capability as permitted.
- A future AI feature that wants to act (class C) needs an explicit authorization step, designed
  and approved per feature. The existing "Ask for recommendation" design already does this.
- Jira support will need its own ADR covering credentials (Kevin's own identity through
  Parzival), scopes, and the data-boundary rules in principle 6. That includes whether corporate
  content may reach the stand-up or recommendation AI calls, and the daily-notes export.
- [ADR-0004](0004-credential-storage.md) records Electron `safeStorage` as the credential store.
  Since then the app has gained a shell-command source, which is how it reaches OpenBao, and a
  file source, both ahead of `safeStorage` (`app/src/main/services/credentials.ts`). Principle 5
  prefers the external store. ADR-0004 is **not** superseded here; whether to amend it is a
  separate decision.
- `docs/requirements.md` § Scope still describes a YouTrack-only client. That remains the current
  release scope. This ADR records direction, not new scope.
