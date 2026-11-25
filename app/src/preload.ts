// Preload bridge: the ONLY channel between renderer and main. Exposes a typed,
// promise-returning facade on window.vermilian via contextBridge. No ipcRenderer
// object is leaked to the renderer, and plaintext secrets never cross this line
// in the renderer→main direction beyond the save calls.

import type { RunwayAddByReferenceArgs } from './shared/runwayAdd';
import type { RunwayImportApplyArgs, RunwayImportMatchArgs } from './shared/runwayImport';
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
  type DailyReviewGetArgs,
  type RunwayGetArgs,
  type RunwayUpdateArgs,
  type RunwayListArgs,
  type RunwayImportConfirmArgs,
  type RunwayItemsAddIssueArgs,
  type RunwayItemsAddIssueAtNumberArgs,
  type RunwayItemsAddStructuralArgs,
  type RunwayItemsItemArgs,
  type RunwayItemsListArgs,
  type YouTrackPriorityOrdersArgs,
  type JiraPriorityOrdersArgs,
  type RunwayItemsMoveArgs,
  type RunwayItemsAddIssueAboveArgs,
  type RunwayItemsMoveAboveArgs,
  type RunwayItemsMoveToNumberArgs,
  type MoveIssueArgs,
  type CreateIssueArgs,
  type CreateFieldOptionsArgs,
  type ProjectFieldValuesArgs,
  type AiCreateTaskArgs,
  type StandupGenerateArgs,
  type StandupSaveArgs,
  type PostWorklogArgs,
  type TimerCheckpointData,
  type GetRecommendationArgs,
  type PostRecommendationAuditArgs,
  type GetWorkspaceJiraIssuesArgs,
  type GetWorkspaceJiraRecentlyUpdatedArgs,
  type GetWorkspaceJiraIssueDetailArgs,
  type SearchWorkspaceJiraIssuesArgs,
} from './shared/ipc';
import type { AppConfig } from './shared/config';
import type { JiraProfile } from './shared/jiraProfile';
import type { WorkspaceDocument } from './shared/workspaceSchema';
import type { WorkspaceMigrationOptions } from './shared/workspaceMigration';
import type { CredentialSourceConfig } from './shared/credentialRefs';
import type { OpenBaoConnection, OpenBaoScope } from './shared/openbao';
import type { VermilianConfig } from './shared/workspace';

const api: VermilianAPI = {
  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  saveConfig: (patch: Partial<AppConfig>) => ipcRenderer.invoke(IPC.saveConfig, patch),
  credentialStatus: () => ipcRenderer.invoke(IPC.credentialStatus),
  encryptPlaintextCredentials: () => ipcRenderer.invoke(IPC.encryptPlaintextCredentials),
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
  runwayList: (args: RunwayListArgs) => ipcRenderer.invoke(IPC.runwayList, args),
  runwayExportSnapshot: () => ipcRenderer.invoke(IPC.runwayExportSnapshot),
  runwayImportPreview: () => ipcRenderer.invoke(IPC.runwayImportPreview),
  runwayImportConfirm: (args: RunwayImportConfirmArgs) => ipcRenderer.invoke(IPC.runwayImportConfirm, args),
  runwayImportCancel: (args: RunwayImportConfirmArgs) => ipcRenderer.invoke(IPC.runwayImportCancel, args),
  runwayItemsList: (args: RunwayItemsListArgs) => ipcRenderer.invoke(IPC.runwayItemsList, args),
  runwayItemsAddIssue: (args: RunwayItemsAddIssueArgs) => ipcRenderer.invoke(IPC.runwayItemsAddIssue, args),
  runwayItemsAddIssueAtNumber: (args: RunwayItemsAddIssueAtNumberArgs) =>
    ipcRenderer.invoke(IPC.runwayItemsAddIssueAtNumber, args),
  runwayItemsAddSection: (args: RunwayItemsAddStructuralArgs) => ipcRenderer.invoke(IPC.runwayItemsAddSection, args),
  runwayItemsAddNote: (args: RunwayItemsAddStructuralArgs) => ipcRenderer.invoke(IPC.runwayItemsAddNote, args),
  runwayItemsRemove: (args: RunwayItemsItemArgs) => ipcRenderer.invoke(IPC.runwayItemsRemove, args),
  runwayItemsMove: (args: RunwayItemsMoveArgs) => ipcRenderer.invoke(IPC.runwayItemsMove, args),
  runwayItemsAddIssueAbove: (args: RunwayItemsAddIssueAboveArgs) => ipcRenderer.invoke(IPC.runwayItemsAddIssueAbove, args),
  runwayItemsMoveAbove: (args: RunwayItemsMoveAboveArgs) => ipcRenderer.invoke(IPC.runwayItemsMoveAbove, args),
  runwayItemsMoveToNumber: (args: RunwayItemsMoveToNumberArgs) => ipcRenderer.invoke(IPC.runwayItemsMoveToNumber, args),
  runwayItemsMoveUp: (args: RunwayItemsItemArgs) => ipcRenderer.invoke(IPC.runwayItemsMoveUp, args),
  runwayItemsMoveDown: (args: RunwayItemsItemArgs) => ipcRenderer.invoke(IPC.runwayItemsMoveDown, args),
  runwayItemsResolve: (args: RunwayItemsListArgs) => ipcRenderer.invoke(IPC.runwayItemsResolve, args),
  youtrackPriorityOrders: (args: YouTrackPriorityOrdersArgs) => ipcRenderer.invoke(IPC.youtrackPriorityOrders, args),
  workspaceLinkTypes: (workspaceId: string) => ipcRenderer.invoke(IPC.workspaceLinkTypes, workspaceId),
  jiraPriorityOrders: (args: JiraPriorityOrdersArgs) => ipcRenderer.invoke(IPC.jiraPriorityOrders, args),
  runwayItemsAddByReference: (args: RunwayAddByReferenceArgs) => ipcRenderer.invoke(IPC.runwayItemsAddByReference, args),
  runwayImportMatch: (args: RunwayImportMatchArgs) => ipcRenderer.invoke(IPC.runwayImportMatch, args),
  runwayMarkdownOpen: () => ipcRenderer.invoke(IPC.runwayMarkdownOpen),
  runwayMarkdownApply: (args: RunwayImportApplyArgs) => ipcRenderer.invoke(IPC.runwayMarkdownApply, args),
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  openUserData: () => ipcRenderer.invoke(IPC.openUserData),
  getProjects: () => ipcRenderer.invoke(IPC.getProjects),
  getWorkspaceConfig: () => ipcRenderer.invoke(IPC.getWorkspaceConfig),
  saveWorkspaceConfig: (config: VermilianConfig) =>
    ipcRenderer.invoke(IPC.saveWorkspaceConfig, config),
  deleteWorkspace: (workspaceId: string, destinationId: string | null) =>
    ipcRenderer.invoke(IPC.deleteWorkspace, workspaceId, destinationId),
  getActiveWorkspace: () => ipcRenderer.invoke(IPC.getActiveWorkspace),
  setActiveWorkspace: (workspaceId: string) => ipcRenderer.invoke(IPC.setActiveWorkspace, workspaceId),
  forceResyncWorkspaceConfig: () => ipcRenderer.invoke(IPC.forceResyncWorkspaceConfig),
  getIssues: (args: GetIssuesArgs) => ipcRenderer.invoke(IPC.getIssues, args),
  searchIssues: (args: SearchIssuesArgs) => ipcRenderer.invoke(IPC.searchIssues, args),
  getMasterPlan: (workspaceId?: string) => ipcRenderer.invoke(IPC.getMasterPlan, workspaceId),
  openExternalUrl: (url: string) => ipcRenderer.invoke(IPC.openExternalUrl, url),
  getIssueDetail: (issueId: string) => ipcRenderer.invoke(IPC.getIssueDetail, issueId),
  patchIssue: (args: PatchIssueArgs) => ipcRenderer.invoke(IPC.patchIssue, args),
  createIssue: (args: CreateIssueArgs) => ipcRenderer.invoke(IPC.createIssue, args),
  getCreateFieldOptions: (args: CreateFieldOptionsArgs) => ipcRenderer.invoke(IPC.getCreateFieldOptions, args),
  getProjectFieldValues: (args: ProjectFieldValuesArgs) => ipcRenderer.invoke(IPC.getProjectFieldValues, args),
  deleteIssue: (issueId: string) => ipcRenderer.invoke(IPC.deleteIssue, issueId),
  moveIssue: (args: MoveIssueArgs) => ipcRenderer.invoke(IPC.moveIssue, args),
  quitApp: () => ipcRenderer.invoke(IPC.quitApp),
  getRecommendation: (args: GetRecommendationArgs) => ipcRenderer.invoke(IPC.getRecommendation, args),
  postRecommendationAudit: (args: PostRecommendationAuditArgs) =>
    ipcRenderer.invoke(IPC.postRecommendationAudit, args),
  dailyReviewGet: (args: DailyReviewGetArgs) => ipcRenderer.invoke(IPC.dailyReviewGet, args),
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
  getStorageStatus: () => ipcRenderer.invoke(IPC.getStorageStatus),
  activateWorkspaceStorage: (args: { confirmed: boolean; jiraWorkspaceName?: string | null }) =>
    ipcRenderer.invoke(IPC.activateWorkspaceStorage, args),
  returnToLegacyStorage: (args: { confirmed: boolean }) => ipcRenderer.invoke(IPC.returnToLegacyStorage, args),
  listCredentialRefs: () => ipcRenderer.invoke(IPC.listCredentialRefs),
  setCredentialRefSources: (credentialRef: string, sources: CredentialSourceConfig) =>
    ipcRenderer.invoke(IPC.setCredentialRefSources, credentialRef, sources),
  saveCredentialRefSecret: (credentialRef: string, value: string) =>
    ipcRenderer.invoke(IPC.saveCredentialRefSecret, credentialRef, value),
  clearCredentialRefSecret: (credentialRef: string) => ipcRenderer.invoke(IPC.clearCredentialRefSecret, credentialRef),
  checkWorkspaceCredential: (workspaceId: string, credentialRef: string | null) =>
    ipcRenderer.invoke(IPC.checkWorkspaceCredential, workspaceId, credentialRef),
  getCredentialRefStatus: (credentialRef: string) => ipcRenderer.invoke(IPC.getCredentialRefStatus, credentialRef),
  openbaoGetState: (scope: OpenBaoScope) => ipcRenderer.invoke(IPC.openbaoGetState, scope),
  openbaoSaveConnection: (scope: OpenBaoScope, connection: OpenBaoConnection) =>
    ipcRenderer.invoke(IPC.openbaoSaveConnection, scope, connection),
  openbaoTest: (scope: OpenBaoScope) => ipcRenderer.invoke(IPC.openbaoTest, scope),
  openbaoMigrate: (scope: OpenBaoScope, credentialRefs: string[]) => ipcRenderer.invoke(IPC.openbaoMigrate, scope, credentialRefs),
  openbaoSaveSecret: (scope: OpenBaoScope, credentialRef: string, value: string) =>
    ipcRenderer.invoke(IPC.openbaoSaveSecret, scope, credentialRef, value),
  openbaoDeleteSecret: (scope: OpenBaoScope, credentialRef: string, args: { confirmed: boolean }) =>
    ipcRenderer.invoke(IPC.openbaoDeleteSecret, scope, credentialRef, args),
  openbaoDeactivate: (scope: OpenBaoScope, credentialRef: string) => ipcRenderer.invoke(IPC.openbaoDeactivate, scope, credentialRef),
  openbaoCleanupOriginal: (scope: OpenBaoScope, credentialRef: string, args: { confirmed: boolean }) =>
    ipcRenderer.invoke(IPC.openbaoCleanupOriginal, scope, credentialRef, args),
  listWorkspaceJiraProjects: (workspaceId: string) => ipcRenderer.invoke(IPC.listWorkspaceJiraProjects, workspaceId),
  listWorkspaceJiraStatuses: (workspaceId: string) => ipcRenderer.invoke(IPC.listWorkspaceJiraStatuses, workspaceId),
  getWorkspaceJiraIssues: (args: GetWorkspaceJiraIssuesArgs) => ipcRenderer.invoke(IPC.getWorkspaceJiraIssues, args),
  getWorkspaceJiraRecentlyUpdated: (args: GetWorkspaceJiraRecentlyUpdatedArgs) =>
    ipcRenderer.invoke(IPC.getWorkspaceJiraRecentlyUpdated, args),
  getWorkspaceJiraIssueDetail: (args: GetWorkspaceJiraIssueDetailArgs) =>
    ipcRenderer.invoke(IPC.getWorkspaceJiraIssueDetail, args),
  listWorkspaceJiraBoards: (workspaceId: string) => ipcRenderer.invoke(IPC.listWorkspaceJiraBoards, workspaceId),
  searchWorkspaceJiraIssues: (args: SearchWorkspaceJiraIssuesArgs) =>
    ipcRenderer.invoke(IPC.searchWorkspaceJiraIssues, args),
  getWorkspaceJiraMyAccountId: (workspaceId: string) =>
    ipcRenderer.invoke(IPC.getWorkspaceJiraMyAccountId, workspaceId),
  debugGetMigrationSources: () => ipcRenderer.invoke('e2e:getMigrationSources'),
  debugWriteConfigArticle: (content: string) => ipcRenderer.invoke('e2e:writeConfigArticle', content),
  debugFailConfigWrites: (n: number) => ipcRenderer.invoke('e2e:failConfigWrites', n),
  debugFailWorkspaceWrites: (n: number) => ipcRenderer.invoke('e2e:failWorkspaceWrites', n),
  debugJiraChange: (change: unknown) => ipcRenderer.invoke('e2e:jiraChange', change),
  debugGetJiraCalls: () => ipcRenderer.invoke('e2e:jiraCalls'),
  debugSetJiraSearchDelay: (ms: number) => ipcRenderer.invoke('e2e:jiraSearchDelay', ms),
  debugSetJiraGetIssueDelay: (ms: number) => ipcRenderer.invoke('e2e:jiraGetIssueDelay', ms),
  debugGetClaudeCalls: () => ipcRenderer.invoke('e2e:claudeCalls'),
  debugGetStandupQueries: () => ipcRenderer.invoke('e2e:standupQueries'),
  debugGetStandupCredentialRefs: () => ipcRenderer.invoke('e2e:standupCredentialRefs'),
  debugGetArticleFetches: () => ipcRenderer.invoke('e2e:articleFetches'),
  debugSetArticleDelay: (ms: number) => ipcRenderer.invoke('e2e:articleDelay', ms),
  debugSetStandupDelay: (ms: number, project?: string) => ipcRenderer.invoke('e2e:standupDelay', ms, project),
  debugSetArticle: (articleId: string, value: unknown) => ipcRenderer.invoke('e2e:setArticle', articleId, value),
  debugGetCreateRequests: () => ipcRenderer.invoke('e2e:createRequests'),
  debugGetFieldMetadataRequests: () => ipcRenderer.invoke('e2e:fieldMetadataRequests'),
  debugSetClaudeExtractDelay: (ms: number) => ipcRenderer.invoke('e2e:claudeExtractDelay', ms),
  debugSetNextCreateError: (message: string | null) => ipcRenderer.invoke('e2e:nextCreateError', message),
  debugSetFieldMetadataDelay: (ms: number, project?: string) => ipcRenderer.invoke('e2e:fieldMetadataDelay', ms, project),
  debugFailFieldMetadata: (n: number, project?: string) => ipcRenderer.invoke('e2e:failFieldMetadata', n, project),
  debugHoldFieldMetadata: (project: string) => ipcRenderer.invoke('e2e:holdFieldMetadata', project),
  debugReleaseFieldMetadata: () => ipcRenderer.invoke('e2e:releaseFieldMetadata'),
  debugGetPatchRequests: () => ipcRenderer.invoke('e2e:getPatchRequests'),
  debugSetProjectField: (project: string, field: string, values: string[] | null) => ipcRenderer.invoke('e2e:setProjectField', project, field, values),
};

contextBridge.exposeInMainWorld('vermilian', api);
