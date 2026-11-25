import { ipcMain, dialog, shell, app, BrowserWindow } from 'electron';
import type { TrackerLinkTypesResult } from '../shared/workspacePrerequisites';
import type { StandupWorkspace } from '../shared/standup';
import { generateWorkspaceStandup, getWorkspaceDailyReview, type WorkspaceReportSourceDeps } from './services/workspaceStandup';
import { randomUUID } from 'node:crypto';
import { NO_WORKSPACE_MESSAGE, resolveWorkspaceYouTrackConnection } from './services/workspaceYouTrack';
import {
  activateWorkspaceStorage,
  authorizeConfigWrite,
  returnToLegacyStorage,
  storageStatus,
  type ActivationDeps,
  type StorageActivationClient,
} from './services/storageActivation';
import {
  type ActivationResult,
  type RollbackResult,
  type StorageGuard,
  type StorageStatusView,
} from '../shared/storageActivation';
import { planLayoutWrites, planWorkspaceDelete } from '../shared/workspaceLayout';
import { e2eFakeCredentialAllowed } from '../shared/e2eFakeCredentials';
import type { ConfigSyncStatus } from '../shared/ipc';
import {
  IPC,
  type CredentialStatus,
  type CredentialKind,
  type EncryptPlaintextResult,
  type SaveSecretResult,
  type CredentialRefWriteResult,
  type WorkspaceCredentialCheck,
  type TestYouTrackArgs,
  type TestYouTrackResult,
  type TestClaudeArgs,
  type TestClaudeResult,
  type SaveJiraProfileResult,
  type TestJiraArgs,
  type TestJiraResult,
  type ListJiraIssuesResult,
  type GetWorklogTypesArgs,
  type GetIssuesArgs,
  type SearchIssuesArgs,
  type PatchIssueArgs,
  type RunwayGetArgs,
  type RunwayUpdateArgs,
  type RunwayResult,
  type RunwayListArgs,
  type RunwayListResult,
  type RunwayExportSnapshotResult,
  type RunwayImportPreviewResult,
  type RunwayImportConfirmArgs,
  type RunwayImportConfirmResult,
  type MoveIssueArgs,
  type CreateIssueArgs,
  type CreateIssueResult,
  type CreateFieldOptionsArgs,
  type CreateFieldOptionsResult,
  type ProjectFieldValuesArgs,
  type ProjectFieldValuesResult,
  type AiCreateTaskArgs,
  type AiCreateTaskResult,
  type StandupGenerateArgs,
  type StandupGenerateResult,
  type StandupSaveArgs,
  type StandupSaveResult,
  type PostWorklogArgs,
  type PostWorklogResult,
  type TimerCheckpointData,
  type GetRecommendationArgs,
  type GetRecommendationResult,
  type PostRecommendationAuditArgs,
  type PostRecommendationAuditResult,
  type DailyReviewGetArgs,
  type DailyReviewGetResult,
} from '../shared/ipc';
import { maybeBuildAuditComment } from '../shared/recommendationAudit';
import * as fakeYouTrackForE2E from './api/fakeYouTrack';
import { createPriorityOrders } from './services/priorityOrders';
import { createTaskService, AI_CREATE_WORKSPACE_CHANGED_MESSAGE } from './services/createTask';
import { runwayWorkspaceTracker } from '../shared/runwayItem';
import type { AppConfig } from '../shared/config';
import { pruneStaleProjectIds, type VermilianConfig } from '../shared/workspace';
import { readConfig, writeConfig } from './services/config';
import {
  saveSecret,
  loadSecretWithSources,
  hasSecretWithSources,
  resolveLegacySecret,
  legacySecretStorage,
  encryptPlaintextSecrets,
  credentialSourceIO,
  openBaoClient,
  clearLegacySecret,
  saveCredentialRefSecret,
  clearCredentialRefSecret,
  listCredentialRefBlobs,
  getBackend,
  isSecure,
  FILES,
} from './services/credentials';
import { readWorkspaceConfig, writeWorkspaceConfig } from './services/workspaceConfig';
import {
  readStoredActiveWorkspaceId,
  writeStoredActiveWorkspaceId,
  activeWorkspaceGeneration,
  workspaceStorageMode,
  readLocalStorageState,
  writeLocalStorageState,
  writeActivationBackup,
  readActivationBackup,
} from './services/activeWorkspace';
import {
  backendContextOf,
  buildActiveContext,
  resolveActiveWorkspaceId,
  workspacesFromDocuments,
  type ActiveWorkspaceContext,
  type SetActiveWorkspaceResult,
  type WorkspaceChoice,
  type WorkspaceStorageMode,
} from '../shared/activeWorkspace';
import { MIGRATED_YOUTRACK_CREDENTIAL_REF } from '../shared/workspaceMigration';
import { youtrack } from './api/client';
import { createYouTrackProvider, type YouTrackProvider } from './providers/youtrackProvider';
import { IS_E2E } from './e2e';
import { claude } from './api/claudeClient';
import * as standupService from './services/standup';
import * as checkpoint from './services/timerCheckpoint';
import * as articleConfig from './services/articleConfig';
import { getActiveWorkspaceMasterPlan, getMasterPlanState } from './services/masterPlan';
import type { MasterPlanState } from '../shared/masterPlan';
import * as jiraProfile from './services/jiraProfile';
import * as workspaceArticles from './services/workspaceArticles';
import type { WorkspaceArticleClient } from './services/workspaceArticles';
import { youtrackStorageActivationClient, youtrackWorkspaceArticleClient, youtrackWorkspaceMigrationClient } from './api/workspaceArticleClient';
import * as workspaceMigration from './services/workspaceMigration';
import { checkWorkspaceCredential, credentialRefStatus, resolveWorkspaceCredential } from './services/credentialResolver';
import { aiCredentialRefOf, e2eFakeAnthropicKeyAllowed } from '../shared/workspaceAi';
import { beginWorkspaceAiOperation, type WorkspaceAiOperation } from './services/workspaceAiKey';
import { createJiraProvider, type JiraProvider } from './providers/jiraProvider';
import { backendChangeProblem } from '../shared/workspaceSetup';
import type {
  CredentialRefStatusResult,
  GetWorkspaceJiraIssueDetailResult,
  SearchWorkspaceJiraIssuesResult,
  ListWorkspaceJiraBoardsResult,
  GetWorkspaceJiraMyAccountIdResult,
  GetWorkspaceJiraIssuesResult,
  GetWorkspaceJiraRecentlyUpdatedResult,
  ListWorkspaceJiraProjectsResult,
  ListWorkspaceJiraStatusesResult,
} from '../shared/ipc';
import {
  LEGACY_CREDENTIAL_REFS,
  isLegacyCredentialRef,
  blobFilenameFor,
  checkCredentialValue,
  legacyRefForBlob,
  openBaoSourceFor,
  selectSource,
  sourcesFor,
  type CredentialRefStatus,
} from '../shared/credentialRefs';
import {
  OPENBAO_REASON_TEXT,
  SETTINGS_SCOPE_ID,
  checkOpenBaoConnection,
  defaultOpenBaoBinding,
  describeOpenBaoTest,
  sanitiseOpenBaoScopes,
  type OpenBaoConnection,
  type OpenBaoMigrationResult,
  type OpenBaoReferenceState,
  type OpenBaoScope,
  type OpenBaoScopeConfig,
  type OpenBaoScopeState,
  type OpenBaoTestResult,
  type OpenBaoWriteResult,
} from '../shared/openbao';
import { cleanupBlocker, migrateToOpenBao } from './services/openbaoMigration';
import { isCredentialRef, workspaceBoardIds, workspaceProjectIds, type CredentialRef } from '../shared/workspaceSchema';
import { isJiraIssueKey, jiraProjectKeyOf } from '../shared/jiraBoardIssue';
import { e2eFakeJiraTokenAllowed, isJiraUnauthorized, type WorkspaceJiraFailure } from '../shared/jiraConnection';
import type { WorkspaceMigrationOptions, WorkspaceMigrationResult } from '../shared/workspaceMigration';
import type {
  ListWorkspaceArticlesResult,
  ReadWorkspaceArticleResult,
  SaveWorkspaceArticleResult,
  WorkspaceDiscoveryFailure,
} from '../shared/workspaceArticle';
import type { WorkspaceDocument } from '../shared/workspaceSchema';
import { jira } from './api/jiraClient';
import { FAKE_JIRA_BAD_TOKEN } from './api/fakeJira';
import * as fakeJiraForE2E from './api/fakeJira';
import * as fakeClaudeForE2E from './api/fakeClaude';
import { normaliseJiraProfile, type JiraProfile } from '../shared/jiraProfile';
import { jiraIssueUrl, toJiraIssueRow } from '../shared/jiraIssue';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openRunwayDb, RUNWAY_DB_FILENAME } from './services/runwayDb';
import { defaultSnapshotFileName, exportRunwaySnapshot, runwayRowCounts } from './services/runwaySnapshot';
import {
  RUNWAY_BACKUP_DIRNAME,
  RUNWAY_IMPORT_STAGING_DIRNAME,
  RunwayImportError,
  RunwayWriteGate,
  importRunwaySnapshot,
  runwayImportWarnings,
} from './services/runwayImport';
import { RunwayImportSession } from './services/runwayImportSession';
import {
  createJiraRunwayStore,
  createYouTrackRunwayStore,
  storeForIssue,
  type JiraRunwayMetadataStore,
  type RunwayStores,
} from './services/runwayStore';
import { createRunwayItemStore, type RunwayItemStore } from './services/runwayItemStore';
import { createRunwayItemHandlers } from './services/runwayItemIpc';
import { createRunwayAddByReference } from './services/runwayAddByReference';
import { createRunwayImportMatch } from './services/runwayImportMatch';
import { readRunwayMarkdownFile } from './services/runwayMarkdownFile';
import { RUNWAY_MARKDOWN_EXTENSIONS, type RunwayMarkdownOpenResult } from '../shared/runwayImport';
import {
  createRunwayTicketFetch,
  jiraRunwayReader,
  youtrackRunwayReader,
  type RunwayReaderResult,
} from './services/runwayTicketFetch';
import { jiraRunwayLookup, readAdmittedJiraIssue, type JiraAdmissionScope } from './providers/jiraAdmission';
import type { NamespacedIssueId, TrackerKind } from '../shared/tracker';
import { defaultBoardConfig, dismissalKey, type BoardConfig, type Dismissals, type NotThisWeekDismissal } from '../shared/boardConfig';

// Quit-protection state (set by renderer when timer is running).
let quitProtected = false;

export function isQuitProtected(): boolean {
  return quitProtected;
}

export function forceQuit(): void {
  quitProtected = false; // allow the quit to proceed without interception
  app.quit();
}

// Fixed, not configurable — PLAN.md "Scope and window — fixed, not
// configurable". Matches Stand-up's own default window.
const DAILY_REVIEW_COMPLETED_WINDOW_HOURS = 48;

export function sendQuitRequested(): void {
  BrowserWindow.getAllWindows()[0]?.webContents.send('timer:quit-requested');
}

// Every YouTrack tracker call goes through the TrackerProvider binding
// (VERM-27): the client is unchanged, and `youtrack` is still the e2e fake
// under VERMILIAN_E2E.
function youtrackTracker(url: string, token: string): YouTrackProvider {
  return createYouTrackProvider(youtrack, url, token);
}

// Helpers — load credentials via the three-source chain (command → file → safeStorage).
async function loadYtToken(cfg?: AppConfig): Promise<string | null> {
  if (IS_E2E) return 'e2e-token';
  const c = cfg ?? (await readConfig());
  return loadSecretWithSources(FILES.youtrackToken, c.youtrackTokenCommand, c.youtrackTokenFile);
}
// The YouTrack connection for issue operations (VERM-53, responsibility 8).
// Legacy storage: the Settings server and token, as before. Per-workspace
// storage: the active workspace's own server and credential reference,
// resolved with no fallback; a failure leaves the operation unavailable.
// Configuration articles are never read through this — they always use the
// Settings connection (loadYtToken).
type TrackerConnection = { ok: true; url: string; token: string } | { ok: false; error: string };
let activeWorkspaceTrackerConnection: (cfg: AppConfig) => Promise<TrackerConnection> = async () => ({
  ok: false,
  error: 'The active workspace is not available yet.',
});
async function trackerConnection(cfg: AppConfig): Promise<TrackerConnection> {
  if (workspaceStorageMode() === 'per-workspace') return activeWorkspaceTrackerConnection(cfg);
  const token = await loadYtToken(cfg);
  return cfg.youtrackUrl && token ? { ok: true, url: cfg.youtrackUrl, token } : { ok: false, error: 'YouTrack is not configured.' };
}
async function loadJiraToken(cfg?: AppConfig): Promise<string | null> {
  if (IS_E2E) return 'e2e-jira-token';
  return jiraProfile.loadJiraToken(cfg ?? (await readConfig()));
}
async function loadClaudeKey(cfg?: AppConfig): Promise<string | null> {
  if (IS_E2E) return 'e2e-claude-key';
  const c = cfg ?? (await readConfig());
  return loadSecretWithSources(FILES.claudeKey, c.claudeKeyCommand, c.claudeKeyFile);
}

// Runway metadata stores (ADR-0011 §6, VERM-37). The SQLite database is
// opened on first Jira use, in userData, and closed when the app quits.
// YouTrack never touches it, so a database problem cannot affect the
// existing YouTrack Focus fields.
let runwayDb: DatabaseSync | null = null;
let jiraRunwayStore: JiraRunwayMetadataStore | null = null;

const youtrackRunwayStore = createYouTrackRunwayStore({
  async readFields(issueId) {
    const yt = await trackerConnection(await readConfig());
    if (!yt.ok) throw new Error(yt.error);
    return (await youtrackTracker(yt.url, yt.token).getIssueDetail(issueId)).fields;
  },
  async patch(issueId, field, value) {
    const yt = await trackerConnection(await readConfig());
    if (!yt.ok) throw new Error(yt.error);
    await youtrackTracker(yt.url, yt.token).patchIssue(issueId, field, value);
  },
});

const runwayStores: RunwayStores = {
  youtrack: youtrackRunwayStore,
  get jira(): JiraRunwayMetadataStore {
    return openJiraRunwayStore().store;
  },
};

// Opens the Runway database on first use. The snapshot export (VERM-50)
// shares this one connection, so it backs up exactly what the store sees.
function openJiraRunwayStore(): { db: DatabaseSync; store: JiraRunwayMetadataStore } {
  if (!runwayDb || !jiraRunwayStore) {
    runwayDb = openRunwayDb(path.join(app.getPath('userData'), RUNWAY_DB_FILENAME));
    jiraRunwayStore = createJiraRunwayStore(runwayDb);
  }
  return { db: runwayDb, store: jiraRunwayStore };
}

// Runway writes and the snapshot import (VERM-51) run one at a time through
// this gate, so no write can land between the import's backup and its
// replacement. The import session owns the preview/confirm lifecycle: one
// pending preview, one active import that exclusively owns its staged copy,
// and refusal of previews and confirmations while an import runs — enforced
// here in the main process, for every window.
const runwayGate = new RunwayWriteGate();
let runwayImportSession: RunwayImportSession | null = null;

function importSession(): RunwayImportSession {
  runwayImportSession ??= new RunwayImportSession({
    stagingDir: path.join(app.getPath('userData'), RUNWAY_IMPORT_STAGING_DIRNAME),
  });
  return runwayImportSession;
}

// E2E only: holds a confirmed import between its backup and the replacement
// for this many milliseconds, so tests can send overlapping IPC requests
// while it is active. Ignored outside VERMILIAN_E2E.
function e2eImportHoldMs(): number {
  if (!IS_E2E) return 0;
  const ms = Number(process.env.VERMILIAN_E2E_RUNWAY_IMPORT_HOLD_MS ?? 0);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

// The Runway order store (VERM-80/81) on the same connection, so the
// snapshot export and import see exactly the rows it writes.
let runwayItemStore: RunwayItemStore | null = null;
function openRunwayItemStore(): RunwayItemStore {
  runwayItemStore ??= createRunwayItemStore(openJiraRunwayStore().db);
  return runwayItemStore;
}

function closeRunwayDb(): void {
  runwayImportSession?.shutdown();
  runwayDb?.close();
  runwayDb = null;
  jiraRunwayStore = null;
  runwayItemStore = null;
}

function runwayFailure(e: unknown): { ok: false; error: string; code?: string } {
  const err = e as { message?: string; code?: unknown };
  return {
    ok: false,
    error: err.message ?? 'Runway metadata request failed',
    // RunwayStoreError / RunwayDbError codes ('rank-taken', 'newer-schema', ...).
    code: typeof err.code === 'string' ? err.code : undefined,
  };
}

// The import preview's replacement warnings (VERM-79), computed through the
// write gate so they see the live data as it stands after any queued write.
function previewWarnings(db: DatabaseSync, staged: { exportedAt: string | null; stagedPath: string }) {
  return runwayGate.run(() => runwayImportWarnings(db, staged));
}

function notifySyncStatus(status: ConfigSyncStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('config:sync-status', status);
  }
}

export function registerIpc(): void {
  // Broadcast config-sync lifecycle events to every open renderer window so it
  // can surface toasts / banners (write failures, conflicts, version mismatch).
  articleConfig.setStatusNotifier(notifySyncStatus);

  // Issue operations under per-workspace storage use the active workspace's
  // own YouTrack connection, resolved with no fallback (VERM-53).
  activeWorkspaceTrackerConnection = async (cfg) =>
    resolveWorkspaceYouTrackConnection(
      await perWorkspaceDocument((await activeWorkspaceContext()).workspaceId),
      cfg,
      credentialSourceIO,
      IS_E2E,
    );

  ipcMain.handle(IPC.getConfig, (): Promise<AppConfig> => readConfig());

  ipcMain.handle(IPC.saveConfig, async (_e, patch: Partial<AppConfig>) => {
    // Per-reference sources change only through setCredentialRefSources, one
    // reference at a time, so a stale full map can never overwrite another
    // reference's entry.
    // OpenBao scopes likewise change only through their own handlers (VERM-64).
    const { credentialSources: _ignored, openbaoScopes: _ignoredBao, ...rest } = (patch ?? {}) as Partial<AppConfig>;
    void _ignored;
    void _ignoredBao;
    await writeConfig(rest);
    return { ok: true };
  });

  ipcMain.handle(
    IPC.credentialStatus,
    async (): Promise<CredentialStatus> => {
      if (IS_E2E) {
        return {
          hasYouTrackToken: true,
          hasClaudeKey: true,
          hasJiraToken: true,
          backend: 'e2e',
          secure: true,
          plaintext: [],
          undecryptable: [],
        };
      }
      const cfg = await readConfig();
      const plaintext: CredentialKind[] = [];
      const undecryptable: CredentialKind[] = [];
      for (const [kind, filename, command, file] of [
        ['youtrack', FILES.youtrackToken, cfg.youtrackTokenCommand, cfg.youtrackTokenFile],
        ['claude', FILES.claudeKey, cfg.claudeKeyCommand, cfg.claudeKeyFile],
        ['jira', FILES.jiraToken, cfg.jiraTokenCommand, cfg.jiraTokenFile],
      ] as const) {
        const storage = await legacySecretStorage(filename);
        // A plain-text copy is reported even when a command or file is the
        // source in use: it is still a secret on disk in the clear.
        if (storage === 'plaintext') plaintext.push(kind);
        else if (
          storage === 'undecryptable' && !command.trim() && !file.trim()
          && !openBaoSourceFor(legacyRefForBlob(filename) ?? '', SETTINGS_SCOPE_ID, cfg)
        ) undecryptable.push(kind);
      }
      return {
        plaintext,
        undecryptable,
        hasYouTrackToken: await hasSecretWithSources(
          FILES.youtrackToken,
          cfg.youtrackTokenCommand,
          cfg.youtrackTokenFile,
        ),
        hasClaudeKey: await hasSecretWithSources(
          FILES.claudeKey,
          cfg.claudeKeyCommand,
          cfg.claudeKeyFile,
        ),
        hasJiraToken: await jiraProfile.hasJiraToken(cfg),
        backend: getBackend(),
        secure: isSecure(),
      };
    },
  );

  ipcMain.handle(
    IPC.encryptPlaintextCredentials,
    async (): Promise<EncryptPlaintextResult> => {
      if (IS_E2E) return { encrypted: 0, failed: 0 };
      const r = await encryptPlaintextSecrets();
      return { encrypted: r.encrypted.length, failed: r.failed.length };
    },
  );

  ipcMain.handle(
    IPC.saveYouTrackToken,
    (_e, token: string): Promise<SaveSecretResult> =>
      saveSecret(FILES.youtrackToken, token),
  );

  ipcMain.handle(
    IPC.saveClaudeKey,
    (_e, key: string): Promise<SaveSecretResult> => saveSecret(FILES.claudeKey, key),
  );

  ipcMain.handle(
    IPC.testYouTrack,
    async (_e, args: TestYouTrackArgs): Promise<TestYouTrackResult> => {
      let token: string | null = null;
      try {
        token = args.token?.trim() || null;
        if (!token) {
          // The same resolution the app uses, so a broken source fails here
          // too instead of passing on a lower one (VERM-57).
          const cfg = await readConfig();
          const r = IS_E2E
            ? ({ ok: true, value: 'e2e-token' } as const)
            : await resolveLegacySecret(FILES.youtrackToken, cfg.youtrackTokenCommand, cfg.youtrackTokenFile);
          if (!r.ok) return { ok: false, message: `${r.message} Check the token settings, or paste a token.` };
          token = r.value;
        }
        const displayName = await youtrackTracker(args.url, token).getCurrentUser();
        return { ok: true, displayName };
      } catch (e) {
        const err = e as { status?: number; message?: string };
        let message = err.message ?? 'Connection failed.';
        // Never echo the credential back to the renderer
        if (token && message.includes(token)) {
          message = message.replace(token, '[redacted]');
        }
        return { ok: false, status: err.status, message };
      }
    },
  );

  ipcMain.handle(
    IPC.getWorklogTypes,
    async (_e, args: GetWorklogTypesArgs): Promise<string[]> => {
      const cfg = await readConfig();
      const url = args.url || cfg.youtrackUrl;
      const token =
        args.token ||
        (await loadSecretWithSources(
          FILES.youtrackToken,
          cfg.youtrackTokenCommand,
          cfg.youtrackTokenFile,
        ));
      if (!url || !token) return ['Development'];
      return youtrackTracker(url, token).getWorklogTypes();
    },
  );

  ipcMain.handle(
    IPC.testClaude,
    async (_e, args: TestClaudeArgs): Promise<TestClaudeResult> => {
      let key = args.key?.trim() || null;
      if (!key) {
        const cfg = await readConfig();
        const r = IS_E2E
          ? ({ ok: true, value: 'e2e-claude-key' } as const)
          : await resolveLegacySecret(FILES.claudeKey, cfg.claudeKeyCommand, cfg.claudeKeyFile);
        if (!r.ok) return { ok: false, error: `${r.message} Check the key settings, or paste a key.` };
        key = r.value;
      }
      if (key.includes('...')) return { ok: false, error: 'Key looks like a masked preview — paste the full key from console.anthropic.com or your password manager.' };
      const result = await claude.testKey(key, args.model);
      // Never echo the key back in an error message.
      if (!result.ok && result.error && key && result.error.includes(key)) {
        return { ok: false, error: result.error.replace(key, '[redacted]') };
      }
      return result;
    },
  );

  // Null when YouTrack is not configured or unreachable: the Jira section then
  // starts empty rather than blocking Settings, which must always open.
  ipcMain.handle(IPC.getJiraProfile, async (): Promise<JiraProfile | null> => {
    try {
      const cfg = await readConfig();
      const token = await loadYtToken(cfg);
      if (!cfg.youtrackUrl || !token) return null;
      return await jiraProfile.getJiraProfile(cfg.youtrackUrl, token);
    } catch {
      return null;
    }
  });

  ipcMain.handle(
    IPC.saveJiraProfile,
    async (_e, input: Partial<JiraProfile>): Promise<SaveJiraProfileResult> => {
      try {
        const cfg = await readConfig();
        const token = await loadYtToken(cfg);
        if (!cfg.youtrackUrl || !token) {
          return { ok: false, message: 'Connect YouTrack first — the Jira profile is stored there.' };
        }
        const profile = await jiraProfile.saveJiraProfile(cfg.youtrackUrl, token, input);
        return { ok: true, profile };
      } catch (e) {
        const code = (e as { message?: string }).message;
        if (code === 'JIRA_PROFILE_INVALID') {
          return { ok: false, message: 'Enter an https site URL and an account email.' };
        }
        if (code === 'JIRA_PROFILE_WRITE_FAILED') {
          return { ok: false, message: 'YouTrack did not accept the update to the Jira profile.' };
        }
        return { ok: false, message: code ?? 'Saving the Jira profile failed.' };
      }
    },
  );

  ipcMain.handle(
    IPC.saveJiraToken,
    (_e, token: string): Promise<SaveSecretResult> => saveSecret(FILES.jiraToken, token),
  );

  ipcMain.handle(
    IPC.testJira,
    async (_e, args: TestJiraArgs): Promise<TestJiraResult> => {
      const profile = normaliseJiraProfile(args.profile);
      const givenCloudId = args.profile.cloudId?.trim() ?? '';
      if (!profile) {
        return { ok: false, reason: 'invalid-profile', cloudId: givenCloudId, message: 'Enter an https site URL and an account email.' };
      }
      let token = args.token?.trim() || null;
      if (!token) {
        const cfg = await readConfig();
        const r = IS_E2E
          ? ({ ok: true, value: 'e2e-jira-token' } as const)
          : await resolveLegacySecret(FILES.jiraToken, cfg.jiraTokenCommand, cfg.jiraTokenFile);
        if (!r.ok) {
          return { ok: false, reason: 'no-token', cloudId: profile.cloudId, message: `${r.message} Check the token settings, or paste a token.` };
        }
        token = r.value;
      }
      const r = await jira.probeJiraToken(profile, token);
      if (r.ok) {
        // A scoped token can pass /myself and still lack what the board reads
        // need (VERM-59): check each with one minimal read.
        const base = r.kind === 'scoped' ? jira.gatewayApiBase(r.cloudId) : jira.siteApiBase(profile.siteUrl);
        const missingScopes = await jira.missingJiraScopes(base, profile.email, token);
        return { ok: true, kind: r.kind, cloudId: r.cloudId, displayName: r.account.displayName, missingScopes };
      }
      // Never echo the credential back to the renderer.
      const message = r.message.includes(token) ? r.message.split(token).join('[redacted]') : r.message;
      return { ok: false, reason: r.reason, cloudId: r.cloudId, message, status: r.status };
    },
  );

  ipcMain.handle(IPC.listMyJiraIssues, async (): Promise<ListJiraIssuesResult> => {
    const NOT_CONFIGURED = 'Jira is not set up. Open Settings and fill in the Jira section.';
    let token: string | null = null;
    try {
      const cfg = await readConfig();
      if (workspaceStorageMode() === 'per-workspace') {
        // The active Jira workspace's own connection and credential
        // reference, with no fallback to the Settings Jira token (VERM-53).
        const doc = await perWorkspaceDocument((await activeWorkspaceContext()).workspaceId);
        if (doc?.backend.kind !== 'jira') return { ok: false, reason: 'not-configured', message: 'The active workspace is not a Jira workspace.' };
        const { siteUrl, email, cloudId, credentialRef } = doc.backend;
        const r = await resolveWorkspaceCredential({ workspaceId: doc.workspaceId, credentialRef }, cfg, credentialSourceIO);
        if (r.ok) token = r.value;
        else if (IS_E2E && credentialRef && e2eFakeCredentialAllowed(credentialRef, r.reason)) token = 'e2e-jira-token';
        else return { ok: false, reason: 'not-configured', message: r.message };
        const profile = { siteUrl, email, cloudId };
        const issues = await jira.searchMyOpenIssues(profile, token);
        return { ok: true, siteUrl, issues: issues.map((i) => toJiraIssueRow(i, siteUrl)) };
      }
      const ytToken = await loadYtToken(cfg);
      if (!cfg.youtrackUrl || !ytToken) return { ok: false, reason: 'not-configured', message: NOT_CONFIGURED };
      const profile = await jiraProfile.getJiraProfile(cfg.youtrackUrl, ytToken);
      token = await loadJiraToken(cfg);
      if (!profile || !token) return { ok: false, reason: 'not-configured', message: NOT_CONFIGURED };
      const issues = await jira.searchMyOpenIssues(profile, token);
      return { ok: true, siteUrl: profile.siteUrl, issues: issues.map((i) => toJiraIssueRow(i, profile.siteUrl)) };
    } catch (e) {
      let message = (e as { message?: string }).message ?? 'Loading Jira issues failed.';
      // Never echo the credential back to the renderer.
      if (token && message.includes(token)) message = message.split(token).join('[redacted]');
      return { ok: false, reason: 'error', message };
    }
  });

  // Task creation (VERM-115) on the active workspace's own YouTrack
  // connection, never another credential.
  const createTask = createTaskService({
    activeWorkspaceId: async () => (await activeWorkspaceContext()).workspaceId ?? '',
    generation: activeWorkspaceGeneration,
    // The named workspace's own connection — never whichever workspace is
    // active when the call happens to run. Legacy storage has one shared
    // Settings connection.
    async connection(workspaceId) {
      const cfg = await readConfig();
      const yt = workspaceStorageMode() === 'per-workspace'
        ? await resolveWorkspaceYouTrackConnection(await perWorkspaceDocument(workspaceId), cfg, credentialSourceIO, IS_E2E)
        : await trackerConnection(cfg);
      if (!yt.ok) return { ok: false, error: yt.error };
      const tracker = youtrackTracker(yt.url, yt.token);
      return {
        ok: true,
        readMetadata: (projectId) => tracker.getProjectFieldMetadata(projectId),
        create: (payload) => tracker.createIssue(payload),
      };
    },
  });

  ipcMain.handle(
    IPC.aiCreateTask,
    async (_e, args: AiCreateTaskArgs): Promise<AiCreateTaskResult> => {
      // Bound to the workspace the request came from, as read before the AI
      // operation begins (VERM-115): every project-field read uses that
      // workspace's connection, and stops if the user switches away.
      const bound = await createTask.origin(args.workspaceId);
      const ai = await beginAi(args.workspaceId);
      if (!ai.ok) return { ok: false, error: ai.error };
      if (!bound.ok || bound.origin.workspaceId !== ai.workspaceId) return { ok: false, error: AI_CREATE_WORKSPACE_CHANGED_MESSAGE };
      const cfg = await readConfig();
      const known = typeof args.projectId === 'string' && args.projectId ? args.projectId : '';
      return createTask.aiCreate(bound.origin, known, (allowed) =>
        ai.send((key) => claude.extractTaskFields(key, args.description, args.projects, cfg.modelForCreate, allowed)),
      );
    },
  );

  ipcMain.handle(IPC.pickFolder, async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IPC.openUserData, async (): Promise<void> => {
    await shell.openPath(app.getPath('userData'));
  });

  ipcMain.handle(IPC.getProjects, async () => {
    const cfg = await readConfig();
    const yt = await trackerConnection(cfg);
    if (!yt.ok) return [];
    try {
      return await youtrackTracker(yt.url, yt.token).getProjects();
    } catch (e) {
      // youtrack.ts throws a plain { status, message } object. Electron
      // stringifies a non-Error thrown across IPC, so the renderer would see
      // "[object Object]" and lose the status entirely — which is why a dead
      // token produced an empty board with no explanation. Re-throw a real
      // Error with the status in the message so the renderer can tell an auth
      // failure from an unreachable host. Parsed by connectionErrorMessage().
      const err = e as { status?: number; message?: string };
      throw new Error(
        `YouTrack request failed (status ${err.status ?? 'none'}): ${err.message ?? 'unknown error'}`,
        { cause: e },
      );
    }
  });

  // The legacy store: _vermilian-config, with the local file as fallback.
  async function loadLegacyWorkspaceConfig(): Promise<VermilianConfig | null> {
    // Try Article first. If it hasn't hydrated yet, wait briefly (bounded)
    // rather than immediately falling back to the local file — serving that
    // stale fallback to the renderer is what let one machine's pre-rebuild
    // project ids get echoed back through a later save and clobber the
    // shared Article for every machine. See RUNBOOK.md.
    let cached = articleConfig.getWorkspaceConfig();
    if (!cached) {
      const cfg = await readConfig();
      const token = await loadYtToken(cfg);
      if (cfg.youtrackUrl && token) {
        await articleConfig.waitForLoad(cfg.youtrackUrl, token);
        cached = articleConfig.getWorkspaceConfig();
      }
    }
    if (cached) return cached;
    return readWorkspaceConfig();
  }

  // Every workspace this machine can switch to, from whichever store the
  // activation gate selects (shared/activeWorkspace.ts), plus the legacy
  // activeWorkspaceId as a read-only hint for the first resolution.
  async function workspaceChoices(): Promise<{
    choices: WorkspaceChoice[];
    legacyHint: string;
    configuredServerUrl: string;
  }> {
    const cfg = await readConfig();
    if (workspaceStorageMode() === 'per-workspace') {
      const client = await workspaceArticleClient();
      const listed = client ? await workspaceArticles.listWorkspaceArticles(client) : null;
      const docs = listed?.ok
        ? listed.workspaces.flatMap((e) => (e.status === 'ok' ? [e.document] : []))
        : [];
      return {
        choices: docs.map((d) => ({
          id: d.workspaceId,
          name: d.name,
          order: d.order,
          backend: backendContextOf(d),
          aiCredentialRef: aiCredentialRefOf('per-workspace', d),
        })),
        legacyHint: articleConfig.getWorkspaceConfig()?.activeWorkspaceId ?? '',
        configuredServerUrl: cfg.youtrackUrl,
      };
    }
    const legacy = await loadLegacyWorkspaceConfig();
    return {
      choices: (legacy?.workspaces ?? []).map((w) => ({
        id: w.id,
        name: w.name,
        order: w.order,
        backend: { kind: 'youtrack', serverUrl: cfg.youtrackUrl, credentialRef: MIGRATED_YOUTRACK_CREDENTIAL_REF },
        aiCredentialRef: aiCredentialRefOf('legacy', null),
      })),
      legacyHint: legacy?.activeWorkspaceId ?? '',
      configuredServerUrl: cfg.youtrackUrl,
    };
  }

  // A workspace's stand-up inputs — its backend and folders — from whichever
  // store the activation gate selects; null when it does not exist (VERM-48).
  async function standupWorkspace(workspaceId: string): Promise<StandupWorkspace | null> {
    if (workspaceStorageMode() === 'per-workspace') {
      const doc = await perWorkspaceDocument(workspaceId);
      return doc ? { id: doc.workspaceId, backend: backendContextOf(doc), folders: doc.folders, youtrackProjects: doc.youtrackProjects } : null;
    }
    const legacy = await loadLegacyWorkspaceConfig();
    const ws = legacy?.workspaces.find((w) => w.id === workspaceId);
    return ws ? { id: ws.id, backend: null, folders: ws.folders } : null;
  }

  // The stand-up and Daily Review data source (VERM-114,
  // services/workspaceStandup.ts): one connection rule for both callers.
  function workspaceReportSource(cfg: AppConfig): WorkspaceReportSourceDeps {
    return {
      storage: workspaceStorageMode(),
      loadWorkspace: standupWorkspace,
      connectWorkspace: async (id) => resolveWorkspaceYouTrackConnection(await perWorkspaceDocument(id), cfg, credentialSourceIO, IS_E2E),
      legacyConnection: async () => {
        const token = await loadYtToken(cfg);
        return cfg.youtrackUrl && token ? { ok: true, url: cfg.youtrackUrl, token } : { ok: false, error: 'YouTrack not configured.' };
      },
      tracker: (url, token) => youtrackTracker(url, token),
    };
  }

  // One per-workspace document by ID, or null.
  async function perWorkspaceDocument(workspaceId: string): Promise<WorkspaceDocument | null> {
    if (!workspaceId) return null;
    const client = await workspaceArticleClient();
    const listed = client ? await workspaceArticles.listWorkspaceArticles(client) : null;
    if (!listed?.ok) return null;
    const entry = listed.workspaces.find((e) => e.workspaceId === workspaceId);
    return entry?.status === 'ok' ? entry.document : null;
  }

  async function activeWorkspaceContext(): Promise<ActiveWorkspaceContext> {
    const { choices, legacyHint, configuredServerUrl } = await workspaceChoices();
    const id = resolveActiveWorkspaceId(choices, await readStoredActiveWorkspaceId(), legacyHint);
    return contextFor(choices, id, configuredServerUrl);
  }

  // ─── The active workspace's Anthropic credential (VERM-47) ─────────────────
  // shared/workspaceAi.ts has the rules. Resolution happens here, in the main
  // process; only the reference and availability ever reach the renderer.

  // Whether the reference has a source on this machine — without running or
  // reading it. Legacy storage keeps the Settings key's own check, unchanged.
  async function aiConfigured(storage: WorkspaceStorageMode, ref: CredentialRef | null, workspaceId: string): Promise<boolean> {
    if (ref === null) return false;
    const cfg = await readConfig();
    if (storage === 'legacy') {
      if (IS_E2E) return true;
      return hasSecretWithSources(FILES.claudeKey, cfg.claudeKeyCommand, cfg.claudeKeyFile);
    }
    const status = await credentialRefStatus(ref, cfg, credentialSourceIO, workspaceId);
    if (status.selected !== null) return true;
    return IS_E2E && e2eFakeAnthropicKeyAllowed(ref, 'no-source');
  }

  async function contextFor(choices: WorkspaceChoice[], id: string, configuredServerUrl: string): Promise<ActiveWorkspaceContext> {
    const storage = workspaceStorageMode();
    const ref = choices.find((c) => c.id === id)?.aiCredentialRef ?? null;
    return buildActiveContext(storage, choices, id, configuredServerUrl, await aiConfigured(storage, ref, id));
  }

  // One AI operation for the active workspace only (services/workspaceAiKey.ts).
  // The switch counter is read first, before anything else is decided; the
  // returned send() checks it again immediately before calling Anthropic.
  async function beginAi(requestedWorkspaceId: unknown): Promise<WorkspaceAiOperation> {
    const startGeneration = activeWorkspaceGeneration();
    const { choices, legacyHint } = await workspaceChoices();
    return beginWorkspaceAiOperation({
      startGeneration,
      currentGeneration: activeWorkspaceGeneration,
      storage: workspaceStorageMode(),
      activeId: resolveActiveWorkspaceId(choices, await readStoredActiveWorkspaceId(), legacyHint),
      choices,
      requestedWorkspaceId,
      cfg: await readConfig(),
      io: credentialSourceIO,
      loadLegacyKey: loadClaudeKey,
      e2e: IS_E2E,
    });
  }

  ipcMain.handle(IPC.getWorkspaceConfig, async (): Promise<VermilianConfig | null> => {
    if (workspaceStorageMode() === 'per-workspace') {
      // Read-only view of the per-workspace articles in the rail's shape.
      const client = await workspaceArticleClient();
      const listed = client ? await workspaceArticles.listWorkspaceArticles(client) : null;
      if (!listed?.ok) return null;
      const docs = listed.workspaces.flatMap((e) => (e.status === 'ok' ? [e.document] : []));
      if (docs.length === 0) return null;
      const workspaces = workspacesFromDocuments(docs);
      const activeWorkspaceId = resolveActiveWorkspaceId(workspaces, await readStoredActiveWorkspaceId(), '');
      return { version: 1, workspaces, activeWorkspaceId };
    }
    // The renderer sees this machine's own active workspace, not the value
    // the shared article carries (VERM-46).
    const legacy = await loadLegacyWorkspaceConfig();
    if (!legacy) return null;
    return {
      ...legacy,
      activeWorkspaceId: resolveActiveWorkspaceId(
        legacy.workspaces,
        await readStoredActiveWorkspaceId(),
        legacy.activeWorkspaceId,
      ),
    };
  });

  ipcMain.handle(IPC.getActiveWorkspace, (): Promise<ActiveWorkspaceContext> => activeWorkspaceContext());

  ipcMain.handle(
    IPC.setActiveWorkspace,
    async (_e, workspaceId: unknown): Promise<SetActiveWorkspaceResult> => {
      if (typeof workspaceId !== 'string' || workspaceId === '') {
        return { ok: false, message: 'No workspace was given.' };
      }
      const { choices, configuredServerUrl } = await workspaceChoices();
      if (!choices.some((c) => c.id === workspaceId)) {
        return { ok: false, message: 'That workspace no longer exists.' };
      }
      // Local only: the shared _vermilian-config article is not written.
      await writeStoredActiveWorkspaceId(workspaceId);
      return {
        ok: true,
        context: await contextFor(choices, workspaceId, configuredServerUrl),
      };
    },
  );

  ipcMain.handle(
    IPC.saveWorkspaceConfig,
    async (_e, config: VermilianConfig): Promise<{ ok: boolean; error?: string }> => {
      if (workspaceStorageMode() === 'per-workspace') {
        // One merge-and-verify update per changed workspace article (VERM-53).
        const r = await savePerWorkspaceLayout(config);
        return r.ok ? { ok: true } : { ok: false, error: r.error };
      }
      const cfg = await readConfig();
      const token = await loadYtToken(cfg);

      // Drop any project ids that no longer exist (e.g. left behind by a
      // YouTrack rebuild) before persisting anywhere. This is what actually
      // stops a stale config from being written back to the shared Article —
      // best-effort: if the live list can't be fetched (offline), save as-is
      // rather than block the write.
      let toSave = config;
      if (cfg.youtrackUrl && token) {
        try {
          const projects = await youtrackTracker(cfg.youtrackUrl, token).getProjects();
          toSave = pruneStaleProjectIds(config, new Set(projects.map((p) => p.id)));
        } catch {
          /* offline or request failed — save as-is */
        }
      }

      // Write local file immediately (fast, offline-safe).
      await writeWorkspaceConfig(toSave);
      // Update Article cache and schedule debounced remote write.
      if (!articleConfig.updateWorkspaceConfig(toSave)) return { ok: false, error: articleConfig.ACTIVATION_IN_PROGRESS_MESSAGE };
      if (cfg.youtrackUrl && token) articleConfig.scheduleSave(cfg.youtrackUrl, token);
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.deleteWorkspace,
    async (_e, workspaceId: unknown, destinationId: unknown): Promise<{ ok: boolean; error?: string }> => {
      if (workspaceStorageMode() !== 'per-workspace') {
        return { ok: false, error: 'Workspaces are deleted this way only under per-workspace storage.' };
      }
      if (typeof workspaceId !== 'string' || workspaceId === '' || (destinationId !== null && typeof destinationId !== 'string')) {
        return { ok: false, error: 'No workspace was given.' };
      }
      return deletePerWorkspace(workspaceId, destinationId as string | null);
    },
  );

  ipcMain.handle(
    IPC.forceResyncWorkspaceConfig,
    async (): Promise<{ ok: boolean; error?: string }> => {
      if (workspaceStorageMode() === 'per-workspace') {
        // Per-workspace articles are read fresh on every request; there is no
        // cached layout to discard, and _vermilian-config is not used (VERM-53).
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('config:article-synced');
        }
        return { ok: true };
      }
      const cfg = await readConfig();
      const token = await loadYtToken(cfg);
      if (!cfg.youtrackUrl || !token) {
        return { ok: false, error: 'YouTrack is not configured.' };
      }
      try {
        let wsConfig = await articleConfig.forceReload(cfg.youtrackUrl, token);
        if (wsConfig) {
          try {
            const projects = await youtrackTracker(cfg.youtrackUrl, token).getProjects();
            const pruned = pruneStaleProjectIds(wsConfig, new Set(projects.map((p) => p.id)));
            if (JSON.stringify(pruned) !== JSON.stringify(wsConfig)) {
              if (articleConfig.updateWorkspaceConfig(pruned)) articleConfig.scheduleSave(cfg.youtrackUrl, token);
            }
            wsConfig = pruned;
          } catch {
            /* best-effort prune — still return the freshly reloaded config */
          }
          await writeWorkspaceConfig(wsConfig);
        }
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('config:article-synced');
        }
        return { ok: true };
      } catch (e) {
        const err = e as { message?: string };
        return { ok: false, error: err.message ?? 'Resync failed.' };
      }
    },
  );

  ipcMain.handle(IPC.getIssues, async (_e, args: GetIssuesArgs) => {
    const cfg = await readConfig();
    const yt = await trackerConnection(cfg);
    if (!yt.ok) return [];
    return youtrackTracker(yt.url, yt.token).getIssues(args.projectShortName, args.includeResolved);
  });

  ipcMain.handle(IPC.searchIssues, async (_e, args: SearchIssuesArgs) => {
    const cfg = await readConfig();
    const yt = await trackerConnection(cfg);
    if (!yt.ok) return [];
    return youtrackTracker(yt.url, yt.token).searchIssues(args.projectShortNames, args.query);
  });

  // Re-fetches and re-parses _vermilian-master-plan on every call — see
  // services/masterPlan.ts for why there is no persistent cache here.
  //
  // Legacy storage: the one global article, found by title, as before VERM-53.
  // Per-workspace storage (VERM-48): the named workspace's own article by ID
  // (the active one when none is named), read through that workspace's own
  // YouTrack connection and credential — never the global article, a title
  // search, or another workspace's connection.
  ipcMain.handle(IPC.getMasterPlan, async (_e, workspaceId?: unknown): Promise<MasterPlanState> => {
    const cfg = await readConfig();
    if (workspaceStorageMode() === 'legacy') {
      const token = await loadYtToken(cfg);
      return getMasterPlanState(cfg.youtrackUrl ?? '', token ?? '');
    }
    // Only the active workspace's plan, resolved here in the main process: a
    // caller-supplied ID for any other workspace is refused before YouTrack
    // is contacted, and a switch during the read discards it
    // (services/masterPlan.ts, getActiveWorkspaceMasterPlan).
    const startGeneration = activeWorkspaceGeneration();
    const activeId = (await activeWorkspaceContext()).workspaceId;
    return getActiveWorkspaceMasterPlan({
      requestedWorkspaceId: workspaceId,
      activeId,
      startGeneration,
      currentGeneration: activeWorkspaceGeneration,
      loadDoc: perWorkspaceDocument,
      connect: (doc) => resolveWorkspaceYouTrackConnection(doc, cfg, credentialSourceIO, IS_E2E),
      fetchArticle: (url, token, id) => youtrack.getArticleById(url, token, id),
    });
  });

  ipcMain.handle(IPC.openExternalUrl, async (_e, url: string): Promise<void> => {
    // Validate URL before opening to prevent arbitrary protocol handlers
    if (/^https?:\/\//i.test(url)) {
      await shell.openExternal(url);
    }
  });

  ipcMain.handle(IPC.quitApp, (): void => {
    app.quit();
  });

  ipcMain.handle(IPC.getIssueDetail, async (_e, issueId: string) => {
    const cfg = await readConfig();
    const yt = await trackerConnection(cfg);
    if (!yt.ok) throw new Error(yt.error);
    return youtrackTracker(yt.url, yt.token).getIssueDetail(issueId);
  });

  ipcMain.handle(
    IPC.patchIssue,
    async (_e, args: PatchIssueArgs): Promise<{ ok: boolean; error?: string }> => {
      try {
        const cfg = await readConfig();
        const yt = await trackerConnection(cfg);
        if (!yt.ok) return { ok: false, error: yt.error };
        await youtrackTracker(yt.url, yt.token).patchIssue(args.issueId, args.field, args.value);
        return { ok: true };
      } catch (e) {
        const err = e as { message?: string };
        return { ok: false, error: err.message ?? 'Save failed' };
      }
    },
  );

  // Task creation (VERM-115): options and the create itself both go through
  // createTaskService on the active workspace's own connection, which
  // rechecks the workspace, the project and every value before sending.
  ipcMain.handle(
    IPC.createIssue,
    async (_e, args: CreateIssueArgs): Promise<CreateIssueResult> => {
      try {
        return await createTask.create(args);
      } catch (e) {
        const err = e as { message?: string };
        return { ok: false, error: err.message ?? 'Create failed' };
      }
    },
  );

  ipcMain.handle(
    IPC.getCreateFieldOptions,
    async (_e, args: unknown): Promise<CreateFieldOptionsResult> => {
      try {
        return await createTask.getOptions(args);
      } catch (e) {
        const a = (args ?? {}) as Partial<CreateFieldOptionsArgs>;
        return { ok: false, workspaceId: a.workspaceId ?? '', projectId: a.projectId ?? '', error: (e as { message?: string }).message ?? 'Could not read the project fields.' };
      }
    },
  );

  // Select-field values for the boards, Priority Desk and detail dropdowns
  // (VERM-117), on the named workspace's own connection.
  ipcMain.handle(
    IPC.getProjectFieldValues,
    async (_e, args: unknown): Promise<ProjectFieldValuesResult> => {
      try {
        return await createTask.getFieldValues(args);
      } catch (e) {
        const a = (args ?? {}) as Partial<ProjectFieldValuesArgs>;
        return { ok: false, workspaceId: a.workspaceId ?? '', project: a.project ?? '', error: (e as { message?: string }).message ?? 'Could not read the project fields.' };
      }
    },
  );

  ipcMain.handle(
    IPC.deleteIssue,
    async (_e, issueId: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const cfg = await readConfig();
        const yt = await trackerConnection(cfg);
        if (!yt.ok) return { ok: false, error: yt.error };
        await youtrackTracker(yt.url, yt.token).deleteIssue(issueId);
        return { ok: true };
      } catch (e) {
        const err = e as { message?: string };
        return { ok: false, error: err.message ?? 'Delete failed' };
      }
    },
  );

  ipcMain.handle(
    IPC.moveIssue,
    async (_e, args: MoveIssueArgs): Promise<{ ok: boolean; error?: string }> => {
      try {
        const cfg = await readConfig();
        const yt = await trackerConnection(cfg);
        if (!yt.ok) return { ok: false, error: yt.error };
        await youtrackTracker(yt.url, yt.token).moveIssue(args.issueId, args.targetProjectId);
        return { ok: true };
      } catch (e) {
        const err = e as { message?: string };
        return { ok: false, error: err.message ?? 'Move failed' };
      }
    },
  );

  // ─── Priority Desk "Ask for recommendation" (VERM-8) ─────────────────────
  // getRecommendation composes the bounded recommendation fetch with the
  // Claude call and never writes any field. postRecommendationAudit is the
  // only path that ever posts a comment for this feature, gated by
  // maybeBuildAuditComment (shared/recommendationAudit.ts) — it returns null
  // for anything but a 'ranked' result with a chosen action, so a
  // 'clarification' result can never reach youtrack.postComment from here.

  ipcMain.handle(
    IPC.getRecommendation,
    async (_e, args: GetRecommendationArgs): Promise<GetRecommendationResult> => {
      try {
        if (!args.issueIds.length) return { ok: false, error: 'No candidates to evaluate.' };
        const cfg = await readConfig();
        const yt = await trackerConnection(cfg);
        if (!yt.ok) return { ok: false, error: yt.error };
        const ai = await beginAi(args.workspaceId);
        if (!ai.ok) return { ok: false, error: ai.error };

        const issues = await youtrackTracker(yt.url, yt.token).getIssuesForRecommendation(args.issueIds);
        const sent = await ai.send((key) =>
          claude.getRecommendation(key, issues, args.candidateContext, args.outcome, cfg.modelForRecommendation),
        );
        if (!sent.ok) return { ok: false, error: sent.error };
        return { ok: true, result: sent.value };
      } catch (e) {
        const err = e as { message?: string };
        return { ok: false, error: err.message ?? 'Recommendation request failed.' };
      }
    },
  );

  ipcMain.handle(
    IPC.postRecommendationAudit,
    async (_e, args: PostRecommendationAuditArgs): Promise<PostRecommendationAuditResult> => {
      const comment = maybeBuildAuditComment(args.result, args.action);
      if (!comment || args.result.kind !== 'ranked') {
        return { ok: false, error: 'No ranked recommendation to audit.' };
      }
      try {
        const cfg = await readConfig();
        const yt = await trackerConnection(cfg);
        if (!yt.ok) return { ok: false, error: yt.error };
        const topIssueId = args.result.ranked[0].issueId;
        await youtrackTracker(yt.url, yt.token).postComment(topIssueId, comment);
        return { ok: true };
      } catch (e) {
        const err = e as { message?: string };
        return { ok: false, error: err.message ?? 'Failed to post audit comment.' };
      }
    },
  );

  // Priority Desk Daily Review (VERM-9, docs/requirements.md § Priority
  // Desk). Deterministic — no Claude call. Answers only "recently
  // completed", the one section the renderer's own board cache can't cover
  // (that cache excludes resolved issues); Now/Next/Then, blocked-focused,
  // and needs-attention are all derived client-side from that board cache
  // instead (renderer/features/daily-review/boardData.ts).
  ipcMain.handle(IPC.dailyReviewGet, async (_e, args: unknown): Promise<DailyReviewGetResult> => {
    // The workspace the renderer's view is for (VERM-114 review): refused
    // unless it is the active workspace when the read starts; otherwise read
    // that one and name it in the answer, even if the user switches away.
    const requested = (args as Partial<DailyReviewGetArgs> | null)?.workspaceId;
    const workspaceId = typeof requested === 'string' ? requested : '';
    try {
      const cfg = await readConfig();
      // Read exactly as a stand-up reads (VERM-114): under per-workspace
      // storage the workspace's own connection for discovery and the issue
      // read, never the Settings connection; legacy keeps the shared one.
      return await getWorkspaceDailyReview(
        {
          ...workspaceReportSource(cfg),
          // Checked once, before the workspace's credential is resolved.
          activeWorkspaceId: async () => (await activeWorkspaceContext()).workspaceId ?? '',
          cutoffMs: Date.now() - DAILY_REVIEW_COMPLETED_WINDOW_HOURS * 60 * 60 * 1000,
        },
        workspaceId,
      );
    } catch (e) {
      const err = e as { message?: string };
      return { ok: false, workspaceId, error: err.message ?? 'Daily Review failed to load.' };
    }
  });

  // e2e-only test hook — wired directly to the fake module (never through
  // api/client.ts, which has no such export on the real client) so specs can
  // assert what was actually posted and when, without giving production code
  // any way to read comments back out. Never registered outside the e2e
  // harness.
  if (IS_E2E) {
    ipcMain.handle('e2e:getPostedComments', (): Array<{ issueId: string; text: string }> =>
      fakeYouTrackForE2E.getPostedComments(),
    );
    ipcMain.handle('e2e:getWorkspaceArticles', () => fakeYouTrackForE2E.getWorkspaceArticlesForTests());
    ipcMain.handle('e2e:writeWorkspaceArticle', (_e, articleId: string, content: string): boolean =>
      fakeYouTrackForE2E.writeWorkspaceArticleForTests(articleId, content),
    );
    ipcMain.handle('e2e:getMigrationSources', () => fakeYouTrackForE2E.getMigrationSourcesForTests());
    ipcMain.handle('e2e:failConfigWrites', (_e, n: number) => fakeYouTrackForE2E.failConfigWritesForTests(n));
    ipcMain.handle('e2e:failWorkspaceWrites', (_e, n: number) => fakeYouTrackForE2E.failWorkspaceWritesForTests(n));
    ipcMain.handle('e2e:writeConfigArticle', (_e, content: string): boolean => fakeYouTrackForE2E.writeConfigArticleForTests(content));
    // The fake Jira (VERM-39): change its issues as an edit in Jira would,
    // read which calls were made, and hold searches back to test a poll in
    // flight.
    ipcMain.handle('e2e:jiraChange', (_e, change: fakeJiraForE2E.FakeJiraChange): boolean =>
      fakeJiraForE2E.applyChangeForTests(change),
    );
    ipcMain.handle('e2e:jiraCalls', () => fakeJiraForE2E.getCallsForTests());
    ipcMain.handle('e2e:jiraSearchDelay', (_e, ms: number) => fakeJiraForE2E.setSearchDelayForTests(ms));
    ipcMain.handle('e2e:jiraGetIssueDelay', (_e, ms: number) => fakeJiraForE2E.setGetIssueDelayForTests(ms));
    // Which credential reference each fake Claude call used (VERM-47).
    ipcMain.handle('e2e:claudeCalls', () => fakeClaudeForE2E.getCallsForTests());
    // The fake YouTrack (VERM-48): stand-up project queries, a stand-up hold,
    // and master-plan articles by readable ID (content, or a refusal status).
    // Task creation (VERM-115): create requests that reached the fake, a
    // one-shot server refusal, and a held or failing project field read.
    ipcMain.handle('e2e:fieldMetadataRequests', () => fakeYouTrackForE2E.getFieldMetadataRequestsForTests());
    ipcMain.handle('e2e:claudeExtractDelay', (_e, ms: number) => fakeClaudeForE2E.setExtractDelayForTests(ms));
    ipcMain.handle('e2e:createRequests', () => fakeYouTrackForE2E.getCreateRequestsForTests());
    ipcMain.handle('e2e:nextCreateError', (_e, message: string | null) => fakeYouTrackForE2E.setNextCreateErrorForTests(message));
    ipcMain.handle('e2e:fieldMetadataDelay', (_e, ms: number, project?: string) => fakeYouTrackForE2E.setFieldMetadataDelayForTests(ms, project));
    ipcMain.handle('e2e:failFieldMetadata', (_e, n: number, project?: string) => fakeYouTrackForE2E.failFieldMetadataForTests(n, project));
    ipcMain.handle('e2e:holdFieldMetadata', (_e, project: string) => fakeYouTrackForE2E.holdFieldMetadataForTests(project));
    ipcMain.handle('e2e:releaseFieldMetadata', () => fakeYouTrackForE2E.releaseFieldMetadataForTests());
    ipcMain.handle('e2e:getPatchRequests', () => fakeYouTrackForE2E.getPatchRequestsForTests());
    ipcMain.handle('e2e:setProjectField', (_e, project: string, field: string, values: string[] | null) => fakeYouTrackForE2E.setFakeProjectFieldForTests(project, field, values));
    ipcMain.handle('e2e:standupQueries', () => fakeYouTrackForE2E.getStandupQueriesForTests());
    ipcMain.handle('e2e:standupCredentialRefs', () => fakeYouTrackForE2E.getStandupCredentialRefsForTests());
    ipcMain.handle('e2e:articleFetches', () => fakeYouTrackForE2E.getArticleFetchesForTests());
    ipcMain.handle('e2e:articleDelay', (_e, ms: number) => fakeYouTrackForE2E.setArticleDelayForTests(ms));
    ipcMain.handle('e2e:standupDelay', (_e, ms: number, project?: string) => fakeYouTrackForE2E.setStandupDelayForTests(ms, project));
    ipcMain.handle('e2e:setArticle', (_e, articleId: string, value: { content: string } | { status: number }) =>
      fakeYouTrackForE2E.setArticleForTests(articleId, value),
    );
  }

  // ─── Per-workspace configuration articles (VERM-43) ─────────────────────────
  // Each handler reads and writes in one main-process operation
  // (services/workspaceArticles.ts); no source handle ever crosses IPC.

  const NOT_CONFIGURED_WS: WorkspaceDiscoveryFailure = {
    ok: false,
    reason: 'not-configured',
    message: 'Connect YouTrack first — workspace configuration is stored there.',
  };

  async function workspaceArticleClient() {
    const cfg = await readConfig();
    const token = await loadYtToken(cfg);
    return cfg.youtrackUrl && token ? youtrackWorkspaceArticleClient(cfg.youtrackUrl, token) : null;
  }

  ipcMain.handle(IPC.listWorkspaceArticles, async (): Promise<ListWorkspaceArticlesResult> => {
    const client = await workspaceArticleClient();
    return client ? workspaceArticles.listWorkspaceArticles(client) : NOT_CONFIGURED_WS;
  });

  ipcMain.handle(
    IPC.readWorkspaceArticle,
    async (_e, workspaceId: unknown): Promise<ReadWorkspaceArticleResult> => {
      const client = await workspaceArticleClient();
      if (!client) return NOT_CONFIGURED_WS;
      if (typeof workspaceId !== 'string') {
        return { ok: false, reason: 'not-found', message: 'No workspace ID was given.' };
      }
      return workspaceArticles.readWorkspaceArticle(client, workspaceId);
    },
  );

  ipcMain.handle(
    IPC.createWorkspaceArticle,
    async (_e, doc: WorkspaceDocument): Promise<SaveWorkspaceArticleResult> => {
      const guard = await storageGuard('per-workspace');
      if (!guard.allowed) return { ok: false, reason: 'write-failed', message: guard.message };
      const client = await workspaceArticleClient();
      return client ? workspaceArticles.createWorkspaceArticle(client, doc) : NOT_CONFIGURED_WS;
    },
  );

  ipcMain.handle(
    IPC.updateWorkspaceArticle,
    async (_e, base: WorkspaceDocument, edited: WorkspaceDocument): Promise<SaveWorkspaceArticleResult> => {
      const guard = await storageGuard('per-workspace');
      if (!guard.allowed) return { ok: false, reason: 'write-failed', message: guard.message };
      const client = await workspaceArticleClient();
      if (!client) return NOT_CONFIGURED_WS;
      // An update always has a base; only a create may merge without one.
      if (typeof base !== 'object' || base === null) {
        return {
          ok: false,
          reason: 'invalid-edit',
          errors: [{ path: '', code: 'invalid', message: 'An update needs the document it was edited from.' }],
          message: 'An update needs the document it was edited from.',
        };
      }
      // A change of backend never silently discards what the workspace holds
      // for the old one (VERM-33).
      const problem = typeof edited === 'object' && edited !== null && base.backend && edited.backend ? backendChangeProblem(base, edited) : null;
      if (problem) {
        return {
          ok: false,
          reason: 'invalid-edit',
          errors: [{ path: 'backend.kind', code: 'invalid', message: problem }],
          message: problem,
        };
      }
      return workspaceArticles.updateWorkspaceArticle(client, base, edited);
    },
  );

  // ─── Jira workspaces (VERM-33, VERM-34) ──────────────────────────────────────
  // One read-only Jira provider per workspace, bound to the workspace's own
  // connection, credential reference and per-project settings. It is kept
  // while those stay the same, so the credential is resolved and the token
  // probed once rather than on every board refresh, and dropped on any
  // failure so a revoked token or changed source is picked up on the next
  // call. The token never leaves the main process.
  const jiraProviders = new Map<string, { key: string; provider: Promise<JiraProvider> }>();

  async function workspaceJiraProvider(
    workspaceId: unknown,
  ): Promise<{ ok: true; provider: JiraProvider; doc: WorkspaceDocument } | WorkspaceJiraFailure> {
    const fail = (message: string, reason: WorkspaceJiraFailure['reason'] = 'error', credentialRef: string | null = null): WorkspaceJiraFailure =>
      ({ ok: false, message, reason, credentialRef });
    const client = await workspaceArticleClient();
    if (!client) return fail(NOT_CONFIGURED_WS.message);
    if (typeof workspaceId !== 'string' || workspaceId === '') return fail('No workspace ID was given.');
    const read = await workspaceArticles.readWorkspaceArticle(client, workspaceId);
    if (!read.ok) return fail(read.message);
    if (read.entry.status !== 'ok') return fail(read.entry.message);
    const doc = read.entry.document;
    if (doc.backend.kind !== 'jira') return fail(`"${doc.name}" is not a Jira workspace.`);
    const { siteUrl, email, cloudId, credentialRef } = doc.backend;
    const key = JSON.stringify([siteUrl, email, cloudId, credentialRef, doc.jiraProjects ?? {}]);

    const cached = jiraProviders.get(workspaceId);
    if (cached?.key === key) {
      try {
        return { ok: true, provider: await cached.provider, doc };
      } catch {
        jiraProviders.delete(workspaceId);
      }
    }
    const provider = (async () => {
      const r = await resolveWorkspaceCredential({ workspaceId, credentialRef }, await readConfig(), credentialSourceIO);
      let token: string;
      if (r.ok) {
        token = r.value;
      } else if (IS_E2E && e2eFakeJiraTokenAllowed(r)) {
        // e2e: resolution runs as on a real host, and a configured source
        // that fails stops it. Only a reference with nothing configured gets
        // the fake's token, or its rejected one to simulate a revoked token
        // (VERMILIAN_E2E_JIRA_401, VERM-40).
        token = process.env.VERMILIAN_E2E_JIRA_401 === '1' ? FAKE_JIRA_BAD_TOKEN : 'e2e-jira-token';
      } else {
        throw { message: r.message, reason: 'credential' };
      }
      const base = await jira.jiraApiBase({ siteUrl, email, cloudId }, token);
      return createJiraProvider(jira, { base, email, token }, doc.jiraProjects ?? {});
    })();
    jiraProviders.set(workspaceId, { key, provider });
    try {
      return { ok: true, provider: await provider, doc };
    } catch (e) {
      jiraProviders.delete(workspaceId);
      return classifyJiraFailure(e, 'Jira could not be reached.', credentialRef);
    }
  }

  function classifyJiraFailure(e: unknown, fallback: string, credentialRef: string | null): WorkspaceJiraFailure {
    const message = (e as { message?: string } | null)?.message ?? fallback;
    const reason = (e as { reason?: unknown } | null)?.reason === 'credential' ? 'credential' : isJiraUnauthorized(e) ? 'unauthorized' : 'error';
    return { ok: false, message, reason, credentialRef };
  }

  function jiraFailure(workspaceId: unknown, doc: WorkspaceDocument, e: unknown, fallback: string): WorkspaceJiraFailure {
    if (typeof workspaceId === 'string') jiraProviders.delete(workspaceId);
    return classifyJiraFailure(e, fallback, doc.backend.credentialRef ?? null);
  }

  // A refusal by Vermilian itself, not by Jira.
  const refused = (message: string, doc: WorkspaceDocument): WorkspaceJiraFailure =>
    ({ ok: false, message, reason: 'error', credentialRef: doc.backend.credentialRef ?? null });

  // Which of the workspace's own sources a request names: a chosen board
  // (boardId) or a chosen project (projectKey). Anything else is refused, so
  // a renderer cannot read a project or board just by naming it (VERM-59).
  function workspaceSource(
    doc: WorkspaceDocument,
    a: Record<string, unknown>,
  ): { kind: 'board'; boardId: number; label: string } | { kind: 'project'; projectKey: string; label: string } | WorkspaceJiraFailure {
    if (a.boardId !== undefined) {
      const boardId = a.boardId;
      const board = (doc.jiraBoards ?? []).find((b) => b.id === boardId);
      if (!board) return refused(`That board is not one of this workspace's Jira boards.`, doc);
      return { kind: 'board', boardId: board.id, label: board.name };
    }
    const projectKey = typeof a.projectKey === 'string' ? a.projectKey : '';
    if (!workspaceProjectIds(doc).includes(projectKey)) {
      return refused(`${projectKey || 'That project'} is not one of this workspace's Jira projects.`, doc);
    }
    return { kind: 'project', projectKey, label: projectKey };
  }

  // Which single tickets the workspace may read (VERM-59, VERM-83): in one of
  // its projects, on its own Runway, or on one of its boards — checked in that
  // order by providers/jiraAdmission.ts, where it is unit-tested. Boards are
  // asked through the workspace's own provider, and the Runway lookup sees
  // this workspace's rows only.
  function workspaceAdmission(provider: JiraProvider, doc: WorkspaceDocument): JiraAdmissionScope {
    return {
      projectKeys: workspaceProjectIds(doc),
      boardIds: workspaceBoardIds(doc),
      isOnBoard: (id, key) => provider.isOnBoard(id, key),
      isOnRunway: jiraRunwayLookup(openRunwayItemStore, doc.workspaceId),
    };
  }

  // Each Jira project's priority scheme order (VERM-93), for the Jira All
  // tasks board's Tracker priority sort, through the workspace's own provider.
  // Only the workspace's own projects and the projects of its Runway's Jira
  // tickets — the projects whose tickets the board can show — are read; any
  // other key is refused (left out), so a renderer cannot read the scheme of
  // a project just by naming it. The rules live in services/priorityOrders.ts.
  const jiraPriorityOrders = createPriorityOrders({
    async connection(workspaceId) {
      const p = await workspaceJiraProvider(workspaceId);
      if (!p.ok) return { ok: false, error: p.message };
      const allowed = new Set([
        ...workspaceProjectIds(p.doc),
        ...openRunwayItemStore()
          .list(p.doc.workspaceId)
          .filter((item) => item.kind === 'issue' && item.itemId.startsWith('jira:'))
          .map((item) => jiraProjectKeyOf(item.itemId.slice('jira:'.length))),
      ]);
      return {
        ok: true,
        async read(projectKey) {
          if (!allowed.has(projectKey)) throw new Error(`${projectKey} is not readable from this workspace.`);
          return p.provider.getPriorityValues(projectKey);
        },
      };
    },
  });
  ipcMain.handle(IPC.jiraPriorityOrders, (_e, args) => jiraPriorityOrders(args));

  ipcMain.handle(
    IPC.listWorkspaceJiraProjects,
    async (_e, workspaceId: unknown): Promise<ListWorkspaceJiraProjectsResult> => {
      const p = await workspaceJiraProvider(workspaceId);
      if (!p.ok) return p;
      try {
        return { ok: true, projects: await p.provider.getProjects() };
      } catch (e) {
        return jiraFailure(workspaceId, p.doc, e, 'The Jira projects could not be listed.');
      }
    },
  );

  // A status that cannot be read only shortens the filter's list: the board
  // keeps working from the statuses its issues carry (VERM-67).
  ipcMain.handle(
    IPC.listWorkspaceJiraStatuses,
    async (_e, workspaceId: unknown): Promise<ListWorkspaceJiraStatusesResult> => {
      const p = await workspaceJiraProvider(workspaceId);
      if (!p.ok) return p;
      const projectKeys = workspaceProjectIds(p.doc);
      const reads = await Promise.allSettled(projectKeys.map((key) => p.provider.getStatuses(key)));
      const statuses = [...new Set(reads.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])))];
      const boardsOnly = projectKeys.length === 0 && workspaceBoardIds(p.doc).length > 0;
      return { ok: true, statuses, incomplete: boardsOnly || reads.some((r) => r.status === 'rejected') };
    },
  );

  ipcMain.handle(
    IPC.listWorkspaceJiraBoards,
    async (_e, workspaceId: unknown): Promise<ListWorkspaceJiraBoardsResult> => {
      const p = await workspaceJiraProvider(workspaceId);
      if (!p.ok) return p;
      try {
        return { ok: true, boards: await p.provider.getBoards() };
      } catch (e) {
        return jiraFailure(workspaceId, p.doc, e, 'The Jira boards could not be listed. A scoped token needs read:board-scope:jira-software.');
      }
    },
  );

  ipcMain.handle(
    IPC.getWorkspaceJiraIssues,
    async (_e, args: unknown): Promise<GetWorkspaceJiraIssuesResult> => {
      const a = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>;
      const p = await workspaceJiraProvider(a.workspaceId);
      if (!p.ok) return p;
      // Only the workspace's own projects and boards: a renderer cannot read
      // any project the user can browse just by naming it.
      const source = workspaceSource(p.doc, a);
      if ('ok' in source) return source;
      if (source.kind === 'board') {
        try {
          const { issues, truncated } = await p.provider.getBoardIssues(source.boardId, a.includeResolved === true);
          // Each project the board's issues come from, for priority order.
          const projects = [...new Set(issues.map((i) => jiraProjectKeyOf(i.idReadable)))];
          const orders = await Promise.all(projects.map((k) => p.provider.getPriorityValues(k).catch(() => [] as string[])));
          return {
            ok: true, issues, priorities: [], truncated,
            prioritiesByProject: Object.fromEntries(projects.map((k, i) => [k, orders[i]])),
          };
        } catch (e) {
          return jiraFailure(a.workspaceId, p.doc, e, `The issues of board "${source.label}" could not be loaded.`);
        }
      }
      const projectKey = source.projectKey;
      try {
        const [issues, priorities] = await Promise.all([
          p.provider.getIssues(projectKey, a.includeResolved === true),
          p.provider.getPriorityValues(projectKey).catch(() => [] as string[]),
        ]);
        return { ok: true, issues, priorities };
      } catch (e) {
        return jiraFailure(a.workspaceId, p.doc, e, `The issues of ${projectKey} could not be loaded.`);
      }
    },
  );

  // The board's incremental poll (VERM-39): read-only, and limited to the
  // workspace's own projects exactly as the full read above is.
  ipcMain.handle(
    IPC.getWorkspaceJiraRecentlyUpdated,
    async (_e, args: unknown): Promise<GetWorkspaceJiraRecentlyUpdatedResult> => {
      const a = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>;
      const p = await workspaceJiraProvider(a.workspaceId);
      if (!p.ok) return p;
      const source = workspaceSource(p.doc, a);
      if ('ok' in source) return source;
      try {
        const issues = source.kind === 'board'
          ? await p.provider.getBoardRecentlyUpdatedIssues(source.boardId)
          : await p.provider.getRecentlyUpdatedIssues(source.projectKey);
        return { ok: true, issues };
      } catch (e) {
        return jiraFailure(a.workspaceId, p.doc, e, `The recent changes in ${source.label} could not be loaded.`);
      }
    },
  );

  ipcMain.handle(
    IPC.getWorkspaceJiraIssueDetail,
    async (_e, args: unknown): Promise<GetWorkspaceJiraIssueDetailResult> => {
      const a = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>;
      const issueKey = typeof a.issueKey === 'string' ? a.issueKey : '';
      if (!isJiraIssueKey(issueKey)) return { ok: false, message: 'That is not a Jira issue key.', reason: 'error', credentialRef: null };
      const p = await workspaceJiraProvider(a.workspaceId);
      if (!p.ok) return p;
      // Only issues the workspace admits — its projects, its Runway, its
      // boards — rechecked under the key Jira answers with if the issue moved.
      try {
        const read = await readAdmittedJiraIssue(
          workspaceAdmission(p.provider, p.doc),
          issueKey,
          (key) => Promise.all([p.provider.getIssueDetail(key), p.provider.getIssueContent(key)]),
          ([issue]) => issue.idReadable,
        );
        if (!read.ok) return refused(read.message, p.doc);
        const [issue, content] = read.value;
        const siteUrl = p.doc.backend.kind === 'jira' ? p.doc.backend.siteUrl : '';
        return { ok: true, issue, issueUrl: jiraIssueUrl(siteUrl, issue.idReadable), content };
      } catch (e) {
        return jiraFailure(a.workspaceId, p.doc, e, `${issueKey} could not be loaded.`);
      }
    },
  );

  // Board search (VERM-61): read-only, through the workspace's own provider.
  // Text search covers the workspace's projects and boards; an exact key is
  // returned only when the workspace admits it, which includes a ticket on its
  // own Runway (VERM-83). There is no fallback to another credential.
  ipcMain.handle(
    IPC.searchWorkspaceJiraIssues,
    async (_e, args: unknown): Promise<SearchWorkspaceJiraIssuesResult> => {
      const a = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>;
      const query = typeof a.query === 'string' ? a.query.slice(0, 500) : '';
      const p = await workspaceJiraProvider(a.workspaceId);
      if (!p.ok) return p;
      try {
        const { projectKeys, boardIds, isOnRunway } = workspaceAdmission(p.provider, p.doc);
        const scope = { projectKeys, boardIds, isOnRunway };
        return { ok: true, issues: await p.provider.searchWorkspace(scope, query) };
      } catch (e) {
        return jiraFailure(a.workspaceId, p.doc, e, 'The Jira search failed.');
      }
    },
  );

  ipcMain.handle(
    IPC.getWorkspaceJiraMyAccountId,
    async (_e, workspaceId: unknown): Promise<GetWorkspaceJiraMyAccountIdResult> => {
      const p = await workspaceJiraProvider(workspaceId);
      if (!p.ok) return p;
      try {
        return { ok: true, accountId: await p.provider.getMyAccountId() };
      } catch (e) {
        return jiraFailure(workspaceId, p.doc, e, 'The Jira account could not be read.');
      }
    },
  );

  // ─── Migration preview (VERM-44) ────────────────────────────────────────────
  // A dry run only. Migration itself runs inside activation (VERM-53, below);
  // there is no standalone apply. The backend server of every migrated
  // workspace is the configuration YouTrack in main settings.

  function migrationOptions(raw: unknown): WorkspaceMigrationOptions {
    const name = typeof raw === 'object' && raw !== null ? (raw as WorkspaceMigrationOptions).jiraWorkspaceName : undefined;
    return typeof name === 'string' ? { jiraWorkspaceName: name } : {};
  }

  ipcMain.handle(IPC.planWorkspaceMigration, async (_e, options: unknown): Promise<WorkspaceMigrationResult> => {
    const cfg = await readConfig();
    const token = await loadYtToken(cfg);
    if (!cfg.youtrackUrl || !token) return NOT_CONFIGURED_WS;
    return workspaceMigration.planWorkspaceMigration(youtrackWorkspaceMigrationClient(cfg.youtrackUrl, token), cfg.youtrackUrl, migrationOptions(options));
  });

  // ─── Per-workspace storage: activation, guard, return (VERM-53) ─────────────
  // The marker and configuration articles always go through the Settings
  // connection. Activation and the return to legacy storage require an
  // explicit `confirmed: true` from Settings; neither ever runs on its own.

  async function storageClient(): Promise<StorageActivationClient | null> {
    const cfg = await readConfig();
    const token = await loadYtToken(cfg);
    return cfg.youtrackUrl && token ? youtrackStorageActivationClient(cfg.youtrackUrl, token) : null;
  }

  // Every configuration write is authorized against a fresh read of the
  // marker; no cached marker ever authorizes a write (VERM-53 review).
  async function storageGuard(mode: WorkspaceStorageMode): Promise<StorageGuard> {
    return authorizeConfigWrite(mode, readLocalStorageState(), await storageClient());
  }

  articleConfig.setWriteGuard(() => storageGuard('legacy'));

  function activationDeps(client: StorageActivationClient, serverUrl: string): ActivationDeps {
    return {
      client,
      serverUrl,
      local: { read: async () => readLocalStorageState(), write: writeLocalStorageState },
      backup: { write: writeActivationBackup, read: readActivationBackup },
      async checkCredential(workspaceId, credentialRef) {
        const r = await checkWorkspaceCredential({ workspaceId, credentialRef }, await readConfig(), credentialSourceIO);
        // e2e: only a reference with nothing configured gets the fake's
        // stand-in; a configured source that fails still fails.
        if (!r.ok && IS_E2E && e2eFakeCredentialAllowed(credentialRef, r.reason)) return { ok: true, credentialRef, source: 'command' };
        return r;
      },
      now: () => new Date(),
      newGeneration: () => randomUUID(),
    };
  }

  function notifyStorageChanged(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('config:article-synced');
    }
  }

  ipcMain.handle(IPC.getStorageStatus, async (): Promise<StorageStatusView> => {
    const local = readLocalStorageState();
    const client = await storageClient();
    const status = client
      ? await storageStatus({ client, local: { read: async () => local, write: writeLocalStorageState } })
      : null;
    const marker = status?.marker ?? { status: 'error' as const, message: 'YouTrack is not configured.' };
    return {
      mode: local.state.mode,
      generation: local.state.generation,
      localCorrupt: local.corrupt,
      backupFile: local.state.backupFile,
      marker: marker.status === 'ok' ? marker.marker.state : marker.status === 'none' ? 'none' : 'unverified',
      markerGeneration: marker.status === 'ok' ? marker.marker.generation : null,
      activatedAt: marker.status === 'ok' ? marker.marker.activatedAt : null,
      guard: status?.guard ?? { allowed: false, reason: 'not-configured', message: 'Connect YouTrack first — configuration is stored there.' },
      legacyChangedSinceActivation: status?.legacyChangedSinceActivation ?? null,
    };
  });

  ipcMain.handle(IPC.activateWorkspaceStorage, async (_e, raw: unknown): Promise<ActivationResult> => {
    const args = (typeof raw === 'object' && raw !== null ? raw : {}) as { confirmed?: unknown; jiraWorkspaceName?: unknown };
    const cfg = await readConfig();
    const client = await storageClient();
    if (!client) return { ok: false, reason: 'source-unreadable', message: NOT_CONFIGURED_WS.message };
    if (args.confirmed !== true) return { ok: false, reason: 'not-confirmed', message: 'Activation was not confirmed; nothing was done.' };
    if (articleConfig.isFrozenForActivation()) {
      return { ok: false, reason: 'legacy-save-unresolved', message: 'An activation is already running on this computer.' };
    }
    // Hard gate (VERM-53 review): no edit to _vermilian-config may be unsaved
    // or land while activation runs. Edits are paused first; any unsaved one
    // must be written and verified, or activation does not start.
    const token = (await loadYtToken(cfg)) ?? '';
    articleConfig.freezeForActivation();
    try {
      const settled = await articleConfig.settleForActivation(cfg.youtrackUrl, token);
      if (!settled.ok) return { ok: false, reason: 'legacy-save-unresolved', message: settled.message };
      const r = await activateWorkspaceStorage(activationDeps(client, cfg.youtrackUrl), {
        confirmed: true,
        ...migrationOptions(args),
      });
      if (r.ok) notifyStorageChanged();
      return r;
    } finally {
      articleConfig.unfreezeAfterActivation(cfg.youtrackUrl, token);
    }
  });

  ipcMain.handle(IPC.returnToLegacyStorage, async (_e, raw: unknown): Promise<RollbackResult> => {
    const args = (typeof raw === 'object' && raw !== null ? raw : {}) as { confirmed?: unknown };
    const cfg = await readConfig();
    const client = await storageClient();
    if (!client) return { ok: false, reason: 'marker-unverified', message: NOT_CONFIGURED_WS.message };
    const r = await returnToLegacyStorage(activationDeps(client, cfg.youtrackUrl), { confirmed: args.confirmed === true });
    if (r.ok) {
      // Reload the legacy article fresh: this machine reads it again now.
      const token = await loadYtToken(cfg);
      if (token) await articleConfig.forceReload(cfg.youtrackUrl, token).catch(() => undefined);
      notifyStorageChanged();
    }
    return r;
  });

  // ─── Per-workspace configuration writes (VERM-53, decision 3) ───────────────
  // Workspaces, folders, projects, board settings and dismissals go to the
  // workspace's own article through the merge-and-verify write
  // (services/workspaceArticles.ts), after the storage guard.

  type WorkspaceWrite = { ok: true } | { ok: false; error: string };

  async function guardedWorkspaceWrite(
    run: (client: WorkspaceArticleClient) => Promise<WorkspaceWrite>,
  ): Promise<WorkspaceWrite> {
    const guard = await storageGuard('per-workspace');
    if (!guard.allowed) return { ok: false, error: guard.message };
    const client = await workspaceArticleClient();
    if (!client) return { ok: false, error: NOT_CONFIGURED_WS.message };
    return run(client);
  }

  /** Apply `edit` to the active workspace's article. */
  async function editActiveWorkspace(edit: (doc: WorkspaceDocument) => WorkspaceDocument | string): Promise<WorkspaceWrite> {
    return guardedWorkspaceWrite(async (client) => {
      const activeId = (await activeWorkspaceContext()).workspaceId;
      if (!activeId) return { ok: false, error: NO_WORKSPACE_MESSAGE };
      const read = await workspaceArticles.readWorkspaceArticle(client, activeId);
      if (!read.ok) return { ok: false, error: read.message };
      if (read.entry.status !== 'ok') return { ok: false, error: read.entry.message };
      const base = read.entry.document;
      const edited = edit(base);
      if (typeof edited === 'string') return { ok: false, error: edited };
      const saved = await workspaceArticles.updateWorkspaceArticle(client, base, edited);
      return saved.ok ? { ok: true } : { ok: false, error: saved.message };
    });
  }

  /** The rail's layout (VermilianConfig) written as one article per workspace. */
  async function savePerWorkspaceLayout(config: VermilianConfig): Promise<WorkspaceWrite> {
    return guardedWorkspaceWrite(async (client) => {
      const listed = await workspaceArticles.listWorkspaceArticles(client);
      if (!listed.ok) return { ok: false, error: listed.message };
      const existing = new Map(listed.workspaces.map((e) => [e.workspaceId, e]));
      const plan = planLayoutWrites(config, existing);
      if (!plan.ok) return { ok: false, error: plan.error };
      for (const w of plan.writes) {
        const r = await workspaceArticles.updateWorkspaceArticle(client, w.base, w.edited);
        if (!r.ok) return { ok: false, error: r.message };
      }
      return { ok: true };
    });
  }

  /** Move the projects first, so a failed delete can never lose them (VERM-72). */
  async function deletePerWorkspace(workspaceId: string, destinationId: string | null): Promise<WorkspaceWrite> {
    return guardedWorkspaceWrite(async (client) => {
      const listed = await workspaceArticles.listWorkspaceArticles(client);
      if (!listed.ok) return { ok: false, error: listed.message };
      const existing = new Map(listed.workspaces.map((e) => [e.workspaceId, e]));
      const plan = planWorkspaceDelete(workspaceId, destinationId, existing, `folder-${Date.now()}`);
      if (!plan.ok) return { ok: false, error: plan.error };
      if (plan.destinationWrite) {
        const { base, edited } = plan.destinationWrite;
        const moved = await workspaceArticles.updateWorkspaceArticle(client, base, edited);
        if (!moved.ok) return { ok: false, error: moved.message };
      }
      const deleted = await workspaceArticles.deleteWorkspaceArticle(client, workspaceId, plan.expectedUpdated);
      return deleted.ok ? { ok: true } : { ok: false, error: deleted.message };
    });
  }

  // ─── Per-reference credentials (VERM-45) ────────────────────────────────────
  // Configuration, status and saving. The check resolves in this process and
  // returns only which source worked, or the failure — never the value.

  ipcMain.handle(IPC.listCredentialRefs, async (): Promise<CredentialRefStatus[]> => {
    const cfg = await readConfig();
    const refs = new Set<string>([
      ...Object.keys(LEGACY_CREDENTIAL_REFS),
      ...Object.keys(cfg.credentialSources),
      ...(await listCredentialRefBlobs()),
    ]);
    return Promise.all([...refs].sort().map((ref) => credentialRefStatus(ref, cfg, credentialSourceIO)));
  });

  ipcMain.handle(
    IPC.setCredentialRefSources,
    async (_e, ref: unknown, sources: unknown): Promise<CredentialRefWriteResult> => {
      if (!isCredentialRef(ref)) return { ok: false, reason: 'invalid-reference' };
      if (isLegacyCredentialRef(ref)) return { ok: false, reason: 'legacy-reference' };
      const s = (typeof sources === 'object' && sources !== null ? sources : {}) as Record<string, unknown>;
      const command = typeof s.command === 'string' ? s.command.trim() : '';
      const file = typeof s.file === 'string' ? s.file.trim() : '';
      try {
        const cfg = await readConfig();
        const next = { ...cfg.credentialSources };
        if (command || file) next[ref] = { command, file };
        else delete next[ref];
        await writeConfig({ credentialSources: next });
        return { ok: true };
      } catch {
        return { ok: false, reason: 'write-failed' };
      }
    },
  );

  ipcMain.handle(IPC.saveCredentialRefSecret, (_e, ref: unknown, value: unknown) =>
    saveCredentialRefSecret(String(ref), typeof value === 'string' ? value : ''),
  );

  ipcMain.handle(IPC.clearCredentialRefSecret, (_e, ref: unknown) => clearCredentialRefSecret(String(ref)));

  ipcMain.handle(IPC.getCredentialRefStatus, async (_e, ref: unknown): Promise<CredentialRefStatusResult> => {
    if (!isCredentialRef(ref)) return { ok: false, message: 'That is not a valid credential reference.' };
    try {
      const workspaceId = workspaceStorageMode() === 'per-workspace' ? (await activeWorkspaceContext()).workspaceId : '';
      return { ok: true, status: await credentialRefStatus(ref, await readConfig(), credentialSourceIO, workspaceId) };
    } catch {
      return { ok: false, message: 'The credential configuration could not be read.' };
    }
  });

  ipcMain.handle(
    IPC.checkWorkspaceCredential,
    async (_e, workspaceId: unknown, ref: unknown): Promise<WorkspaceCredentialCheck> => {
      return checkWorkspaceCredential(
        { workspaceId: String(workspaceId ?? ''), credentialRef: ref === null ? null : String(ref ?? '') },
        await readConfig(),
        credentialSourceIO,
      );
    },
  );

  // ─── OpenBao credential backend (VERM-64) ───────────────────────────────────
  // The renderer names a scope kind only; which workspace is meant is decided
  // here, so a renderer can never reach another workspace's configuration.

  async function openBaoTarget(scope: unknown): Promise<{
    scopeId: string;
    label: string;
    refs: CredentialRef[];
    settings: boolean;
  } | null> {
    if (scope === 'settings') {
      return {
        scopeId: SETTINGS_SCOPE_ID,
        label: 'The YouTrack, Claude and Jira credentials in Settings. Vermilian loads your workspaces with these.',
        refs: Object.keys(LEGACY_CREDENTIAL_REFS),
        settings: true,
      };
    }
    if (scope !== 'workspace' || workspaceStorageMode() !== 'per-workspace') return null;
    const doc = await perWorkspaceDocument((await activeWorkspaceContext()).workspaceId);
    if (!doc) return null;
    const refs = [doc.backend.credentialRef, aiCredentialRefOf('per-workspace', doc)]
      .filter((r): r is CredentialRef => typeof r === 'string');
    return { scopeId: doc.workspaceId, label: `Workspace: ${doc.name}`, refs: [...new Set(refs)], settings: false };
  }

  const NO_OPENBAO_TARGET: OpenBaoWriteResult = {
    ok: false,
    message: 'This scope is not available. Workspace credentials need per-workspace storage and an active workspace.',
  };

  async function originalSourceOf(ref: CredentialRef, cfg: AppConfig): Promise<OpenBaoReferenceState['original']> {
    const blobPresent = await credentialSourceIO.blobPresent(blobFilenameFor(ref), isLegacyCredentialRef(ref));
    const source = selectSource(sourcesFor(ref, cfg), blobPresent);
    return source === 'openbao' ? null : source;
  }

  async function setOpenBaoBindings(
    scopeId: string,
    change: (current: OpenBaoScopeConfig['credentials']) => OpenBaoScopeConfig['credentials'],
  ): Promise<boolean> {
    try {
      const cfg = await readConfig();
      const scope = cfg.openbaoScopes[scopeId];
      if (!scope) return false;
      await writeConfig({
        openbaoScopes: { ...cfg.openbaoScopes, [scopeId]: { ...scope, credentials: change(scope.credentials) } },
      });
      return true;
    } catch {
      return false;
    }
  }

  ipcMain.handle(IPC.openbaoGetState, async (_e, scope: unknown): Promise<OpenBaoScopeState> => {
    const kind: OpenBaoScope = scope === 'workspace' ? 'workspace' : 'settings';
    const target = await openBaoTarget(kind);
    if (!target) {
      return { scope: kind, available: false, label: NO_OPENBAO_TARGET.message, connection: null, references: [] };
    }
    const cfg = await readConfig();
    const stored = cfg.openbaoScopes[target.scopeId];
    const references = await Promise.all(target.refs.map(async (ref): Promise<OpenBaoReferenceState> => ({
      credentialRef: ref,
      active: Boolean(stored?.credentials[ref]),
      binding: stored?.credentials[ref] ?? defaultOpenBaoBinding(ref),
      original: await originalSourceOf(ref, cfg),
    })));
    let connection: OpenBaoConnection | null = null;
    if (stored) {
      const { credentials: _bindings, ...rest } = stored;
      void _bindings;
      connection = rest;
    }
    return { scope: kind, available: true, label: target.label, connection, references };
  });

  ipcMain.handle(IPC.openbaoSaveConnection, async (_e, scope: unknown, input: unknown): Promise<OpenBaoWriteResult> => {
    const target = await openBaoTarget(scope);
    if (!target) return NO_OPENBAO_TARGET;
    const parsed = sanitiseOpenBaoScopes({ [target.scopeId]: input })[target.scopeId];
    const checked = parsed ? checkOpenBaoConnection(parsed) : { ok: false as const, problems: ['The connection is incomplete.'] };
    if (!checked.ok) return { ok: false, message: checked.problems.join(' ') };
    const cfg = await readConfig();
    const current = cfg.openbaoScopes[target.scopeId];
    const next = checked.connection;
    const moved = current && (current.url !== next.url || current.namespace !== next.namespace
      || current.kvMount !== next.kvMount || current.pathPrefix !== next.pathPrefix);
    if (moved && Object.keys(current.credentials).length > 0) {
      return { ok: false, message: 'Stop using OpenBao for every credential here before moving to a different server or path.' };
    }
    try {
      await writeConfig({
        openbaoScopes: { ...cfg.openbaoScopes, [target.scopeId]: { ...next, credentials: current?.credentials ?? {} } },
      });
    } catch {
      return { ok: false, message: 'The connection could not be saved.' };
    }
    openBaoClient.forget(target.scopeId);
    return { ok: true, message: 'Connection saved.' };
  });

  ipcMain.handle(IPC.openbaoTest, async (_e, scope: unknown): Promise<OpenBaoTestResult> => {
    const target = await openBaoTarget(scope);
    const stored = target ? (await readConfig()).openbaoScopes[target.scopeId] : undefined;
    if (!target || !stored) return { status: 'incomplete', message: describeOpenBaoTest('incomplete'), references: [] };
    const bindings = Object.entries(stored.credentials).map(([credentialRef, binding]) => ({ credentialRef, binding }));
    return openBaoClient.test(target.scopeId, stored, bindings);
  });

  ipcMain.handle(IPC.openbaoMigrate, async (_e, scope: unknown, refs: unknown): Promise<OpenBaoMigrationResult> => {
    const refused = (message: string): OpenBaoMigrationResult => ({ ok: false, activated: false, message, references: [] });
    const target = await openBaoTarget(scope);
    if (!target) return refused(NO_OPENBAO_TARGET.message);
    const cfg = await readConfig();
    const stored = cfg.openbaoScopes[target.scopeId];
    if (!stored) return refused(describeOpenBaoTest('incomplete'));
    const wanted = Array.isArray(refs) ? refs.filter((r): r is CredentialRef => target.refs.includes(r as CredentialRef)) : [];
    // The original is read with OpenBao out of the picture, so a retry can never
    // copy a value from OpenBao back onto itself.
    const localOnly: AppConfig = { ...cfg, openbaoScopes: {} };
    return migrateToOpenBao({
      references: wanted.map((credentialRef) => ({
        credentialRef,
        binding: stored.credentials[credentialRef] ?? defaultOpenBaoBinding(credentialRef),
        active: Boolean(stored.credentials[credentialRef]),
      })),
      readOriginal: async (credentialRef) => {
        const r = await resolveWorkspaceCredential({ workspaceId: target.settings ? 'settings' : target.scopeId, credentialRef }, localOnly, credentialSourceIO);
        return r.ok ? { ok: true, value: r.value } : { ok: false, message: r.message };
      },
      store: (binding, value) => openBaoClient.storeVerified(target.scopeId, stored, binding, value, { overwrite: false }),
      activate: (verified) => setOpenBaoBindings(target.scopeId, (current) => ({
        ...current,
        ...Object.fromEntries(verified.map((v) => [v.credentialRef, v.binding])),
      })),
    });
  });

  ipcMain.handle(IPC.openbaoSaveSecret, async (_e, scope: unknown, ref: unknown, value: unknown): Promise<OpenBaoWriteResult> => {
    const target = await openBaoTarget(scope);
    if (!target) return NO_OPENBAO_TARGET;
    if (!target.refs.includes(ref as CredentialRef)) return { ok: false, message: 'That credential does not belong here.' };
    const credentialRef = ref as CredentialRef;
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (checkCredentialValue(trimmed) !== 'ok') return { ok: false, message: 'That is not a single credential value.' };
    const stored = (await readConfig()).openbaoScopes[target.scopeId];
    if (!stored) return { ok: false, message: describeOpenBaoTest('incomplete') };
    const binding = stored.credentials[credentialRef] ?? defaultOpenBaoBinding(credentialRef);
    const r = await openBaoClient.storeVerified(target.scopeId, stored, binding, trimmed, { overwrite: true });
    if (!r.ok) return { ok: false, message: OPENBAO_REASON_TEXT[r.reason] };
    const saved = await setOpenBaoBindings(target.scopeId, (c) => ({ ...c, [credentialRef]: binding }));
    return saved
      ? { ok: true, message: 'Stored in OpenBao and verified.' }
      : { ok: false, message: 'Stored in OpenBao, but the switch could not be saved.' };
  });

  ipcMain.handle(IPC.openbaoDeleteSecret, async (_e, scope: unknown, ref: unknown, args: unknown): Promise<OpenBaoWriteResult> => {
    if ((args as { confirmed?: unknown } | null)?.confirmed !== true) return { ok: false, message: 'Deleting needs confirmation.' };
    const target = await openBaoTarget(scope);
    if (!target) return NO_OPENBAO_TARGET;
    if (!target.refs.includes(ref as CredentialRef)) return { ok: false, message: 'That credential does not belong here.' };
    const credentialRef = ref as CredentialRef;
    const stored = (await readConfig()).openbaoScopes[target.scopeId];
    if (!stored) return { ok: false, message: describeOpenBaoTest('incomplete') };
    if (stored.credentials[credentialRef]) return { ok: false, message: 'Stop using OpenBao for this credential before deleting it.' };
    const r = await openBaoClient.deleteField(target.scopeId, stored, defaultOpenBaoBinding(credentialRef));
    return r.ok ? { ok: true, message: 'Deleted from OpenBao.' } : { ok: false, message: OPENBAO_REASON_TEXT[r.reason] };
  });

  ipcMain.handle(IPC.openbaoDeactivate, async (_e, scope: unknown, ref: unknown): Promise<OpenBaoWriteResult> => {
    const target = await openBaoTarget(scope);
    if (!target) return NO_OPENBAO_TARGET;
    if (!target.refs.includes(ref as CredentialRef)) return { ok: false, message: 'That credential does not belong here.' };
    const saved = await setOpenBaoBindings(target.scopeId, (current) => {
      const next = { ...current };
      delete next[ref as CredentialRef];
      return next;
    });
    return saved
      ? { ok: true, message: 'This credential no longer uses OpenBao. The copy in OpenBao was kept.' }
      : { ok: false, message: 'The change could not be saved.' };
  });

  ipcMain.handle(IPC.openbaoCleanupOriginal, async (_e, scope: unknown, ref: unknown, args: unknown): Promise<OpenBaoWriteResult> => {
    if ((args as { confirmed?: unknown } | null)?.confirmed !== true) return { ok: false, message: 'Removing the local copy needs confirmation.' };
    const target = await openBaoTarget(scope);
    if (!target) return NO_OPENBAO_TARGET;
    if (!target.refs.includes(ref as CredentialRef)) return { ok: false, message: 'That credential does not belong here.' };
    const credentialRef = ref as CredentialRef;
    const legacy = isLegacyCredentialRef(credentialRef);
    const stored = (await readConfig()).openbaoScopes[target.scopeId];
    const binding = stored?.credentials[credentialRef];
    let otherUsers: number | null = 0;
    if (!target.settings) {
      const client = await workspaceArticleClient();
      const listed = client ? await workspaceArticles.listWorkspaceArticles(client) : null;
      const cfg = await readConfig();
      otherUsers = listed?.ok
        ? listed.workspaces.flatMap((e) => (e.status === 'ok' ? [e.document] : [])).filter((d) =>
          d.workspaceId !== target.scopeId
          && (d.backend.credentialRef === credentialRef || aiCredentialRefOf('per-workspace', d) === credentialRef)
          && !openBaoSourceFor(credentialRef, d.workspaceId, cfg)).length
        : null;
    }
    const blocked = cleanupBlocker({ legacy, settingsScope: target.settings, active: Boolean(binding), otherUsers });
    if (blocked) return { ok: false, message: blocked };
    // The copy in OpenBao must be readable now, or the local copy is the only one left.
    const live = await openBaoClient.readField(target.scopeId, stored, binding);
    if (!live.ok) return { ok: false, message: `The local copy was kept. ${OPENBAO_REASON_TEXT[live.reason]}` };
    const removed = legacy
      ? await clearLegacySecret(blobFilenameFor(credentialRef))
      : (await clearCredentialRefSecret(credentialRef)).ok;
    return removed ? { ok: true, message: 'The saved local copy was removed.' } : { ok: false, message: 'The local copy could not be removed.' };
  });

  ipcMain.handle(
    IPC.standupGenerate,
    async (_e, args: StandupGenerateArgs): Promise<StandupGenerateResult> => {
      try {
        const cfg = await readConfig();
        const windowHours =
          args.window === '24h' ? 24
          : args.window === '48h' ? 48
          : args.window === '7d' ? 168
          : (args.customWindowHours ?? 48);
        // The active workspace only (VERM-48, services/workspaceStandup.ts):
        // one workspace identity for the Anthropic key, the projects and the
        // YouTrack connection. Any scope a caller sends is ignored.
        return await generateWorkspaceStandup({
          ...workspaceReportSource(cfg),
          beginAi: () => beginAi(args.workspaceId),
          generate: (key, issues) => claude.generateStandupReport(key, issues, cfg.modelForStandup),
          cutoffMs: Date.now() - windowHours * 60 * 60 * 1000,
        });
      } catch (e) {
        const err = e as { message?: string };
        return { ok: false, error: err.message ?? 'Stand-up generation failed.' };
      }
    },
  );

  ipcMain.handle(
    IPC.standupSave,
    async (_e, args: StandupSaveArgs): Promise<StandupSaveResult> => {
      try {
        await standupService.saveToFile(
          args.markdown,
          args.folder,
          args.dateStr,
          args.timeStr,
        );
        return { ok: true };
      } catch (e) {
        const err = e as { message?: string };
        return { ok: false, error: err.message ?? 'Failed to save file.' };
      }
    },
  );

  ipcMain.handle(
    IPC.timerPostWorklog,
    async (_e, args: PostWorklogArgs): Promise<PostWorklogResult> => {
      try {
        const cfg = await readConfig();
        const yt = await trackerConnection(cfg);
        if (!yt.ok) return { ok: false, error: yt.error };
        await youtrackTracker(yt.url, yt.token).postWorklog(args.issueId, args.minutes, args.worklogType);
        return { ok: true };
      } catch (e) {
        const err = e as { message?: string };
        return { ok: false, error: err.message ?? 'Failed to post worklog.' };
      }
    },
  );

  ipcMain.handle(IPC.timerCheckpoint, async (_e, data: TimerCheckpointData): Promise<void> => {
    await checkpoint.writeCheckpoint(data);
  });

  ipcMain.handle(IPC.timerClearCheckpoint, async (): Promise<void> => {
    await checkpoint.clearCheckpoint();
  });

  ipcMain.handle(IPC.timerReadCheckpoint, async (): Promise<TimerCheckpointData | null> => {
    return checkpoint.readCheckpoint();
  });

  ipcMain.handle(IPC.timerSetQuitProtection, (_e, active: boolean): void => {
    quitProtected = active;
  });

  ipcMain.handle(IPC.timerProceedQuit, (): void => {
    forceQuit();
  });

  // ─── Board configuration ────────────────────────────────────────────────────

  ipcMain.handle(IPC.getBoardConfig, async (_e, projectId: string): Promise<BoardConfig> => {
    if (workspaceStorageMode() === 'per-workspace') {
      // The active workspace's own board settings (VERM-53).
      const doc = await perWorkspaceDocument((await activeWorkspaceContext()).workspaceId);
      return doc?.boards[projectId] ?? defaultBoardConfig(projectId);
    }
    // Ensure Article is loaded (no-op if already cached).
    const cfg = await readConfig();
    const token = await loadYtToken(cfg);
    if (cfg.youtrackUrl && token && !articleConfig.getCachedConfig()) {
      try { await articleConfig.load(cfg.youtrackUrl, token); } catch { /* ignore */ }
    }
    return articleConfig.getBoardConfig(projectId);
  });

  ipcMain.handle(IPC.saveBoardConfig, async (_e, config: BoardConfig): Promise<void> => {
    if (workspaceStorageMode() === 'per-workspace') {
      const r = await editActiveWorkspace((doc) =>
        workspaceProjectIds(doc).includes(config.boardId)
          ? { ...doc, boards: { ...doc.boards, [config.boardId]: config } }
          : `Project ${config.boardId} is not in the active workspace; its board settings were not saved.`,
      );
      if (!r.ok) notifySyncStatus({ kind: 'storage-blocked', message: r.error });
      return;
    }
    if (!articleConfig.updateBoardConfig(config)) {
      notifySyncStatus({ kind: 'storage-blocked', message: articleConfig.ACTIVATION_IN_PROGRESS_MESSAGE });
      return;
    }
    const cfg = await readConfig();
    const token = await loadYtToken(cfg);
    if (cfg.youtrackUrl && token) articleConfig.scheduleSave(cfg.youtrackUrl, token);
  });

  // ─── Priority Desk "Not this week" dismissals (VERM-6) ───────────────────────
  // Same shape as the board-config handlers above: read/write the Article
  // cache, schedule a debounced remote write. No local-file fallback — like
  // board colors, this is non-critical UI state, not something the app needs
  // to function offline.

  ipcMain.handle(IPC.getDismissals, async (): Promise<Dismissals> => {
    if (workspaceStorageMode() === 'per-workspace') {
      const doc = await perWorkspaceDocument((await activeWorkspaceContext()).workspaceId);
      return doc?.dismissals ?? {};
    }
    const cfg = await readConfig();
    const token = await loadYtToken(cfg);
    if (cfg.youtrackUrl && token && !articleConfig.getCachedConfig()) {
      try { await articleConfig.load(cfg.youtrackUrl, token); } catch { /* ignore */ }
    }
    return articleConfig.getDismissals();
  });

  ipcMain.handle(IPC.runwayGet, async (_e, args: RunwayGetArgs): Promise<RunwayResult> => {
    try {
      // storeForIssue rejects a malformed or bare ID before any store is used.
      const issueId = args.issueId as NamespacedIssueId;
      const entry = await storeForIssue(runwayStores, issueId).get(args.workspaceId, issueId);
      return { ok: true, entry };
    } catch (e) {
      return runwayFailure(e);
    }
  });

  ipcMain.handle(IPC.runwayUpdate, async (_e, args: RunwayUpdateArgs): Promise<RunwayResult> => {
    try {
      const issueId = args.issueId as NamespacedIssueId;
      const entry = await runwayGate.run(() =>
        storeForIssue(runwayStores, issueId).update(args.workspaceId, issueId, args.patch),
      );
      return { ok: true, entry };
    } catch (e) {
      return runwayFailure(e);
    }
  });

  ipcMain.handle(IPC.runwayList, async (_e, args: RunwayListArgs): Promise<RunwayListResult> => {
    try {
      if (typeof args?.workspaceId !== 'string' || args.workspaceId.length === 0) {
        throw new Error('A workspace ID is required');
      }
      return { ok: true, entries: await runwayStores.jira.list(args.workspaceId) };
    } catch (e) {
      return runwayFailure(e);
    }
  });

  // Workspace Runway order (VERM-82). The rules — workspace resolved here from
  // the configuration, writes for the active workspace only, a ticket on the
  // workspace's own tracker, every write through runwayGate — live in
  // services/runwayItemIpc.ts, where they are unit-tested.
  async function runwayWorkspaces() {
    const { choices, legacyHint } = await workspaceChoices();
    return {
      activeId: resolveActiveWorkspaceId(choices, await readStoredActiveWorkspaceId(), legacyHint),
      workspaces: choices,
    };
  }
  const runwayItems = createRunwayItemHandlers({
    store: openRunwayItemStore,
    gate: runwayGate,
    workspaces: runwayWorkspaces,
    generation: activeWorkspaceGeneration,
  });
  ipcMain.handle(IPC.runwayItemsList, (_e, args) => runwayItems.list(args));
  ipcMain.handle(IPC.runwayItemsAddIssue, (_e, args) => runwayItems.addIssue(args));
  ipcMain.handle(IPC.runwayItemsAddIssueAtNumber, (_e, args) => runwayItems.addIssueAtNumber(args));
  ipcMain.handle(IPC.runwayItemsAddSection, (_e, args) => runwayItems.addSection(args));
  ipcMain.handle(IPC.runwayItemsAddNote, (_e, args) => runwayItems.addNote(args));
  ipcMain.handle(IPC.runwayItemsRemove, (_e, args) => runwayItems.remove(args));
  ipcMain.handle(IPC.runwayItemsMove, (_e, args) => runwayItems.move(args));
  ipcMain.handle(IPC.runwayItemsAddIssueAbove, (_e, args) => runwayItems.addIssueAbove(args));
  ipcMain.handle(IPC.runwayItemsMoveAbove, (_e, args) => runwayItems.moveAbove(args));
  ipcMain.handle(IPC.runwayItemsMoveToNumber, (_e, args) => runwayItems.moveToNumber(args));
  ipcMain.handle(IPC.runwayItemsMoveUp, (_e, args) => runwayItems.moveUp(args));
  ipcMain.handle(IPC.runwayItemsMoveDown, (_e, args) => runwayItems.moveDown(args));

  // Runway tickets' tracker data (VERM-84), read on the workspace's own
  // connection only:
  //   - a Jira workspace: its own Jira provider (workspaceJiraProvider);
  //   - a YouTrack workspace under per-workspace storage: its own server and
  //     credential reference, resolved with no fallback — the Settings
  //     YouTrack token is never used;
  //   - a YouTrack workspace under legacy shared storage: the Settings
  //     YouTrack connection. In that mode no workspace has a credential of
  //     its own; every board, search and detail read already uses the
  //     Settings connection, so it is the workspace's own, not a fallback.
  // A connection that fails is the read's error; no other credential is
  // tried. The rules live in services/runwayTicketFetch.ts (unit-tested).
  async function runwayReader(workspaceId: string, tracker: TrackerKind): Promise<RunwayReaderResult> {
    if (tracker === 'jira') {
      const r = await workspaceJiraProvider(workspaceId);
      if (!r.ok) return { ok: false, code: r.reason === 'error' ? 'refresh-failed' : r.reason, error: r.message };
      return { ok: true, reader: jiraRunwayReader(r.provider, workspaceAdmission(r.provider, r.doc)) };
    }
    const cfg = await readConfig();
    const yt =
      workspaceStorageMode() === 'per-workspace'
        ? await resolveWorkspaceYouTrackConnection(await perWorkspaceDocument(workspaceId), cfg, credentialSourceIO, IS_E2E)
        : await trackerConnection(cfg);
    if (!yt.ok) return { ok: false, code: 'credential', error: yt.error };
    return { ok: true, reader: youtrackRunwayReader(youtrackTracker(yt.url, yt.token)) };
  }
  const resolveRunwayTickets = createRunwayTicketFetch({
    workspaces: runwayWorkspaces,
    items: (workspaceId) => openRunwayItemStore().list(workspaceId),
    reader: runwayReader,
  });
  ipcMain.handle(IPC.runwayItemsResolve, (_e, args) => resolveRunwayTickets(args));

  // Each YouTrack project's Priority bundle order (VERM-92), for the All tasks
  // Tracker priority sort: read-only, on the workspace's own YouTrack
  // connection — the same one runwayReader opens — and only for a configured
  // YouTrack workspace. The rules live in services/priorityOrders.ts.
  const youtrackPriorityOrders = createPriorityOrders({
    async connection(workspaceId) {
      const { workspaces } = await runwayWorkspaces();
      const workspace = workspaces.find((w) => w.id === workspaceId);
      if (!workspace) return { ok: false, error: `No workspace ${workspaceId} is configured` };
      if (runwayWorkspaceTracker(workspace) !== 'youtrack') return { ok: false, error: 'Not a YouTrack workspace.' };
      const cfg = await readConfig();
      const yt =
        workspaceStorageMode() === 'per-workspace'
          ? await resolveWorkspaceYouTrackConnection(await perWorkspaceDocument(workspaceId), cfg, credentialSourceIO, IS_E2E)
          : await trackerConnection(cfg);
      if (!yt.ok) return { ok: false, error: yt.error };
      const provider = youtrackTracker(yt.url, yt.token);
      return { ok: true, read: (projectShortName) => provider.getPriorityValues(projectShortName) };
    },
  });
  ipcMain.handle(IPC.youtrackPriorityOrders, (_e, args) => youtrackPriorityOrders(args));

  // The workspace's tracker's link types (VERM-96), for its prerequisite link
  // type picker: read-only, on the workspace's own connection — the Jira
  // provider, or its own YouTrack server and credential — never another's.
  // Per-workspace storage only: the setting lives in the workspace's article.
  ipcMain.handle(IPC.workspaceLinkTypes, async (_e, workspaceId: unknown): Promise<TrackerLinkTypesResult> => {
    try {
      if (typeof workspaceId !== 'string' || workspaceId === '') return { ok: false, message: 'No workspace ID was given.' };
      const doc = await perWorkspaceDocument(workspaceId);
      if (!doc) return { ok: false, message: `No workspace ${workspaceId} is configured.` };
      if (doc.backend.kind === 'jira') {
        const r = await workspaceJiraProvider(workspaceId);
        if (!r.ok) return { ok: false, message: r.message };
        return { ok: true, types: await r.provider.getLinkTypes() };
      }
      const yt = await resolveWorkspaceYouTrackConnection(doc, await readConfig(), credentialSourceIO, IS_E2E);
      if (!yt.ok) return { ok: false, message: yt.error };
      return { ok: true, types: await youtrackTracker(yt.url, yt.token).getLinkTypes() };
    } catch (e) {
      return { ok: false, message: (e as Error).message || 'The link types could not be read.' };
    }
  });

  // Adding a ticket by key or link (VERM-86): the link must be on the
  // workspace's own tracker host, the exact key is read once on the same
  // connection as the refresh (runwayReader), and the add goes through the
  // Runway write handlers above. Search and detail admission are unchanged.
  // The rules live in services/runwayAddByReference.ts (unit-tested).
  // A workspace's own tracker address: its YouTrack server URL or Jira site
  // URL, '' when it has none for that tracker. Shared by the add by reference
  // and the import match, so both check links against the same host.
  async function runwayTrackerBaseUrl(workspaceId: string, tracker: TrackerKind): Promise<string> {
    if (tracker === 'jira' || workspaceStorageMode() === 'per-workspace') {
      const backend = (await perWorkspaceDocument(workspaceId))?.backend;
      if (backend?.kind === 'jira') return tracker === 'jira' ? backend.siteUrl : '';
      if (backend?.kind === 'youtrack') return tracker === 'youtrack' ? backend.serverUrl : '';
      return '';
    }
    return (await readConfig()).youtrackUrl ?? '';
  }
  const addRunwayByReference = createRunwayAddByReference({
    workspaces: runwayWorkspaces,
    trackerBaseUrl: runwayTrackerBaseUrl,
    items: (workspaceId) => openRunwayItemStore().list(workspaceId),
    reader: runwayReader,
    generation: activeWorkspaceGeneration,
    addIssueOnce: (args) => runwayItems.addIssueOnce(args),
  });
  ipcMain.handle(IPC.runwayItemsAddByReference, (_e, args) => addRunwayByReference(args));

  // Matching an imported schedule's tickets (VERM-101): read-only, each group
  // through the existing workspace chosen for it, on that workspace's own
  // connection (runwayReader) and no other. Nothing is written. The rules
  // live in services/runwayImportMatch.ts (unit-tested).
  const matchRunwayImport = createRunwayImportMatch({
    workspaces: runwayWorkspaces,
    trackerBaseUrl: runwayTrackerBaseUrl,
    reader: runwayReader,
  });
  ipcMain.handle(IPC.runwayImportMatch, (_e, args) => matchRunwayImport(args));

  // Choosing a Markdown schedule for the import preview (VERM-102): the
  // native picker, then the file's name and text, read-only, at most 1 MiB
  // (services/runwayMarkdownFile.ts). Separate from the snapshot import's
  // runwayImportPreview.
  ipcMain.handle(IPC.runwayMarkdownOpen, async (e): Promise<RunwayMarkdownOpenResult> => {
    const options: Electron.OpenDialogOptions = {
      title: 'Import a schedule from Markdown',
      defaultPath: app.getPath('documents'),
      buttonLabel: 'Preview import',
      filters: [{ name: 'Markdown schedule', extensions: [...RUNWAY_MARKDOWN_EXTENSIONS] }],
      properties: ['openFile'],
    };
    const parent = BrowserWindow.fromWebContents(e.sender);
    const choice = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    if (choice.canceled || choice.filePaths.length === 0) return { ok: true, canceled: true };
    return readRunwayMarkdownFile(choice.filePaths[0]);
  });

  ipcMain.handle(IPC.runwayExportSnapshot, async (e): Promise<RunwayExportSnapshotResult> => {
    try {
      const { db } = openJiraRunwayStore();
      const options: Electron.SaveDialogOptions = {
        title: 'Export Runway metadata snapshot',
        defaultPath: path.join(app.getPath('documents'), defaultSnapshotFileName()),
        buttonLabel: 'Export',
        filters: [{ name: 'Vermilian Runway snapshot', extensions: ['sqlite'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      };
      const parent = BrowserWindow.fromWebContents(e.sender);
      const choice = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
      if (choice.canceled || !choice.filePath) return { ok: true, canceled: true };
      const summary = await exportRunwaySnapshot(db, choice.filePath);
      return {
        ok: true,
        canceled: false,
        snapshot: {
          path: summary.path,
          exportedAt: summary.exportedAt,
          exportedBy: summary.exportedBy,
          schemaVersion: summary.schemaVersion,
          rowCounts: summary.rowCounts,
        },
      };
    } catch (err) {
      return runwayFailure(err);
    }
  });

  ipcMain.handle(IPC.runwayImportPreview, async (e): Promise<RunwayImportPreviewResult> => {
    try {
      const { db } = openJiraRunwayStore();
      const options: Electron.OpenDialogOptions = {
        title: 'Import Runway metadata snapshot',
        defaultPath: app.getPath('documents'),
        buttonLabel: 'Preview import',
        filters: [{ name: 'Vermilian Runway snapshot', extensions: ['sqlite'] }],
        properties: ['openFile'],
      };
      const parent = BrowserWindow.fromWebContents(e.sender);
      const staged = await importSession().preview(async () => {
        const choice = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
        return choice.canceled || choice.filePaths.length === 0 ? null : choice.filePaths[0];
      });
      if (!staged) return { ok: true, canceled: true };
      return {
        ok: true,
        canceled: false,
        preview: {
          token: staged.token,
          fileName: path.basename(staged.sourcePath),
          path: staged.sourcePath,
          fileModifiedAt: staged.fileModifiedAt,
          sizeBytes: staged.sizeBytes,
          schemaVersion: staged.originalSchemaVersion,
          exportedBy: staged.exportedBy,
          exportedAt: staged.exportedAt,
          warnings: await previewWarnings(db, staged),
          snapshotRowCounts: staged.rowCounts,
          liveRowCounts: runwayRowCounts(db),
          backupDir: path.join(app.getPath('userData'), RUNWAY_BACKUP_DIRNAME),
        },
      };
    } catch (err) {
      return runwayFailure(err);
    }
  });

  ipcMain.handle(
    IPC.runwayImportConfirm,
    async (_e, args: RunwayImportConfirmArgs): Promise<RunwayImportConfirmResult> => {
      try {
        const { db } = openJiraRunwayStore();
        const holdMs = e2eImportHoldMs();
        const result = await importSession().confirm(String(args?.token ?? ''), (staged) =>
          runwayGate.run(() =>
            importRunwaySnapshot(db, staged, {
              backupDir: path.join(app.getPath('userData'), RUNWAY_BACKUP_DIRNAME),
              hooks: holdMs ? { afterBackup: () => new Promise((r) => setTimeout(r, holdMs)) } : {},
            }),
          ),
        );
        return {
          ok: true,
          result: {
            backupPath: result.backupPath,
            rowCounts: result.rowCounts,
            previousRowCounts: result.previousRowCounts,
            prunedBackups: result.prunedBackups.length,
            pruneWarning: result.pruneWarning,
          },
        };
      } catch (err) {
        const backupPath = err instanceof RunwayImportError ? err.backupPath : undefined;
        return { ...runwayFailure(err), ...(backupPath ? { backupPath } : {}) };
      }
    },
  );

  ipcMain.handle(IPC.runwayImportCancel, (_e, args: RunwayImportConfirmArgs): { ok: true } => {
    importSession().cancel(String(args?.token ?? ''));
    return { ok: true };
  });

  app.on('will-quit', closeRunwayDb);

  ipcMain.handle(IPC.saveDismissal, async (_e, entry: NotThisWeekDismissal): Promise<void> => {
    if (workspaceStorageMode() === 'per-workspace') {
      const r = await editActiveWorkspace((doc) =>
        entry.workspace === doc.workspaceId
          ? { ...doc, dismissals: { ...doc.dismissals, [dismissalKey(entry.workspace, entry.issueId)]: entry } }
          : 'That dismissal belongs to a workspace other than the active one; it was not saved.',
      );
      if (!r.ok) notifySyncStatus({ kind: 'storage-blocked', message: r.error });
      return;
    }
    if (!articleConfig.setDismissal(entry)) {
      notifySyncStatus({ kind: 'storage-blocked', message: articleConfig.ACTIVATION_IN_PROGRESS_MESSAGE });
      return;
    }
    const cfg = await readConfig();
    const token = await loadYtToken(cfg);
    if (cfg.youtrackUrl && token) articleConfig.scheduleSave(cfg.youtrackUrl, token);
  });

  ipcMain.handle(IPC.resetBoardConfig, async (_e, projectId: string): Promise<void> => {
    if (workspaceStorageMode() === 'per-workspace') {
      const r = await editActiveWorkspace((doc) => {
        const boards = { ...doc.boards };
        delete boards[projectId];
        return { ...doc, boards };
      });
      if (!r.ok) notifySyncStatus({ kind: 'storage-blocked', message: r.error });
      return;
    }
    if (!articleConfig.removeBoardConfig(projectId)) {
      notifySyncStatus({ kind: 'storage-blocked', message: articleConfig.ACTIVATION_IN_PROGRESS_MESSAGE });
      return;
    }
    const cfg = await readConfig();
    const token = await loadYtToken(cfg);
    if (cfg.youtrackUrl && token) articleConfig.scheduleSave(cfg.youtrackUrl, token);
  });

  // ─── Eager article load on startup ─────────────────────────────────────────
  // Loads the _vermilian-config article in the background so workspace and board
  // configs from other machines are available as quickly as possible.
  // After load, syncs workspace config to the local file and pushes a refresh
  // event to any open renderer windows.
  void (async () => {
    try {
      const cfg = await readConfig();
      const token = await loadYtToken(cfg);
      if (!cfg.youtrackUrl || !token) return;

      await articleConfig.load(cfg.youtrackUrl, token);

      // Keep local workspace-config.json in sync with the article.
      const wsFromArticle = articleConfig.getWorkspaceConfig();
      if (wsFromArticle) {
        await writeWorkspaceConfig(wsFromArticle);
      }

      // Notify all open renderer windows to refetch workspace + board configs.
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('config:article-synced');
        }
      }
    } catch {
      // Best-effort — article may be unavailable (offline, no KB access, first run).
    }
  })();
}
