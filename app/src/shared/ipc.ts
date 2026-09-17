// Typed IPC contract shared by the main process, preload bridge, and renderer.
// The renderer never receives plaintext secrets; it calls these via
// `window.vermilian` (exposed by preload through contextBridge).

import type { AppConfig } from './config';
import type { BoardIssue, VermilianConfig, YouTrackProject } from './workspace';
import type { MasterPlanState, Outcome } from './masterPlan';

export const IPC = {
  getConfig: 'settings:getConfig',
  saveConfig: 'settings:saveConfig',
  credentialStatus: 'credentials:status',
  saveYouTrackToken: 'credentials:saveYouTrackToken',
  saveClaudeKey: 'credentials:saveClaudeKey',
  testYouTrack: 'youtrack:testConnection',
  getWorklogTypes: 'youtrack:getWorklogTypes',
  testClaude: 'claude:testKey',
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
  pickFolder: 'dialog:pickFolder',
  openUserData: 'app:openUserData',
  // Workspace / board
  getProjects: 'youtrack:getProjects',
  getWorkspaceConfig: 'workspace:getConfig',
  saveWorkspaceConfig: 'workspace:saveConfig',
  forceResyncWorkspaceConfig: 'workspace:forceResync',
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
} as const;

export interface CredentialStatus {
  hasYouTrackToken: boolean;
  hasClaudeKey: boolean;
  backend: string;
  secure: boolean;
}

export interface SaveSecretResult {
  ok: boolean;
  secure?: boolean; // true = encrypted via safeStorage; false = plain-text fallback (0o600 file)
  backend?: string;
}

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
  // e2e-only test hook (VERMILIAN_E2E=1) — reads back what
  // postRecommendationAudit actually posted, from the in-memory fake. The
  // main-process handler is registered only under the e2e harness; calling
  // this outside it rejects. Optional because it carries no production
  // behavior of its own.
  debugGetPostedComments?(): Promise<Array<{ issueId: string; text: string }>>;
}

declare global {
  interface Window {
    vermilian: VermilianAPI;
  }
}
