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
  type GetWorklogTypesArgs,
  type GetIssuesArgs,
  type SearchIssuesArgs,
  type PatchIssueArgs,
  type MoveIssueArgs,
  type CreateIssueArgs,
  type AiCreateTaskArgs,
  type StandupGenerateArgs,
  type StandupSaveArgs,
  type PostWorklogArgs,
  type TimerCheckpointData,
} from './shared/ipc';
import type { AppConfig } from './shared/config';
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
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  openUserData: () => ipcRenderer.invoke(IPC.openUserData),
  getProjects: () => ipcRenderer.invoke(IPC.getProjects),
  getWorkspaceConfig: () => ipcRenderer.invoke(IPC.getWorkspaceConfig),
  saveWorkspaceConfig: (config: VermilianConfig) =>
    ipcRenderer.invoke(IPC.saveWorkspaceConfig, config),
  getIssues: (args: GetIssuesArgs) => ipcRenderer.invoke(IPC.getIssues, args),
  searchIssues: (args: SearchIssuesArgs) => ipcRenderer.invoke(IPC.searchIssues, args),
  openExternalUrl: (url: string) => ipcRenderer.invoke(IPC.openExternalUrl, url),
  getIssueDetail: (issueId: string) => ipcRenderer.invoke(IPC.getIssueDetail, issueId),
  patchIssue: (args: PatchIssueArgs) => ipcRenderer.invoke(IPC.patchIssue, args),
  createIssue: (args: CreateIssueArgs) => ipcRenderer.invoke(IPC.createIssue, args),
  deleteIssue: (issueId: string) => ipcRenderer.invoke(IPC.deleteIssue, issueId),
  moveIssue: (args: MoveIssueArgs) => ipcRenderer.invoke(IPC.moveIssue, args),
  quitApp: () => ipcRenderer.invoke(IPC.quitApp),
};

contextBridge.exposeInMainWorld('vermilian', api);
