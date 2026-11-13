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
  pickFolder: 'dialog:pickFolder',
  openUserData: 'app:openUserData',
  // Workspace / board
  getProjects: 'youtrack:getProjects',
  getWorkspaceConfig: 'workspace:getConfig',
  saveWorkspaceConfig: 'workspace:saveConfig',
  forceResyncWorkspaceConfig: 'workspace:forceResync',
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
  applyWorkspaceMigration: 'workspaceMigration:apply',
  // Per-reference credentials (VERM-45, shared/credentialRefs.ts). Status,
  // configuration and saving only: a resolved credential never crosses IPC,
  // and nothing here touches the legacy YouTrack/Claude/Jira settings.
  listCredentialRefs: 'credentialRefs:list',
  setCredentialRefSources: 'credentialRefs:setSources',
  saveCredentialRefSecret: 'credentialRefs:saveSecret',
  clearCredentialRefSecret: 'credentialRefs:clearSecret',
  checkWorkspaceCredential: 'credentialRefs:check',
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
}

export interface SaveSecretResult {
  ok: boolean;
  secure?: boolean; // true = encrypted via safeStorage; false = plain-text fallback (0o600 file)
  backend?: string;
}

/** Result of changing a per-reference credential's configuration or blob (VERM-45). */
export type CredentialRefWriteResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'invalid-reference' | 'legacy-reference' | 'invalid-value' | 'encryption-unavailable' | 'write-failed';
    };

/** Whether a workspace's credential resolves on this host — never the value (VERM-45). */
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
  | { ok: true; kind: 'classic' | 'scoped'; cloudId: string; displayName: string }
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

export interface DailyReviewGetResult {
  ok: boolean;
  error?: string;
  // Present only when ok is true. Always the fixed active-workspace/48h
  // scope — see renderer/features/daily-review — never user-configurable.
  completed?: DailyReviewTask[];
}

export interface CreateIssueArgs {
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
}

export interface AiCreateTaskArgs {
  description: string;
  projects: { id: string; name: string }[];
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
}

export interface AiCreateTaskResult {
  ok: boolean;
  fields?: AiCreateTaskFields;
  error?: string;
}

export interface StandupGenerateArgs {
  scope: import('./config').StandupScope;
  window: import('./config').StandupWindow;
  customWindowHours?: number;
  customWorkspaceIds?: string[];
}

export interface StandupGenerateResult {
  ok: boolean;
  markdown?: string;
  taskCount?: number;
  error?: string;
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
  | { kind: 'version-too-high'; version: number };

// The surface exposed on `window.vermilian` by the preload bridge.
export interface VermilianAPI {
  getConfig(): Promise<AppConfig>;
  saveConfig(patch: Partial<AppConfig>): Promise<{ ok: boolean }>;
  credentialStatus(): Promise<CredentialStatus>;
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
  pickFolder(): Promise<string | null>;
  openUserData(): Promise<void>;
  // Workspace / board
  getProjects(): Promise<YouTrackProject[]>;
  getWorkspaceConfig(): Promise<VermilianConfig | null>;
  openExternalUrl(url: string): Promise<void>;
  saveWorkspaceConfig(config: VermilianConfig): Promise<{ ok: boolean }>;
  // Discards the local and in-memory workspace-config cache and re-fetches the
  // _vermilian-config Article from scratch, pruning any stale project ids in
  // the process. Manual recovery path for a corrupted shared Article.
  forceResyncWorkspaceConfig(): Promise<{ ok: boolean; error?: string }>;
  getIssues(args: GetIssuesArgs): Promise<BoardIssue[]>;
  searchIssues(args: SearchIssuesArgs): Promise<BoardIssue[]>;
  // Re-fetches and re-parses on every call — no persistent cache on either
  // side of this boundary. Refresh cadence is the renderer's own React
  // Query staleTime.
  getMasterPlan(): Promise<MasterPlanState>;
  // Issue CRUD
  getIssueDetail(issueId: string): Promise<import('./workspace').IssueDetail>;
  patchIssue(args: PatchIssueArgs): Promise<{ ok: boolean; error?: string }>;
  createIssue(args: CreateIssueArgs): Promise<CreateIssueResult>;
  deleteIssue(issueId: string): Promise<{ ok: boolean; error?: string }>;
  moveIssue(args: MoveIssueArgs): Promise<{ ok: boolean; error?: string }>;
  quitApp(): Promise<void>;
  // Priority Desk "Ask for recommendation" (VERM-8)
  getRecommendation(args: GetRecommendationArgs): Promise<GetRecommendationResult>;
  postRecommendationAudit(args: PostRecommendationAuditArgs): Promise<PostRecommendationAuditResult>;
  dailyReviewGet(): Promise<DailyReviewGetResult>;
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
  // Migration (VERM-44). plan is a dry run that writes nothing; apply re-reads
  // the source articles and creates the workspace articles that are missing.
  planWorkspaceMigration(options?: WorkspaceMigrationOptions): Promise<WorkspaceMigrationResult>;
  applyWorkspaceMigration(options?: WorkspaceMigrationOptions): Promise<WorkspaceMigrationResult>;
  listCredentialRefs(): Promise<CredentialRefStatus[]>;
  setCredentialRefSources(credentialRef: string, sources: CredentialSourceConfig): Promise<CredentialRefWriteResult>;
  saveCredentialRefSecret(credentialRef: string, value: string): Promise<CredentialRefWriteResult>;
  clearCredentialRefSecret(credentialRef: string): Promise<CredentialRefWriteResult>;
  checkWorkspaceCredential(workspaceId: string, credentialRef: string | null): Promise<WorkspaceCredentialCheck>;
  // e2e-only: the fake's _vermilian-config and Jira profile articles as stored.
  debugGetMigrationSources?(): Promise<Array<{ id: string; content: string; updated: number }>>;
}

declare global {
  interface Window {
    vermilian: VermilianAPI;
  }
}
