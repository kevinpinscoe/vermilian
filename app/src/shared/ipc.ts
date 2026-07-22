// Typed IPC contract shared by the main process, preload bridge, and renderer.
// The renderer never receives plaintext secrets; it calls these via
// `window.vermilian` (exposed by preload through contextBridge).

import type { AppConfig } from './config';
import type { BoardIssue, VermilianConfig, YouTrackProject } from './workspace';

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
  pickFolder: 'dialog:pickFolder',
  openUserData: 'app:openUserData',
  // Workspace / board
  getProjects: 'youtrack:getProjects',
  getWorkspaceConfig: 'workspace:getConfig',
  saveWorkspaceConfig: 'workspace:saveConfig',
  getIssues: 'youtrack:getIssues',
  openExternalUrl: 'shell:openExternalUrl',
  quitApp: 'app:quit',
  // Issue CRUD
  getIssueDetail: 'youtrack:getIssueDetail',
  patchIssue: 'youtrack:patchIssue',
  createIssue: 'youtrack:createIssue',
  deleteIssue: 'youtrack:deleteIssue',
  moveIssue: 'youtrack:moveIssue',
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

export interface PatchIssueArgs {
  issueId: string;
  field: string;
  value: string | number | null;
}

export interface MoveIssueArgs {
  issueId: string;
  targetProjectId: string;
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
  pickFolder(): Promise<string | null>;
  openUserData(): Promise<void>;
  // Workspace / board
  getProjects(): Promise<YouTrackProject[]>;
  getWorkspaceConfig(): Promise<VermilianConfig | null>;
  openExternalUrl(url: string): Promise<void>;
  saveWorkspaceConfig(config: VermilianConfig): Promise<{ ok: boolean }>;
  getIssues(args: GetIssuesArgs): Promise<BoardIssue[]>;
  // Issue CRUD
  getIssueDetail(issueId: string): Promise<import('./workspace').IssueDetail>;
  patchIssue(args: PatchIssueArgs): Promise<{ ok: boolean; error?: string }>;
  createIssue(args: CreateIssueArgs): Promise<CreateIssueResult>;
  deleteIssue(issueId: string): Promise<{ ok: boolean; error?: string }>;
  moveIssue(args: MoveIssueArgs): Promise<{ ok: boolean; error?: string }>;
  quitApp(): Promise<void>;
}

declare global {
  interface Window {
    vermilian: VermilianAPI;
  }
}
