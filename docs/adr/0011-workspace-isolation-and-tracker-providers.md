# ADR-0011: Workspaces as the isolation boundary, with per-workspace tracker and AI account

Date: 2026-11-11
Status: Proposed

## Context

Vermilian started as a client for a single YouTrack server. It reads one YouTrack connection and
one Anthropic API key from its settings, and keeps every workspace in one shared configuration
article, `_vermilian-config` ([ADR-0007](0007-priority-desk-field-model.md),
`docs/requirements.md` § Workspaces and organization).

Two needs no longer fit that model:

1. **More than one ticketing backend.** A user may keep some work in YouTrack and some in Jira
   Cloud. Today the only way to see Jira work in Vermilian is to copy tickets by hand into a
   YouTrack project. That duplicates data and drifts out of date.
2. **More than one Anthropic account.** Different areas of work may need to be billed to, and
   governed by, different Anthropic accounts. Today every AI feature uses the one key.

Both needs share one requirement: data and credentials belonging to one area of work must not leak
into another. [ADR-0010](0010-human-directed-operational-console.md) principle 6 already says
data from different sources must not flow automatically across a boundary. This ADR makes the
**workspace** that boundary.

A third constraint comes from the Priority Desk (Project Runway). Its Focus, Focus rank and Why
now values are YouTrack custom fields (ADR-0007). Jira has no equivalent, and an ordinary Jira user
cannot create custom fields. Jira's own `Rank` field is shared by every board and user, so it cannot
hold a personal Now/Next/Then order either. Runway metadata for Jira issues needs storage of its
own.

The Jira connection work already merged keeps a shared, non-secret Jira profile in its own
article, and loads the Jira token per host through the existing credential chain. That article is
separate from `_vermilian-config` because an older client rewrites `_vermilian-config` from its
cache and would silently drop fields it does not know. The same reasoning shapes the storage
decision below.

## Options considered

**Workspace configuration storage**

| Option | Pros | Cons |
| --- | --- | --- |
| **A. Keep one shared configuration article and add tracker and AI-account fields to each workspace in it** | Smallest change to storage | An older client rewriting the article drops the new fields. One article holds every workspace, so an edit to one workspace rewrites all of them. |
| **B. One central "AI accounts" article mapping workspaces to accounts, plus per-provider overlay articles** | Small, focused articles | Configuration for one workspace is spread across several articles. Isolation depends on keeping several mappings consistent. |
| **C. One configuration article per workspace (chosen)** | Each workspace's configuration lives in one place, and a change to one workspace cannot touch another. No central index to rewrite. Older clients never read these articles. | One article per workspace. A migration step is needed. |
| **D. Separate application profiles (one install or data directory per area of work)** | Strong isolation | Switching means restarting with another profile. No shared configuration server. Works against the single-console goal in ADR-0010. |

**Runway metadata for Jira issues**

| Option | Pros | Cons |
| --- | --- | --- |
| **Jira custom fields** | Visible in Jira | Needs Jira administrator rights. Exposes personal sequencing to everyone on the project. |
| **Jira `Rank`** | Exists already | Global to all boards and users. Reorders other people's backlogs. Rejected outright. |
| **A YouTrack article per workspace** | Shared across machines automatically | Puts per-issue tracking data on the configuration server, a write per desk change, and conflict handling for concurrent edits. |
| **Local SQLite database, with manual snapshot export and import (chosen)** | No server and no new infrastructure. Fast, transactional, and validated with SQLite's own integrity checks. One portable file. | Not shared between machines automatically. A machine's data moves only when the user exports and imports a snapshot. |

## Decision

### 1. The workspace is the isolation boundary

Vermilian supports any number of independently configured workspaces, and **exactly one workspace
is active at a time on each machine**. A workspace is not typed as "work" or "personal"; it can
represent any purpose, project or area of focus.

Each workspace controls its own:

| Concern | What the workspace holds |
| --- | --- |
| **Ticketing backend** | Jira or YouTrack, with its own non-secret connection details and a credential reference |
| **Anthropic account** | A credential reference used for every AI operation in the workspace, or none |
| **Configuration** | Its own YouTrack Knowledge Base article |
| **Runway metadata** | Focus, ranks, Why now and dismissals, stored by provider (section 6) |

### 2. Only the active workspace operates

Switching workspaces switches the complete operating context:

- the ticketing connection and selected projects;
- the Anthropic credential;
- the Priority Desk and its Runway metadata;
- AI recommendations and AI task creation;
- stand-up generation;
- the master plan (section 9) and the rest of the workspace configuration.

Vermilian never combines data from several workspaces automatically. A stand-up, a recommendation
or a created task uses only the active workspace's issues and only its Anthropic credential.

The active workspace is a per-machine setting, kept in local configuration. If a timer is running
when the user switches workspaces, Vermilian asks first to stop it, which records the elapsed time
as usual, or to cancel the switch.

### 3. Tracker providers

A `TrackerProvider` interface sits behind the IPC layer, with two implementations:

- **YouTrack**, which is the existing client, moved behind the interface without changing its
  behavior;
- **Jira Cloud**, which is read-only in its first phase.

A workspace has exactly one backend. Issue identifiers are namespaced by provider (`yt:` and
`jira:`), so an identifier can never be mistaken for one from the other backend. Fields that exist
only in one provider are hidden for the other provider's issues.

### 4. One configuration article per workspace

Each workspace is stored in its own article in the **configuration YouTrack**, which is the YouTrack
server in Vermilian's main settings. This holds whichever backend the workspace uses for tickets.

- The article title is `_vermilian-ws-<workspaceId>`. The ID is stable and never derived from the
  display name, so renaming a workspace never moves its configuration.
- Vermilian finds workspaces by listing articles with that prefix. There is no central index.
- The article holds configuration only: the backend, connection details, credential references,
  projects, board settings, per-project status mapping and due-date field choice, and an optional
  master plan. It holds no per-issue Runway metadata for Jira issues.
- The workspace's projects are its folders' `projectIds`: YouTrack project IDs or Jira project
  keys, each in exactly one folder. Folders are the single project-selection structure for both
  backends; there is no second project list.
- Only known fields are interpreted or used. A field this version does not know is never read,
  but it is written back unchanged whenever an existing workspace article is updated, so an older
  client does not drop configuration a newer one added.
- A secret-shaped value anywhere in the document, known field or not, such as a token pasted into
  an article by hand, makes the document invalid. The error names the field and never shows the
  value.

A sanitized example:

```json
{
  "schema": 1,
  "workspaceId": "ws-3f9a2c",
  "name": "Workspace A",
  "order": 1,
  "backend": {
    "kind": "jira",
    "siteUrl": "https://example.atlassian.net",
    "email": "user@example.com",
    "cloudId": "",
    "credentialRef": "jira-1"
  },
  "ai": { "credentialRef": "anthropic-1" },
  "folders": [
    { "id": "folder-demo", "name": "Demo", "order": 0, "parentId": null, "projectIds": ["DEMO"] }
  ],
  "boards": {},
  "dismissals": {}
}
```

A YouTrack-backed workspace has `"kind": "youtrack"` and a `serverUrl` in place of the Jira
fields, and YouTrack project IDs in its folders.

### 5. Credential references, resolved per host

YouTrack and the local database hold **credential references, never secrets**. A reference is an
opaque name such as `anthropic-1` or `jira-1`.

Each host maps a reference to its own sources, using the existing priority chain
(`app/src/main/services/credentials.ts`), extended from one credential per kind to any number of
named credentials:

1. a shell command in local `app-config.json`, for example one that reads from a secret manager;
2. a file path in local `app-config.json`;
3. an Electron `safeStorage` blob for that reference.

Rules:

- **No fallback.** If the workspace's reference has no source on this host, or its source fails,
  the operation stops. The message names the workspace and the reference. Vermilian never
  substitutes another credential.
- **Explicit sharing.** Two workspaces naming the same reference share that credential on purpose.
  A host's source for a reference affects only the workspaces that name it.
- **Defaults.** A new workspace has no Anthropic credential selected, and AI features stay
  unavailable in it until one is chosen. Nothing distinguishes one kind of account from another in
  code.
- Retrieval commands and token files are local, per host. They are never stored in YouTrack, in
  the local database, or in this repository.

### 6. Runway metadata, by provider

The Priority Desk behaves the same whichever provider a workspace uses: star, Now/Next/Then
ranks, Why now, "Not this week" dismissals, and the rank-uniqueness rules of ADR-0007.

| Workspace backend | Where Runway metadata lives |
| --- | --- |
| **YouTrack** | **Unchanged.** Focus, Focus rank and Why now stay YouTrack custom fields (ADR-0007), and dismissals stay in YouTrack configuration. No YouTrack field is migrated or removed. |
| **Jira** | A **local SQLite database** in Vermilian's user-data directory. |

The SQLite database:

- is keyed by stable workspace ID **and** provider-qualified issue ID (`jira:DEMO-123`), so the same
  key in two workspaces never shares data;
- holds only Vermilian's own metadata: Focus, rank, Why now, dismissals, and any other Runway state
  the provider cannot store, such as a deferred flag. It never holds issue titles, descriptions or
  comments, which are always fetched live from Jira;
- enforces at most one issue per rank per workspace with a unique index, so a duplicate cannot be
  written;
- records its schema version in `PRAGMA user_version` and identifies itself as a Vermilian database
  with `PRAGMA application_id`;
- uses Node's built-in `node:sqlite` module, which Electron's bundled Node provides. No native
  module, no database server and no new service is added.

### 7. Portable snapshots, exported and imported by hand

The database is not synchronized automatically. To carry Runway metadata to another machine, the
user exports a snapshot on one and imports it on the other.

- **Scope.** A snapshot is always the whole database. Export and import cover every workspace's
  metadata at once; there is no partial or per-workspace import.
- **Export** writes a consistent single-file copy of the whole database, using SQLite's online
  backup API (`backup()` in `node:sqlite`), to a location the user chooses.
- **Import** never touches the live database until every check has passed:
  1. the file is opened read-only and must pass `PRAGMA integrity_check`;
  2. its `application_id` must match, and its `user_version` must be one this version can read; a
     newer schema is refused with a message;
  3. a timestamped backup of the current database is written first;
  4. the user sees what will be replaced — the snapshot's export time and how many entries each
     side holds — and must explicitly confirm;
  5. the snapshot replaces the live database atomically, by writing a temporary file and renaming
     it; on any failure the live database is left as it was.
- Snapshots and backups contain user-entered metadata. They belong in private storage and never in
  this repository.

### 8. Data minimization

Data from an external tracker is read live and kept in memory wherever possible. Vermilian
persists only the metadata it needs: issue keys, Focus, ranks, user-entered Why now text,
dismissals, and per-workspace configuration. It never copies another tracker's issue titles,
descriptions or comments into YouTrack or into the local database.

### 9. Stand-ups and master plan

A stand-up covers the active workspace only, using its Anthropic credential. Scopes that span
several workspaces are withdrawn. A workspace may name its own master-plan article
([ADR-0008](0008-master-plan-storage.md)), or none.

### 10. Generic public code

This repository contains only generic software and architecture. Site URLs, account emails,
cloud IDs, project keys, credentials, retrieval commands, configuration data and database
snapshots are held in the configuration YouTrack or local storage. Code, documentation, tests and
fixtures use fictional values such as `example.atlassian.net`, `DEMO-123`, `Workspace A` and
`Account 1`.

### 11. Migration

Migration occurs during the first activation of per-workspace configuration storage, not merely
the first startup of a version that contains the migration code. Until then `_vermilian-config`
stays authoritative. At that activation:

- each workspace in `_vermilian-config` becomes its own article, keeping its ID, name, order,
  folders, projects, board configuration and dismissals, with a YouTrack backend on the current
  server;
- the existing Jira profile article is copied into the workspace it is assigned to;
- `_vermilian-config` and the Jira profile article are left unchanged, not deleted;
- YouTrack Focus, Focus rank and Why now fields are not touched;
- the SQLite database is created empty. No Jira Runway metadata exists before this version, so
  there is nothing to move into it.

## Consequences

- **Easier:** adding a backend or an Anthropic account is configuration, not an architectural
  change. One workspace's configuration can be reviewed or removed on its own. The Priority Desk
  works for Jira issues without any Jira administration.
- **Harder:** every AI and tracker call needs the active workspace to resolve its credentials.
  Code that reads the single Claude key or the single YouTrack token directly must move behind
  per-workspace resolution. The Priority Desk reads Runway metadata through a provider-neutral
  store with two implementations.
- **Partly reverses ADR-0007 for Jira workspaces only.** ADR-0007 rejected a local ranking store
  because it can drift between machines and needs its own backup story. Those costs are accepted
  for Jira workspaces, where no shared field exists, and are bounded by manual export/import and
  the backup taken before every import. YouTrack workspaces are unaffected.
- **Machines can diverge.** Jira Runway metadata on two machines differs until the user moves a
  snapshot across. Importing replaces the target's data; changes made there since its last import
  are kept only in the pre-import backup.
- **Backups:** the database lives in the user-data directory and is covered by whatever backs up
  that directory on each machine. Vermilian takes its own backup only before an import.
- **Removed:** stand-up scopes that span several workspaces.
- **Supersedes in part:** the shared `_vermilian-config` article stops being the live store for
  workspaces. [ADR-0004](0004-credential-storage.md) is extended, not replaced: its chain now
  applies per credential reference.
- **Unchanged behavior worth noting:** a YouTrack issue shown in two YouTrack workspaces still
  shares one set of Focus fields, as it does today.
- **Risk:** an older client still in use after migration reads and writes the retained
  `_vermilian-config` and will not see later changes. Machines should be upgraded together.
- **Risk:** Why now text is user-entered and may be sensitive. It lives in YouTrack (YouTrack
  workspaces) or in the local database and its snapshots (Jira workspaces), never in this
  repository.

### Open questions (to be settled before this ADR is accepted)

- [x] **Import scope.** Settled: an import replaces the whole database (section 7).
- [ ] **`node:sqlite` stability.** Confirm the module's stability level in the Node release bundled
  with the Electron version shipped, and that it loads in the packaged app on all four release
  platforms.
