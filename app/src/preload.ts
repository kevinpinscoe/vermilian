// Preload bridge: the ONLY channel between renderer and main. Exposes a typed,
// promise-returning facade on window.vermilian via contextBridge. No ipcRenderer
// object is leaked to the renderer, and plaintext secrets never cross this line
// in the renderer→main direction beyond the save calls.

import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type VermilianAPI,
  type ConfigSyncStatus,
  type TestYouTrackArgs,
  type TestClaudeArgs,
  type TestJiraArgs,
  type GetWorklogTypesArgs,
  type GetIssuesArgs,
  type SearchIssuesArgs,
  type PatchIssueArgs,
  type RunwayGetArgs,
  type RunwayUpdateArgs,
  type MoveIssueArgs,
  type CreateIssueArgs,
  type AiCreateTaskArgs,
  type StandupGenerateArgs,
  type StandupSaveArgs,
  type PostWorklogArgs,
  type TimerCheckpointData,
  type GetRecommendationArgs,
  type PostRecommendationAuditArgs,
} from './shared/ipc';
import type { AppConfig } from './shared/config';
import type { JiraProfile } from './shared/jiraProfile';
import type { WorkspaceDocument } from './shared/workspaceSchema';
import type { WorkspaceMigrationOptions } from './shared/workspaceMigration';
import type { VermilianConfig } from './shared/workspace';

const api: VermilianAPI = {
  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  saveConfig: (patch: Partial<AppConfig>) => ipcRenderer.invoke(IPC.saveConfig, patch),
  credentialStatus: () => ipcRenderer.invoke(IPC.credentialStatus),
  saveYouTrackToken: (token: string) => ipcRenderer.invoke(IPC.saveYouTrackToken, token),
  saveClaudeKey: (key: string) => ipcRenderer.invoke(IPC.saveClaudeKey, key),
  testYouTrack: (args: TestYouTrackArgs) => ipcRenderer.invoke(IPC.testYouTrack, args),
  getWorklogTypes: (args: GetWorklogTypesArgs) => ipcRenderer.invoke(IPC.getWorklogTypes, args),
  testClaude: (args: TestClaudeArgs) => ipcRenderer.invoke(IPC.testClaude, args),
  getJiraProfile: () => ipcRenderer.invoke(IPC.getJiraProfile),
  saveJiraProfile: (profile: Partial<JiraProfile>) => ipcRenderer.invoke(IPC.saveJiraProfile, profile),
  saveJiraToken: (token: string) => ipcRenderer.invoke(IPC.saveJiraToken, token),
  testJira: (args: TestJiraArgs) => ipcRenderer.invoke(IPC.testJira, args),
  listMyJiraIssues: () => ipcRenderer.invoke(IPC.listMyJiraIssues),
  aiCreateTask: (args: AiCreateTaskArgs) => ipcRenderer.invoke(IPC.aiCreateTask, args),
  standupGenerate: (args: StandupGenerateArgs) => ipcRenderer.invoke(IPC.standupGenerate, args),
  standupSave: (args: StandupSaveArgs) => ipcRenderer.invoke(IPC.standupSave, args),
  timerPostWorklog: (args: PostWorklogArgs) => ipcRenderer.invoke(IPC.timerPostWorklog, args),
  timerCheckpoint: (data: TimerCheckpointData) => ipcRenderer.invoke(IPC.timerCheckpoint, data),
  timerClearCheckpoint: () => ipcRenderer.invoke(IPC.timerClearCheckpoint),
  timerReadCheckpoint: (): Promise<TimerCheckpointData | null> =>
    ipcRenderer.invoke(IPC.timerReadCheckpoint),
  timerSetQuitProtection: (active: boolean) =>
    ipcRenderer.invoke(IPC.timerSetQuitProtection, active),
  timerProceedQuit: () => ipcRenderer.invoke(IPC.timerProceedQuit),
  onQuitRequested: (callback: () => void) => {
    ipcRenderer.removeAllListeners('timer:quit-requested');
    ipcRenderer.on('timer:quit-requested', () => callback());
  },
  onConfigSynced: (callback: () => void) => {
    ipcRenderer.removeAllListeners('config:article-synced');
    ipcRenderer.on('config:article-synced', () => callback());
  },
  onSyncStatus: (callback: (status: ConfigSyncStatus) => void) => {
    ipcRenderer.removeAllListeners('config:sync-status');
    ipcRenderer.on('config:sync-status', (_e, status: ConfigSyncStatus) => callback(status));
  },
  getBoardConfig: (projectId: string) => ipcRenderer.invoke(IPC.getBoardConfig, projectId),
  saveBoardConfig: (config: unknown) => ipcRenderer.invoke(IPC.saveBoardConfig, config),
  resetBoardConfig: (projectId: string) => ipcRenderer.invoke(IPC.resetBoardConfig, projectId),
  getDismissals: () => ipcRenderer.invoke(IPC.getDismissals),
  saveDismissal: (entry: unknown) => ipcRenderer.invoke(IPC.saveDismissal, entry),
  runwayGet: (args: RunwayGetArgs) => ipcRenderer.invoke(IPC.runwayGet, args),
  runwayUpdate: (args: RunwayUpdateArgs) => ipcRenderer.invoke(IPC.runwayUpdate, args),
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  openUserData: () => ipcRenderer.invoke(IPC.openUserData),
  getProjects: () => ipcRenderer.invoke(IPC.getProjects),
  getWorkspaceConfig: () => ipcRenderer.invoke(IPC.getWorkspaceConfig),
  saveWorkspaceConfig: (config: VermilianConfig) =>
    ipcRenderer.invoke(IPC.saveWorkspaceConfig, config),
  forceResyncWorkspaceConfig: () => ipcRenderer.invoke(IPC.forceResyncWorkspaceConfig),
  getIssues: (args: GetIssuesArgs) => ipcRenderer.invoke(IPC.getIssues, args),
  searchIssues: (args: SearchIssuesArgs) => ipcRenderer.invoke(IPC.searchIssues, args),
  getMasterPlan: () => ipcRenderer.invoke(IPC.getMasterPlan),
  openExternalUrl: (url: string) => ipcRenderer.invoke(IPC.openExternalUrl, url),
  getIssueDetail: (issueId: string) => ipcRenderer.invoke(IPC.getIssueDetail, issueId),
  patchIssue: (args: PatchIssueArgs) => ipcRenderer.invoke(IPC.patchIssue, args),
  createIssue: (args: CreateIssueArgs) => ipcRenderer.invoke(IPC.createIssue, args),
  deleteIssue: (issueId: string) => ipcRenderer.invoke(IPC.deleteIssue, issueId),
  moveIssue: (args: MoveIssueArgs) => ipcRenderer.invoke(IPC.moveIssue, args),
  quitApp: () => ipcRenderer.invoke(IPC.quitApp),
  getRecommendation: (args: GetRecommendationArgs) => ipcRenderer.invoke(IPC.getRecommendation, args),
  postRecommendationAudit: (args: PostRecommendationAuditArgs) =>
    ipcRenderer.invoke(IPC.postRecommendationAudit, args),
  dailyReviewGet: () => ipcRenderer.invoke(IPC.dailyReviewGet),
  debugGetPostedComments: () => ipcRenderer.invoke('e2e:getPostedComments'),
  listWorkspaceArticles: () => ipcRenderer.invoke(IPC.listWorkspaceArticles),
  readWorkspaceArticle: (workspaceId: string) => ipcRenderer.invoke(IPC.readWorkspaceArticle, workspaceId),
  createWorkspaceArticle: (doc: WorkspaceDocument) => ipcRenderer.invoke(IPC.createWorkspaceArticle, doc),
  updateWorkspaceArticle: (base: WorkspaceDocument, edited: WorkspaceDocument) =>
    ipcRenderer.invoke(IPC.updateWorkspaceArticle, base, edited),
  debugGetWorkspaceArticles: () => ipcRenderer.invoke('e2e:getWorkspaceArticles'),
  debugWriteWorkspaceArticle: (articleId: string, content: string) =>
    ipcRenderer.invoke('e2e:writeWorkspaceArticle', articleId, content),
  planWorkspaceMigration: (options?: WorkspaceMigrationOptions) => ipcRenderer.invoke(IPC.planWorkspaceMigration, options),
  applyWorkspaceMigration: (options?: WorkspaceMigrationOptions) => ipcRenderer.invoke(IPC.applyWorkspaceMigration, options),
  debugGetMigrationSources: () => ipcRenderer.invoke('e2e:getMigrationSources'),
};

contextBridge.exposeInMainWorld('vermilian', api);
