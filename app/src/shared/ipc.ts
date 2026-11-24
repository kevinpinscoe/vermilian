// Typed IPC contract shared by the main process, preload bridge, and renderer.
// The renderer never receives plaintext secrets; it calls these via
// `window.vermilian` (exposed by preload through contextBridge).

import type { AppConfig } from './config';
import type { BoardIssue, VermilianConfig, YouTrackProject } from './workspace';
import type { MasterPlanState, Outcome } from './masterPlan';
import type { JiraProfile } from './jiraProfile';
import type { JiraIssueRow } from './jiraIssue';
import type { WorkspaceDocument } from './workspaceSchema';
import type {
  ListWorkspaceArticlesResult,
  ReadWorkspaceArticleResult,
  SaveWorkspaceArticleResult,
} from './workspaceArticle';
import type { CreateFieldOptions } from './createFieldOptions';
import type { ProjectFieldValues } from './projectFieldValues';
import type { ActivationResult, RollbackResult, StorageStatusView } from './storageActivation';
import type { WorkspaceMigrationOptions, WorkspaceMigrationResult } from './workspaceMigration';
import type {
  CredentialFailure,
  CredentialRefStatus,
  CredentialSourceConfig,
  CredentialSourceKind,
} from './credentialRefs';

export const IPC = {
  getConfig: 'settings:getConfig',
  saveConfig: 'settings:saveConfig',
  credentialStatus: 'credentials:status',
  encryptPlaintextCredentials: 'credentials:encryptPlaintext',
  saveYouTrackToken: 'credentials:saveYouTrackToken',
  saveClaudeKey: 'credentials:saveClaudeKey',
  testYouTrack: 'youtrack:testConnection',
  getWorklogTypes: 'youtrack:getWorklogTypes',
  testClaude: 'claude:testKey',
  // Jira connection (VERM-20): the shared profile lives in YouTrack, the token
  // stays on this host (shared/jiraProfile.ts).
  getJiraProfile: 'jira:getProfile',
  saveJiraProfile: 'jira:saveProfile',
  saveJiraToken: 'credentials:saveJiraToken',
  testJira: 'jira:testConnection',
  // Read-only list of open Jira issues assigned to me (VERM-21).
  listMyJiraIssues: 'jira:listMyIssues',
  aiCreateTask: 'claude:aiCreateTask',
  standupGenerate: 'standup:generate',
  standupSave: 'standup:save',
  timerPostWorklog: 'timer:postWorklog',
  timerCheckpoint: 'timer:checkpoint',
  timerClearCheckpoint: 'timer:clearCheckpoint',
  timerReadCheckpoint: 'timer:readCheckpoint',
  timerSetQuitProtection: 'timer:setQuitProtection',
  timerProceedQuit: 'timer:proceedQuit',
  getBoardConfig: 'board:getConfig',
  saveBoardConfig: 'board:saveConfig',
  resetBoardConfig: 'board:resetConfig',
  getDismissals: 'priorityDesk:getDismissals',
  saveDismissal: 'priorityDesk:saveDismissal',
  runwayGet: 'runway:get',
  runwayUpdate: 'runway:update',
  runwayList: 'runway:list',
  runwayExportSnapshot: 'runway:export-snapshot',
  runwayImportPreview: 'runway:import-preview',
  runwayImportConfirm: 'runway:import-confirm',
  runwayImportCancel: 'runway:import-cancel',
  // Workspace Runway order (VERM-82): the runway_item rows, sections and notes.
  runwayItemsList: 'runway-items:list',
  runwayItemsAddIssue: 'runway-items:add-issue',
  runwayItemsAddIssueAtNumber: 'runway-items:add-issue-at-number',
  runwayItemsAddSection: 'runway-items:add-section',
  runwayItemsAddNote: 'runway-items:add-note',
  runwayItemsRemove: 'runway-items:remove',
  runwayItemsMove: 'runway-items:move',
  runwayItemsAddIssueAbove: 'runway-items:add-issue-above',
  runwayItemsMoveAbove: 'runway-items:move-above',
  runwayItemsMoveToNumber: 'runway-items:move-to-number',
  runwayItemsMoveUp: 'runway-items:move-up',
  runwayItemsMoveDown: 'runway-items:move-down',
  runwayItemsResolve: 'runway-items:resolve',
  // Each YouTrack project's Priority bundle order (VERM-92), read-only.
  youtrackPriorityOrders: 'youtrack:priorityOrders',
  jiraPriorityOrders: 'jira:priorityOrders',
  workspaceLinkTypes: 'workspace:linkTypes',
  runwayItemsAddByReference: 'runway-items:add-by-reference',
  pickFolder: 'dialog:pickFolder',
  openUserData: 'app:openUserData',
  // Workspace / board
  getProjects: 'youtrack:getProjects',
  getWorkspaceConfig: 'workspace:getConfig',
  saveWorkspaceConfig: 'workspace:saveConfig',
  deleteWorkspace: 'workspace:delete',
  forceResyncWorkspaceConfig: 'workspace:forceResync',
  // The per-machine active workspace (VERM-46, shared/activeWorkspace.ts).
  getActiveWorkspace: 'workspace:getActive',
  setActiveWorkspace: 'workspace:setActive',
  // Per-workspace configuration articles (VERM-43, shared/workspaceArticle.ts).
  // The renderer sends documents and edits as plain data; reading the article
  // and writing it happen in one main-process operation.
  listWorkspaceArticles: 'workspaceArticles:list',
  readWorkspaceArticle: 'workspaceArticles:read',
  createWorkspaceArticle: 'workspaceArticles:create',
  updateWorkspaceArticle: 'workspaceArticles:update',
  // Migration to per-workspace articles (VERM-44, shared/workspaceMigration.ts).
  // Nothing calls these on startup; VERM-46 runs migration at activation.
  planWorkspaceMigration: 'workspaceMigration:plan',
  // VERM-53: migration runs only inside activation; there is no standalone apply.
  getStorageStatus: 'workspaceStorage:status',
  activateWorkspaceStorage: 'workspaceStorage:activate',
  returnToLegacyStorage: 'workspaceStorage:returnToLegacy',
  // Per-reference credentials (VERM-45, shared/credentialRefs.ts). Status,
  // configuration and saving only: a resolved credential never crosses IPC,
  // and nothing here touches the legacy YouTrack/Claude/Jira settings.
  listCredentialRefs: 'credentialRefs:list',
  setCredentialRefSources: 'credentialRefs:setSources',
  saveCredentialRefSecret: 'credentialRefs:saveSecret',
  clearCredentialRefSecret: 'credentialRefs:clearSecret',
  checkWorkspaceCredential: 'credentialRefs:check',
  // One reference's configuration (never a value), for the Jira reconnect state (VERM-40).
  getCredentialRefStatus: 'credentialRefs:status',
  // OpenBao credential backend (VERM-64). Status and configuration only: a
  // stored credential or OpenBao token never crosses IPC.
  openbaoGetState: 'openbao:getState',
  openbaoSaveConnection: 'openbao:saveConnection',
  openbaoTest: 'openbao:test',
  openbaoMigrate: 'openbao:migrate',
  openbaoSaveSecret: 'openbao:saveSecret',
  openbaoDeleteSecret: 'openbao:deleteSecret',
  openbaoDeactivate: 'openbao:deactivate',
  openbaoCleanupOriginal: 'openbao:cleanupOriginal',
  // A Jira workspace's selectable projects, read with its own credential (VERM-33).
  listWorkspaceJiraProjects: 'workspaceJira:listProjects',
  listWorkspaceJiraStatuses: 'workspaceJira:listStatuses',
  // The boards the workspace's account can see, read with its own credential (VERM-59).
  listWorkspaceJiraBoards: 'workspaceJira:listBoards',
  // One of a Jira workspace's projects, read-only, for its board (VERM-34).
  getWorkspaceJiraIssues: 'workspaceJira:getIssues',
  getWorkspaceJiraRecentlyUpdated: 'workspaceJira:getRecentlyUpdated',
  // One Jira issue's fields, description and comments, read-only (VERM-35).
  getWorkspaceJiraIssueDetail: 'workspaceJira:getIssueDetail',
  // Key or text search over the workspace's own projects, Done included (VERM-61).
  searchWorkspaceJiraIssues: 'workspaceJira:searchIssues',
  // The workspace connection's own accountId, for the "Me" filter (VERM-62).
  getWorkspaceJiraMyAccountId: 'workspaceJira:getMyAccountId',
  getIssues: 'youtrack:getIssues',
  searchIssues: 'youtrack:searchIssues',
  // _vermilian-master-plan (ADR-0008) — read-only discovery + parse; never
  // creates, updates, or overwrites the article.
  getMasterPlan: 'youtrack:getMasterPlan',
  openExternalUrl: 'shell:openExternalUrl',
  quitApp: 'app:quit',
  // Issue CRUD
  getIssueDetail: 'youtrack:getIssueDetail',
  patchIssue: 'youtrack:patchIssue',
  createIssue: 'youtrack:createIssue',
  // The selected project's own Status/Priority/Category values and defaults
  // for the create forms (VERM-115), on the active workspace's connection.
  getCreateFieldOptions: 'youtrack:getCreateFieldOptions',
  getProjectFieldValues: 'youtrack:getProjectFieldValues',
  deleteIssue: 'youtrack:deleteIssue',
  moveIssue: 'youtrack:moveIssue',
  // Priority Desk "Ask for recommendation" (VERM-8, docs/requirements.md §
  // Priority Desk). getRecommendation composes a bounded, request-scoped
  // fetch (never the board cache) with a Claude tool-use call and never
  // writes any field. postRecommendationAudit is the only path that ever
  // writes a YouTrack comment for this feature, and only after the caller
  // supplies a completed ranked recommendation plus the user's chosen
  // confirmation action — see shared/recommendationAudit.ts.
  getRecommendation: 'priorityDesk:getRecommendation',
  postRecommendationAudit: 'priorityDesk:postRecommendationAudit',
  // Priority Desk Daily Review (VERM-9, docs/requirements.md § Priority
  // Desk). Deterministic only — no Claude call. Covers just "recently
  // completed", the one section the board cache (getIssues,
  // includeResolved: false) can't answer; every other section is derived
  // client-side from that same board cache (see renderer/features/daily-review).
  dailyReviewGet: 'priorityDesk:dailyReviewGet',
} as const;

export interface CredentialStatus {
  hasYouTrackToken: boolean;
  hasClaudeKey: boolean;
  hasJiraToken: boolean;
  backend: string;
  secure: boolean;
  /**
   * Saved (safeStorage-tier) credentials that need attention (VERM-57):
   * held in a plain-text file, or an encrypted blob that no longer decrypts
   * and is the source in use.
   */
  plaintext: CredentialKind[];
  undecryptable: CredentialKind[];
}

export type CredentialKind = 'youtrack' | 'claude' | 'jira';

/** Encrypted only: where safeStorage cannot encrypt, nothing is saved (VERM-57). */
export interface SaveSecretResult {
  ok: boolean;
  backend?: string;
}

export interface EncryptPlaintextResult {
  encrypted: number;
  failed: number;
}

/** Result of changing a per-reference credential's configuration or blob (VERM-45). */
export type CredentialRefWriteResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'invalid-reference' | 'legacy-reference' | 'invalid-value' | 'encryption-unavailable' | 'write-failed';
    };

/** Whether a workspace's credential resolves on this host — never the value (VERM-45). */
// One source of a Jira workspace's board: a chosen project (projectKey) or,
// with boardId, a chosen Jira board (VERM-59), whose issues may come from any
// project. Exactly one of the two is used; boardId wins when both are given.
export interface GetWorkspaceJiraIssuesArgs {
  workspaceId: string;
  projectKey?: string;
  boardId?: number;
  includeResolved?: boolean;
}

export type GetWorkspaceJiraIssuesResult =
  // priorities: the project's values, most urgent first ([] when unknown, and
  // [] for a board). prioritiesByProject: for a board, each project its
  // issues come from (VERM-59). truncated: a board's list was cut at the
  // page guard and holds its most recently updated issues only.
  | { ok: true; issues: import('./workspace').BoardIssue[]; priorities: string[]; prioritiesByProject?: Record<string, string[]>; truncated?: boolean }
  | import('./jiraConnection').WorkspaceJiraFailure;

/** One source's recently updated issues — the board's incremental poll (VERM-39). */
export interface GetWorkspaceJiraRecentlyUpdatedArgs {
  workspaceId: string;
  projectKey?: string;
  boardId?: number;
}

/** A Jira board the workspace's account can see, for the picker (VERM-59). */
export interface WorkspaceJiraBoardOption {
  id: number;
  name: string;
  type: string;
  projectKey: string; // the board's location project, '' when none
}

export type ListWorkspaceJiraBoardsResult =
  | { ok: true; boards: WorkspaceJiraBoardOption[] }
  | import('./jiraConnection').WorkspaceJiraFailure;

export type GetWorkspaceJiraRecentlyUpdatedResult =
  // Resolved issues included: the renderer drops them when Show done is off.
  | { ok: true; issues: import('./workspace').BoardIssue[] }
  | import('./jiraConnection').WorkspaceJiraFailure;

export interface GetWorkspaceJiraIssueDetailArgs {
  workspaceId: string;
  issueKey: string;
}

export type GetWorkspaceJiraIssueDetailResult =
  | {
      ok: true;
      issue: import('./workspace').IssueDetail;
      // The issue in the Jira web UI, on this workspace's own site (VERM-66).
      issueUrl: string;
      // Description and comments as Markdown, escaped; render without raw HTML.
      content: import('./jiraContent').JiraIssueContent;
    }
  | import('./jiraConnection').WorkspaceJiraFailure;

export interface SearchWorkspaceJiraIssuesArgs {
  workspaceId: string;
  query: string;
}

export type SearchWorkspaceJiraIssuesResult =
  | { ok: true; issues: import('./workspace').BoardIssue[] }
  | import('./jiraConnection').WorkspaceJiraFailure;

export type GetWorkspaceJiraMyAccountIdResult =
  | { ok: true; accountId: string }
  | import('./jiraConnection').WorkspaceJiraFailure;

export type ListWorkspaceJiraProjectsResult =
  | { ok: true; projects: Array<{ id: string; name: string; shortName: string }> }
  | import('./jiraConnection').WorkspaceJiraFailure;

// Every workflow status in the workspace's chosen projects (VERM-67).
// `incomplete` says some could not be read, so the list may be short.
export type ListWorkspaceJiraStatusesResult =
  | { ok: true; statuses: string[]; incomplete: boolean }
  | import('./jiraConnection').WorkspaceJiraFailure;

export type CredentialRefStatusResult = { ok: true; status: CredentialRefStatus } | { ok: false; message: string };

export type WorkspaceCredentialCheck =
  | { ok: true; credentialRef: string; source: CredentialSourceKind }
  | ({ ok: false } & CredentialFailure);

export interface TestYouTrackArgs {
  url: string;
  token?: string; // freshly-typed token; falls back to the stored one if omitted
}
export interface TestYouTrackResult {
  ok: boolean;
  displayName?: string;
  status?: number;
  message?: string;
}

export interface GetWorklogTypesArgs {
  url?: string;
  token?: string;
}

export interface TestClaudeArgs {
  key?: string; // freshly-typed key; falls back to the stored one if omitted
  model: string;
}
export interface TestClaudeResult {
  ok: boolean;
  error?: string;
}

export type SaveJiraProfileResult =
  | { ok: true; profile: JiraProfile }
  | { ok: false; message: string };

export type ListJiraIssuesResult =
  | { ok: true; siteUrl: string; issues: JiraIssueRow[] }
  | { ok: false; reason: 'not-configured' | 'error'; message: string };

export interface TestJiraArgs {
  profile: Partial<JiraProfile>; // the unsaved form values
  token?: string; // freshly-typed token; falls back to the stored one if omitted
}
// Mirrors JiraProbeResult (main/api/jira.ts) plus a 'no-token' / 'invalid-profile'
// pre-check. cloudId is the detected or given value, so the form can fill it in.
export type TestJiraResult =
  // missingScopes: scopes the token lacks for reads Vermilian makes (VERM-59);
  // empty when none are missing or they could not be checked.
  | { ok: true; kind: 'classic' | 'scoped'; cloudId: string; displayName: string; missingScopes?: string[] }
  | {
      ok: false;
      reason: 'unauthorized' | 'cloudid-unavailable' | 'error' | 'no-token' | 'invalid-profile';
      cloudId: string;
      message: string;
      status?: number;
    };

export interface GetIssuesArgs {
  projectShortName: string;
  includeResolved?: boolean; // default false — server filters to #Unresolved
}

export interface SearchIssuesArgs {
  // Scope — one short name (active project) or many (all projects in the active
  // workspace). Search is restricted to these projects.
  projectShortNames: string[];
  query: string; // user's free-text terms
}

export interface RunwayGetArgs {
  workspaceId: string;
  issueId: string; // namespaced: yt:<id> or jira:<KEY>
}

export interface RunwayUpdateArgs extends RunwayGetArgs {
  patch: import('./runway').RunwayPatch;
}

export type RunwayResult =
  | { ok: true; entry: import('./runway').RunwayEntry }
  | { ok: false; error: string; code?: string };

export interface RunwayListArgs {
  workspaceId: string;
}

export type RunwayListResult =
  | { ok: true; entries: import('./runway').RunwayEntry[] }
  | { ok: false; error: string; code?: string };

// Workspace Runway order (VERM-82). Every call names the workspace; the main
// process resolves it from the workspace configuration and refuses an unknown
// one. Writes are accepted for the active workspace only, and a ticket must be
// on that workspace's own tracker (any project). Listing is read-only; every
// write runs through the Runway write gate, one at a time with the snapshot
// import. Each successful call returns the workspace's whole order.
export interface RunwayItemsListArgs {
  workspaceId: string;
}

export interface RunwayItemsAddIssueArgs {
  workspaceId: string;
  issueId: string; // namespaced: yt:<id> or jira:<KEY>
  position?: number; // stored row position; default: the end
}

export interface RunwayItemsAddIssueAtNumberArgs {
  workspaceId: string;
  issueId: string;
  runwayNumber?: number; // Runway #, tickets only; default: the end
}

export interface RunwayItemsAddStructuralArgs {
  workspaceId: string;
  text: string;
  depth?: number; // 0..4, default 0
  position?: number; // stored row position; default: the end
}

export interface RunwayItemsItemArgs {
  workspaceId: string;
  itemId: string; // a ticket's namespaced ID, or a sec:/note: ID
}

export interface RunwayItemsMoveArgs extends RunwayItemsItemArgs {
  position: number;
}

/**
 * Add to Runway for an external blocker (VERM-98): the ticket goes in
 * immediately above its dependent, wherever the dependent is when the write
 * runs. `aliases` are every namespaced ID the ticket goes by (its readable
 * key and, for YouTrack, its entity ID); a row holding any of them refuses
 * the add.
 */
export interface RunwayItemsAddIssueAboveArgs {
  workspaceId: string;
  issueId: string;
  aliases: string[];
  /** The dependent's stored itemId. */
  dependentItemId: string;
}

/** Move prerequisite above (VERM-98): the row moves immediately above its dependent, wherever it is when the write runs. */
export interface RunwayItemsMoveAboveArgs extends RunwayItemsItemArgs {
  /** The dependent's stored itemId. */
  dependentItemId: string;
}

export interface RunwayItemsMoveToNumberArgs extends RunwayItemsItemArgs {
  runwayNumber: number;
}

export type RunwayItemsErrorCode =
  // From the store (main/services/runwayItemStore.ts).
  | 'already-on-runway'
  | 'not-on-runway'
  | 'invalid-position'
  | 'invalid-issue-id'
  | 'invalid-workspace'
  | 'invalid-depth'
  | 'invalid-text'
  | 'not-a-ticket'
  | 'dependent-not-on-runway'
  // From the handlers (main/services/runwayItemIpc.ts).
  | 'invalid-args' // not an argument object
  | 'unknown-workspace' // no workspace with this ID in the configuration
  | 'not-active-workspace' // a write to a workspace other than the active one
  | 'wrong-tracker' // the ticket is on the other tracker from the workspace's
  | 'workspace-unavailable' // the workspace configuration could not be read
  | 'cancelled'; // the active workspace was switched since the request began (addIssueOnce, edits, blocker actions)

export type RunwayItemsResult =
  | { ok: true; items: import('./runwayItem').RunwayItem[] }
  | { ok: false; error: string; code?: RunwayItemsErrorCode };

// Whole-database Runway snapshot export (VERM-50). `canceled` means the user
// closed the save dialog and nothing was written.
export interface RunwaySnapshotInfo {
  path: string;
  exportedAt: string; // ISO 8601
  exportedBy: string; // the computer recorded as the exporter
  schemaVersion: number;
  rowCounts: Record<string, number>; // per table, read back from the snapshot
}

export type RunwayExportSnapshotResult =
  | { ok: true; canceled: true }
  | { ok: true; canceled: false; snapshot: RunwaySnapshotInfo }
  | { ok: false; error: string; code?: string };

// Whole-database Runway snapshot import (VERM-51, ADR-0011 §7). The preview
// validates a private copy of the chosen file; nothing changes until the
// renderer confirms with the preview's token.
export interface RunwayImportPreview {
  token: string;
  fileName: string;
  path: string;
  // Filesystem modification time of the chosen file (ISO 8601). File metadata
  // only — never presented as the export time.
  fileModifiedAt: string;
  sizeBytes: number;
  // The chosen file's schema version. 1 means it was upgraded to version 2
  // in the private staged copy; the live database is never migrated by import.
  schemaVersion: number;
  // What the snapshot records (VERM-79); null when it does not (version 1).
  exportedBy: string | null;
  exportedAt: string | null; // ISO 8601
  // Shown before the user can confirm, because import replaces all local
  // Runway data. Empty when the snapshot holds exactly this computer's data.
  warnings: RunwayImportWarningInfo[];
  snapshotRowCounts: Record<string, number>;
  liveRowCounts: Record<string, number>;
  // Where the automatic pre-import backup will be written.
  backupDir: string;
}

export type RunwayImportWarningInfo =
  | {
      kind: 'newer-local-changes';
      latestLocalChange: {
        table: 'runway_entry' | 'runway_item';
        workspaceId: string;
        itemId: string;
        kind: string;
        updatedAt: string; // ISO 8601
      };
    }
  | { kind: 'cannot-tell' }
  | {
      // Dismissals carry no timestamp and removals leave none, so for these
      // records Vermilian cannot tell which copy is newer.
      kind: 'undatable-differences';
      dismissals: Array<{ workspaceId: string; issueId: string; local: string | null; snapshot: string | null }>;
      restored: Array<{ table: 'runway_entry' | 'runway_item'; workspaceId: string; itemId: string; kind: string }>;
    };

export type RunwayImportPreviewResult =
  | { ok: true; canceled: true }
  | { ok: true; canceled: false; preview: RunwayImportPreview }
  | { ok: false; error: string; code?: string };

export interface RunwayImportConfirmArgs {
  token: string;
}

export interface RunwayImportOutcome {
  backupPath: string;
  rowCounts: Record<string, number>;
  previousRowCounts: Record<string, number>;
  prunedBackups: number;
  // Set when old backups could not be cleaned up; the import succeeded.
  pruneWarning?: string;
}

export type RunwayImportConfirmResult =
  | { ok: true; result: RunwayImportOutcome }
  // backupPath is set when a backup was written before the failure.
  | { ok: false; error: string; code?: string; backupPath?: string };

export interface PatchIssueArgs {
  issueId: string;
  field: string;
  value: string | number | null;
}

export interface MoveIssueArgs {
  issueId: string;
  targetProjectId: string;
}

// ─── Priority Desk "Ask for recommendation" (VERM-8) ───────────────────────
// docs/requirements.md § Priority Desk, "Ask for recommendation". The AI
// never writes Focus/Focus rank/Status/Epic links itself — only one of the
// three confirmation actions below does, and each writes exactly the field
// it documents (see shared/recommendationAudit.ts and
// features/priority-desk/recommendationApi.ts).

export type ConfirmationAction = 'apply-to-desk' | 'star-only' | 'keep-my-order';

export interface RecommendationEvidence {
  outcomeContribution: string;
  dependencyReadiness: string;
  urgency: string;
  effort: string;
  risk: string;
}

// idReadable/summary are resolved server-side from the fetched candidate
// issues by matching Claude's chosen issueId (constrained to the candidate
// set via a JSON-schema enum) — never taken from the model's own prose, so a
// hallucinated summary can never reach the UI or the audit comment.
export interface RecommendationItem {
  issueId: string;
  idReadable: string;
  summary: string;
  evidence: RecommendationEvidence;
}

// A discriminated union by construction (PLAN.md "Clarification-only path")
// — a 'clarification' result carries no ranked/alternates data at all, so a
// caller cannot accidentally build an audit comment or a confirmation UI
// from one.
export type RecommendationResult =
  | { kind: 'ranked'; ranked: RecommendationItem[]; alternates: RecommendationItem[] }
  | { kind: 'clarification'; question: string };

// How a candidate's own parent Epic relates to the *selected* Outcome,
// resolved via the existing shared/masterPlan.ts `resolveEpicOutcome` —
// never re-derived. Computed in the renderer (which already holds both the
// candidate's BoardIssue.parentEpic and the loaded Master Plan outcomes) and
// sent as already-resolved context, so neither the main process nor the
// model has to re-run that matching logic.
export type EpicOutcomeContext =
  | 'matches-selected-outcome'
  | 'different-outcome'
  | 'no-outcome-association'
  | 'no-parent-epic';

export interface RecommendationCandidateContext {
  issueId: string;
  epicOutcomeContext: EpicOutcomeContext;
  parentEpicIdReadable: string | null;
}

export interface GetRecommendationArgs {
  // The currently displayed candidate ids (≤7, useChooseNextCandidates) —
  // never a wider query. issueIds and candidateContext must be the same set.
  issueIds: string[];
  candidateContext: RecommendationCandidateContext[];
  // The single selected Master Plan outcome's fields — reused verbatim from
  // shared/masterPlan.ts's Outcome, never a re-shaped copy.
  outcome: Outcome;
  // The workspace the request was made from; refused if it is no longer the
  // active one (VERM-47). Names the workspace, never a credential.
  workspaceId?: string;
}

export interface GetRecommendationResult {
  ok: boolean;
  result?: RecommendationResult;
  error?: string;
}

export interface PostRecommendationAuditArgs {
  // Must be a 'ranked' result — the handler refuses (ok: false) for a
  // 'clarification' result, defense-in-depth alongside the UI never
  // offering a confirmation action for one.
  result: RecommendationResult;
  action: ConfirmationAction;
}

export interface PostRecommendationAuditResult {
  ok: boolean;
  error?: string;
}

// Priority Desk Daily Review (VERM-9). Deliberately its own minimal shape,
// not a re-export of main/api/youtrack.ts's StandupTask — that type lives in
// a main-process-only file and carries stand-up-specific fields (notes,
// loggedMinutesToday) this section never displays.
export interface DailyReviewTask {
  idReadable: string;
  summary: string;
  priority: string | null;
}

// The workspace a Daily Review is for (VERM-114 review). The main process
// reads exactly this workspace and names it in the answer.
export interface DailyReviewGetArgs {
  workspaceId: string;
}

export interface DailyReviewGetResult {
  ok: boolean;
  error?: string;
  // The workspace this answer is for; absent only when none was named.
  workspaceId?: string;
  // Set when the read was refused before it started because the workspace
  // was not the active one (VERM-114 review); never cached as an answer.
  refused?: 'not-active';
  // Present only when ok is true. Always the fixed active-workspace/48h
  // scope — see renderer/features/daily-review — never user-configurable.
  completed?: DailyReviewTask[];
  // Incomplete status mappings, one plain-language line each (VERM-114).
  warnings?: string[];
}

export interface CreateIssueArgs {
  // The workspace the form was filled in; refused if it is no longer the
  // active one (VERM-115). Absent means the active workspace (quick add).
  workspaceId?: string;
  projectId: string;
  summary: string;
  status: string | null;
  priority: string | null;
  category: string | null;
  dueDate: number | null;
  ticket: string | null;
  ticketLink: string | null;
  relatedLink: string | null;
  notes: string | null;
  repoUrl: string | null;
}

export interface CreateIssueResult {
  ok: boolean;
  id?: string;
  idReadable?: string;
  error?: string;
  // Values the project does not offer, when the main-process check or the
  // server's response identifies them (VERM-115).
  rejected?: Array<{ field: string; value: string }>;
  // The project's options may be stale: offer to refresh them.
  refreshOptions?: boolean;
}

export interface CreateFieldOptionsArgs {
  workspaceId?: string;
  projectId: string;
}

// Always names the workspace and project it answers for, so a late answer
// for a project the form has left is recognisable and dropped (VERM-115).
export interface CreateFieldOptionsResult {
  ok: boolean;
  workspaceId: string;
  projectId: string;
  options?: CreateFieldOptions;
  error?: string;
  refused?: 'not-active';
}

// A project's select-field values (VERM-117), read on the named workspace's
// own connection. `project` is the project's short name or id; the result
// names both the workspace and the project it answers for.
export interface ProjectFieldValuesArgs {
  workspaceId: string;
  project: string;
}

export interface ProjectFieldValuesResult {
  ok: boolean;
  workspaceId: string;
  project: string;
  values?: ProjectFieldValues;
  error?: string;
  refused?: 'not-active';
}

export interface AiCreateTaskArgs {
  description: string;
  projects: { id: string; name: string }[];
  // The project already selected when the request is made, if any. Claude is
  // given that project's allowed values (VERM-115).
  projectId?: string;
  // The workspace the request was made from; refused if it is no longer the
  // active one (VERM-47). Names the workspace, never a credential.
  workspaceId?: string;
}

export interface AiCreateTaskFields {
  summary: string;
  projectId: string | null;
  priority: string | null;
  status: string | null;
  category: string | null;
  dueDate: string | null; // YYYY-MM-DD or null
  ticket: string | null;
  notes: string | null;
  projectMatchError: boolean;
  clarificationNeeded: string | null;
  // Suggestions cleared because the matched project does not offer them
  // (VERM-115), for the review form to flag.
  clearedSuggestions?: Array<{ field: string; value: string }>;
}

export interface AiCreateTaskResult {
  ok: boolean;
  fields?: AiCreateTaskFields;
  error?: string;
}

export interface StandupGenerateArgs {
  window: import('./config').StandupWindow;
  customWindowHours?: number;
  // Stand-ups cover the active workspace only (VERM-48). Any scope or
  // workspace list a caller still sends is ignored by the main process.
  // The workspace the request was made from; refused if it is no longer the
  // active one (VERM-47). Names the workspace, never a credential.
  workspaceId?: string;
}

export interface StandupGenerateResult {
  ok: boolean;
  markdown?: string;
  taskCount?: number;
  error?: string;
  // Incomplete status mappings, one plain-language line each (VERM-114): the
  // project and the group it has no valid status for. The other groups are
  // still reported.
  warnings?: string[];
}

export interface StandupSaveArgs {
  markdown: string;
  folder: string;
  dateStr: string;
  timeStr: string;
}

export interface StandupSaveResult {
  ok: boolean;
  error?: string;
}

export interface PostWorklogArgs {
  issueId: string;
  minutes: number;
  worklogType: string;
}

export interface PostWorklogResult {
  ok: boolean;
  error?: string;
}

export interface TimerCheckpointData {
  issueId: string;
  issueReadableId: string;
  summary: string;
  worklogType: string;
  checkpointWorkMs: number;
  startedAt: number;
}

// Re-export types the renderer needs from shared/workspace so it can import
// them from a single place (avoids renderer importing from shared/workspace directly).
export type { BoardIssue, VermilianConfig, YouTrackProject };

// Lifecycle states emitted by the _vermilian-config sync engine (main → renderer).
//   write-failed     — a debounced remote write failed; retrying with backoff.
//   write-recovered  — a previously-failed write eventually succeeded.
//   remote-newer     — another machine changed the article; remote merged in.
//   version-too-high — the stored config is newer than this client supports.
export type ConfigSyncStatus =
  | { kind: 'write-failed' }
  | { kind: 'write-recovered' }
  | { kind: 'remote-newer' }
  | { kind: 'version-too-high'; version: number }
  // VERM-53: a configuration write was refused by the storage guard
  // (shared/storageActivation.ts); nothing was saved. Names no secret.
  | { kind: 'storage-blocked'; message: string };

// The surface exposed on `window.vermilian` by the preload bridge.
export interface VermilianAPI {
  getConfig(): Promise<AppConfig>;
  saveConfig(patch: Partial<AppConfig>): Promise<{ ok: boolean }>;
  credentialStatus(): Promise<CredentialStatus>;
  encryptPlaintextCredentials(): Promise<EncryptPlaintextResult>;
  saveYouTrackToken(token: string): Promise<SaveSecretResult>;
  saveClaudeKey(key: string): Promise<SaveSecretResult>;
  testYouTrack(args: TestYouTrackArgs): Promise<TestYouTrackResult>;
  getWorklogTypes(args: GetWorklogTypesArgs): Promise<string[]>;
  testClaude(args: TestClaudeArgs): Promise<TestClaudeResult>;
  getJiraProfile(): Promise<JiraProfile | null>;
  saveJiraProfile(profile: Partial<JiraProfile>): Promise<SaveJiraProfileResult>;
  saveJiraToken(token: string): Promise<SaveSecretResult>;
  testJira(args: TestJiraArgs): Promise<TestJiraResult>;
  listMyJiraIssues(): Promise<ListJiraIssuesResult>;
  aiCreateTask(args: AiCreateTaskArgs): Promise<AiCreateTaskResult>;
  standupGenerate(args: StandupGenerateArgs): Promise<StandupGenerateResult>;
  standupSave(args: StandupSaveArgs): Promise<StandupSaveResult>;
  timerPostWorklog(args: PostWorklogArgs): Promise<PostWorklogResult>;
  timerCheckpoint(data: TimerCheckpointData): Promise<void>;
  timerClearCheckpoint(): Promise<void>;
  timerReadCheckpoint(): Promise<TimerCheckpointData | null>;
  timerSetQuitProtection(active: boolean): Promise<void>;
  timerProceedQuit(): Promise<void>;
  onQuitRequested(callback: () => void): void;
  // Fires after the _vermilian-config article finishes loading/syncing from YouTrack.
  // The renderer should invalidate workspace and board config queries on this event.
  onConfigSynced(callback: () => void): void;
  // Fires when the config-sync lifecycle changes state (write failure, recovery,
  // a concurrent edit from another machine, or an incompatible config version).
  onSyncStatus(callback: (status: ConfigSyncStatus) => void): void;
  getBoardConfig(projectId: string): Promise<import('./boardConfig').BoardConfig>;
  saveBoardConfig(config: import('./boardConfig').BoardConfig): Promise<void>;
  resetBoardConfig(projectId: string): Promise<void>;
  // Priority Desk "Not this week" dismissals (VERM-6) — persisted in the
  // _vermilian-config Article's `dismissals` map, same pattern as board config.
  getDismissals(): Promise<import('./boardConfig').Dismissals>;
  saveDismissal(entry: import('./boardConfig').NotThisWeekDismissal): Promise<void>;
  // Provider-neutral Runway metadata (ADR-0011 §6, VERM-37): Focus, Focus rank
  // and Why now. A yt: issue reads/writes its YouTrack custom fields; a jira:
  // issue reads/writes the local SQLite database. Never writes to Jira.
  runwayGet(args: RunwayGetArgs): Promise<RunwayResult>;
  runwayUpdate(args: RunwayUpdateArgs): Promise<RunwayResult>;
  // Every Jira Runway entry stored for a workspace (VERM-38): the Jira
  // Priority Desk's Now/Next/Then and the star on each Jira card. Local
  // SQLite only; YouTrack issues keep reading their own fields.
  runwayList(args: RunwayListArgs): Promise<RunwayListResult>;
  // Exports the WHOLE Runway metadata database (every workspace) to a file
  // the user picks, using SQLite's online backup (VERM-50). Never overwrites.
  runwayExportSnapshot(): Promise<RunwayExportSnapshotResult>;
  // Imports a whole-database snapshot (VERM-51): preview opens a file dialog
  // and validates a private copy; confirm backs up the live database and
  // replaces it in one transaction; cancel discards the preview.
  runwayImportPreview(): Promise<RunwayImportPreviewResult>;
  runwayImportConfirm(args: RunwayImportConfirmArgs): Promise<RunwayImportConfirmResult>;
  runwayImportCancel(args: RunwayImportConfirmArgs): Promise<{ ok: true }>;
  // Workspace Runway order (VERM-82): list, add, remove and move rows on a
  // workspace's Runway (local SQLite only; never writes to the tracker or the
  // workspace's projects). See RunwayItemsResult for the rules.
  runwayItemsList(args: RunwayItemsListArgs): Promise<RunwayItemsResult>;
  runwayItemsAddIssue(args: RunwayItemsAddIssueArgs): Promise<RunwayItemsResult>;
  runwayItemsAddIssueAtNumber(args: RunwayItemsAddIssueAtNumberArgs): Promise<RunwayItemsResult>;
  runwayItemsAddSection(args: RunwayItemsAddStructuralArgs): Promise<RunwayItemsResult>;
  runwayItemsAddNote(args: RunwayItemsAddStructuralArgs): Promise<RunwayItemsResult>;
  runwayItemsRemove(args: RunwayItemsItemArgs): Promise<RunwayItemsResult>;
  runwayItemsMove(args: RunwayItemsMoveArgs): Promise<RunwayItemsResult>;
  runwayItemsAddIssueAbove(args: RunwayItemsAddIssueAboveArgs): Promise<RunwayItemsResult>;
  runwayItemsMoveAbove(args: RunwayItemsMoveAboveArgs): Promise<RunwayItemsResult>;
  runwayItemsMoveToNumber(args: RunwayItemsMoveToNumberArgs): Promise<RunwayItemsResult>;
  runwayItemsMoveUp(args: RunwayItemsItemArgs): Promise<RunwayItemsResult>;
  runwayItemsMoveDown(args: RunwayItemsItemArgs): Promise<RunwayItemsResult>;
  // Each Runway ticket's tracker data, read on the workspace's own connection
  // only (VERM-84). Read-only: any configured workspace. See
  // shared/runwayTicket.ts for the states and errors.
  runwayItemsResolve(args: RunwayItemsListArgs): Promise<import('./runwayTicket').RunwayTicketsResult>;
  youtrackPriorityOrders(args: YouTrackPriorityOrdersArgs): Promise<YouTrackPriorityOrdersResult>;
  jiraPriorityOrders(args: JiraPriorityOrdersArgs): Promise<PriorityOrdersResult>;
  // The workspace's tracker's issue link types, read on the workspace's own
  // connection, for choosing its prerequisite link types (VERM-96).
  workspaceLinkTypes(workspaceId: string): Promise<import('./workspacePrerequisites').TrackerLinkTypesResult>;
  // Add a ticket by key or link to the active workspace's Runway (VERM-86):
  // checked once on the workspace's own connection, then added through the
  // write gate. See shared/runwayAdd.ts.
  runwayItemsAddByReference(args: import('./runwayAdd').RunwayAddByReferenceArgs): Promise<import('./runwayAdd').RunwayAddResult>;
  pickFolder(): Promise<string | null>;
  openUserData(): Promise<void>;
  // Workspace / board
  getProjects(): Promise<YouTrackProject[]>;
  getWorkspaceConfig(): Promise<VermilianConfig | null>;
  openExternalUrl(url: string): Promise<void>;
  saveWorkspaceConfig(config: VermilianConfig): Promise<{ ok: boolean; error?: string }>;
  // Per-workspace storage only (VERM-72): moves the projects to `destinationId`
  // when one is given, then permanently deletes the workspace's article.
  deleteWorkspace(workspaceId: string, destinationId: string | null): Promise<{ ok: boolean; error?: string }>;
  // The per-machine active workspace (VERM-46). Stored locally, never in the
  // shared _vermilian-config article. The context carries the backend kind,
  // its non-secret address and credential reference — never a credential.
  getActiveWorkspace(): Promise<import('./activeWorkspace').ActiveWorkspaceContext>;
  setActiveWorkspace(workspaceId: string): Promise<import('./activeWorkspace').SetActiveWorkspaceResult>;
  // Discards the local and in-memory workspace-config cache and re-fetches the
  // _vermilian-config Article from scratch, pruning any stale project ids in
  // the process. Manual recovery path for a corrupted shared Article.
  forceResyncWorkspaceConfig(): Promise<{ ok: boolean; error?: string }>;
  getIssues(args: GetIssuesArgs): Promise<BoardIssue[]>;
  searchIssues(args: SearchIssuesArgs): Promise<BoardIssue[]>;
  // Re-fetches and re-parses on every call — no persistent cache on either
  // side of this boundary. Refresh cadence is the renderer's own React
  // Query staleTime.
  // VERM-48: under per-workspace storage, the named workspace's own plan
  // (the active one when omitted); legacy storage ignores it.
  getMasterPlan(workspaceId?: string): Promise<MasterPlanState>;
  // Issue CRUD
  getIssueDetail(issueId: string): Promise<import('./workspace').IssueDetail>;
  patchIssue(args: PatchIssueArgs): Promise<{ ok: boolean; error?: string }>;
  createIssue(args: CreateIssueArgs): Promise<CreateIssueResult>;
  getCreateFieldOptions(args: CreateFieldOptionsArgs): Promise<CreateFieldOptionsResult>;
  getProjectFieldValues(args: ProjectFieldValuesArgs): Promise<ProjectFieldValuesResult>;
  deleteIssue(issueId: string): Promise<{ ok: boolean; error?: string }>;
  moveIssue(args: MoveIssueArgs): Promise<{ ok: boolean; error?: string }>;
  quitApp(): Promise<void>;
  // Priority Desk "Ask for recommendation" (VERM-8)
  getRecommendation(args: GetRecommendationArgs): Promise<GetRecommendationResult>;
  postRecommendationAudit(args: PostRecommendationAuditArgs): Promise<PostRecommendationAuditResult>;
  dailyReviewGet(args: DailyReviewGetArgs): Promise<DailyReviewGetResult>;
  // e2e-only test hook (VERMILIAN_E2E=1) — reads back what
  // postRecommendationAudit actually posted, from the in-memory fake. The
  // main-process handler is registered only under the e2e harness; calling
  // this outside it rejects. Optional because it carries no production
  // behavior of its own.
  debugGetPostedComments?(): Promise<Array<{ issueId: string; text: string }>>;
  // Per-workspace configuration articles (VERM-43). `base` is the document the
  // edit started from, exactly as read; the merge needs it to tell this
  // machine's changes from another machine's.
  listWorkspaceArticles(): Promise<ListWorkspaceArticlesResult>;
  readWorkspaceArticle(workspaceId: string): Promise<ReadWorkspaceArticleResult>;
  createWorkspaceArticle(doc: WorkspaceDocument): Promise<SaveWorkspaceArticleResult>;
  updateWorkspaceArticle(base: WorkspaceDocument, edited: WorkspaceDocument): Promise<SaveWorkspaceArticleResult>;
  // e2e-only hooks (VERMILIAN_E2E=1), like debugGetPostedComments: read the
  // fake's raw workspace articles, and overwrite one as "another machine".
  debugGetWorkspaceArticles?(): Promise<Array<{ id: string; summary: string; content: string; updated: number }>>;
  debugWriteWorkspaceArticle?(articleId: string, content: string): Promise<boolean>;
  // Migration preview (VERM-44): a dry run that writes nothing. Migration
  // itself runs only inside activateWorkspaceStorage (VERM-53).
  planWorkspaceMigration(options?: WorkspaceMigrationOptions): Promise<WorkspaceMigrationResult>;
  // Per-workspace configuration storage (VERM-53). Both changes require
  // `confirmed: true`; nothing activates on startup or install.
  getStorageStatus(): Promise<StorageStatusView>;
  activateWorkspaceStorage(args: { confirmed: boolean; jiraWorkspaceName?: string | null }): Promise<ActivationResult>;
  returnToLegacyStorage(args: { confirmed: boolean }): Promise<RollbackResult>;
  // e2e-only hooks: an older Vermilian rewrites _vermilian-config.
  debugWriteConfigArticle?(content: string): Promise<boolean>;
  debugFailConfigWrites?(n: number): Promise<void>;
  debugFailWorkspaceWrites?(n: number): Promise<void>;
  listCredentialRefs(): Promise<CredentialRefStatus[]>;
  setCredentialRefSources(credentialRef: string, sources: CredentialSourceConfig): Promise<CredentialRefWriteResult>;
  saveCredentialRefSecret(credentialRef: string, value: string): Promise<CredentialRefWriteResult>;
  clearCredentialRefSecret(credentialRef: string): Promise<CredentialRefWriteResult>;
  checkWorkspaceCredential(workspaceId: string, credentialRef: string | null): Promise<WorkspaceCredentialCheck>;
  getCredentialRefStatus(credentialRef: string): Promise<CredentialRefStatusResult>;
  openbaoGetState(scope: import('./openbao').OpenBaoScope): Promise<import('./openbao').OpenBaoScopeState>;
  openbaoSaveConnection(scope: import('./openbao').OpenBaoScope, connection: import('./openbao').OpenBaoConnection): Promise<import('./openbao').OpenBaoWriteResult>;
  openbaoTest(scope: import('./openbao').OpenBaoScope): Promise<import('./openbao').OpenBaoTestResult>;
  openbaoMigrate(scope: import('./openbao').OpenBaoScope, credentialRefs: string[]): Promise<import('./openbao').OpenBaoMigrationResult>;
  openbaoSaveSecret(scope: import('./openbao').OpenBaoScope, credentialRef: string, value: string): Promise<import('./openbao').OpenBaoWriteResult>;
  openbaoDeleteSecret(scope: import('./openbao').OpenBaoScope, credentialRef: string, args: { confirmed: boolean }): Promise<import('./openbao').OpenBaoWriteResult>;
  openbaoDeactivate(scope: import('./openbao').OpenBaoScope, credentialRef: string): Promise<import('./openbao').OpenBaoWriteResult>;
  openbaoCleanupOriginal(scope: import('./openbao').OpenBaoScope, credentialRef: string, args: { confirmed: boolean }): Promise<import('./openbao').OpenBaoWriteResult>;
  // The Jira projects a Jira workspace can choose from, listed through its own
  // connection and credential reference. Read-only; nothing is written to Jira.
  listWorkspaceJiraProjects(workspaceId: string): Promise<ListWorkspaceJiraProjectsResult>;
  // The workflow statuses of the workspace's chosen projects, read-only (VERM-67).
  listWorkspaceJiraStatuses(workspaceId: string): Promise<ListWorkspaceJiraStatusesResult>;
  // The Jira boards the workspace's account can see, read-only (VERM-59).
  listWorkspaceJiraBoards(workspaceId: string): Promise<ListWorkspaceJiraBoardsResult>;
  // A Jira workspace project's issues and priority order, read-only (VERM-34).
  getWorkspaceJiraIssues(args: GetWorkspaceJiraIssuesArgs): Promise<GetWorkspaceJiraIssuesResult>;
  getWorkspaceJiraRecentlyUpdated(args: GetWorkspaceJiraRecentlyUpdatedArgs): Promise<GetWorkspaceJiraRecentlyUpdatedResult>;
  // One of those issues in full, read-only, for its detail panel (VERM-35).
  getWorkspaceJiraIssueDetail(args: GetWorkspaceJiraIssueDetailArgs): Promise<GetWorkspaceJiraIssueDetailResult>;
  // Board search over the workspace's own projects, read-only (VERM-61).
  searchWorkspaceJiraIssues(args: SearchWorkspaceJiraIssuesArgs): Promise<SearchWorkspaceJiraIssuesResult>;
  // The workspace connection's accountId, for the Assignee filter's "Me" (VERM-62).
  getWorkspaceJiraMyAccountId(workspaceId: string): Promise<GetWorkspaceJiraMyAccountIdResult>;
  // e2e-only: the fake's _vermilian-config and Jira profile articles as stored.
  debugGetMigrationSources?(): Promise<Array<{ id: string; content: string; updated: number }>>;
  // e2e-only hooks on the fake Jira (VERM-39): see main/api/fakeJira.ts.
  debugJiraChange?(change: unknown): Promise<boolean>;
  debugGetJiraCalls?(): Promise<Array<{ fn: string; projectKey?: string; key?: string; jql?: string; boardId?: number; at: number }>>;
  debugSetJiraSearchDelay?(ms: number): Promise<void>;
  debugSetJiraGetIssueDelay?(ms: number): Promise<void>;
  // e2e-only (VERM-47): the credential reference each fake Claude call used.
  debugGetClaudeCalls?(): Promise<Array<{ fn: string; credentialRef: string; allowedStatus?: string[] }>>;
  // e2e-only (VERM-48): see main/api/fakeYouTrack.ts.
  debugGetStandupQueries?(): Promise<string[][]>;
  debugGetStandupCredentialRefs?(): Promise<string[]>;
  debugGetArticleFetches?(): Promise<Array<{ articleId: string; credentialRef: string }>>;
  debugSetArticleDelay?(ms: number): Promise<void>;
  debugSetStandupDelay?(ms: number, project?: string): Promise<void>;
  debugSetArticle?(articleId: string, value: { content: string } | { status: number }): Promise<void>;
  // e2e-only (VERM-115): create requests that reached the fake YouTrack, a
  // one-shot server refusal, and a held or failing project field read.
  debugGetCreateRequests?(): Promise<Array<{ projectId: string; summary: string; status: string | null; priority: string | null; category: string | null; dateTimeEnteredType?: string | null }>>;
  debugSetNextCreateError?(message: string | null): Promise<void>;
  debugGetFieldMetadataRequests?(): Promise<Array<{ project: string; credentialRef: string }>>;
  debugSetClaudeExtractDelay?(ms: number): Promise<void>;
  debugSetFieldMetadataDelay?(ms: number, project?: string): Promise<void>;
  debugFailFieldMetadata?(n: number, project?: string): Promise<void>;
  // e2e only (VERM-117): change a fake project's field values while the app runs.
  debugSetProjectField?(project: string, field: string, values: string[] | null): Promise<void>;
}

declare global {
  interface Window {
    vermilian: VermilianAPI;
  }
}

// Each YouTrack project's Priority values in its own bundle's order (VERM-92),
// for the All tasks Tracker priority sort. Read on the workspace's own
// connection — the same one its Runway tickets are read on — and never
// written. A project whose order cannot be read is left out (its tickets
// rank as unknown); [] means the project has no Priority field.
export interface YouTrackPriorityOrdersArgs {
  workspaceId: string;
  projectShortNames: string[];
}
export type PriorityOrdersResult =
  | { ok: true; orders: Record<string, string[]> }
  | { ok: false; error: string };
export type YouTrackPriorityOrdersResult = PriorityOrdersResult;

// Each Jira project's priority scheme order (VERM-93), for the Jira All tasks
// board's Tracker priority sort: read-only, through the workspace's own Jira
// provider, and only for its own projects and the projects of its Runway's
// Jira tickets. A project outside those, or whose order cannot be read, is
// left out.
export interface JiraPriorityOrdersArgs {
  workspaceId: string;
  projectKeys: string[];
}
