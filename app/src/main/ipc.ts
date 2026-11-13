import { ipcMain, dialog, shell, app, BrowserWindow } from 'electron';
import {
  IPC,
  type CredentialStatus,
  type SaveSecretResult,
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
  type MoveIssueArgs,
  type CreateIssueArgs,
  type CreateIssueResult,
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
  type DailyReviewGetResult,
} from '../shared/ipc';
import { maybeBuildAuditComment } from '../shared/recommendationAudit';
import * as fakeYouTrackForE2E from './api/fakeYouTrack';
import type { AppConfig } from '../shared/config';
import { pruneStaleProjectIds, type VermilianConfig } from '../shared/workspace';
import { readConfig, writeConfig } from './services/config';
import {
  saveSecret,
  loadSecretWithSources,
  hasSecretWithSources,
  getBackend,
  isSecure,
  FILES,
} from './services/credentials';
import { readWorkspaceConfig, writeWorkspaceConfig } from './services/workspaceConfig';
import { youtrack } from './api/client';
import { IS_E2E } from './e2e';
import { claude } from './api/claudeClient';
import * as standupService from './services/standup';
import * as checkpoint from './services/timerCheckpoint';
import * as articleConfig from './services/articleConfig';
import { getMasterPlanState } from './services/masterPlan';
import * as jiraProfile from './services/jiraProfile';
import * as workspaceArticles from './services/workspaceArticles';
import { youtrackWorkspaceArticleClient, youtrackWorkspaceMigrationClient } from './api/workspaceArticleClient';
import * as workspaceMigration from './services/workspaceMigration';
import type { WorkspaceMigrationOptions, WorkspaceMigrationResult } from '../shared/workspaceMigration';
import type {
  ListWorkspaceArticlesResult,
  ReadWorkspaceArticleResult,
  SaveWorkspaceArticleResult,
  WorkspaceDiscoveryFailure,
} from '../shared/workspaceArticle';
import type { WorkspaceDocument } from '../shared/workspaceSchema';
import { jira } from './api/jiraClient';
import { normaliseJiraProfile, type JiraProfile } from '../shared/jiraProfile';
import { toJiraIssueRow } from '../shared/jiraIssue';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openRunwayDb, RUNWAY_DB_FILENAME } from './services/runwayDb';
import {
  createJiraRunwayStore,
  createYouTrackRunwayStore,
  storeForIssue,
  type RunwayMetadataStore,
  type RunwayStores,
} from './services/runwayStore';
import type { NamespacedIssueId } from '../shared/tracker';
import type { BoardConfig, Dismissals, NotThisWeekDismissal } from '../shared/boardConfig';

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

// Helpers — load credentials via the three-source chain (command → file → safeStorage).
async function loadYtToken(cfg?: AppConfig): Promise<string | null> {
  if (IS_E2E) return 'e2e-token';
  const c = cfg ?? (await readConfig());
  return loadSecretWithSources(FILES.youtrackToken, c.youtrackTokenCommand, c.youtrackTokenFile);
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
let jiraRunwayStore: RunwayMetadataStore | null = null;

const youtrackRunwayStore = createYouTrackRunwayStore({
  async readFields(issueId) {
    const cfg = await readConfig();
    const token = await loadYtToken(cfg);
    if (!cfg.youtrackUrl || !token) throw new Error('Not configured');
    return (await youtrack.getIssueDetail(cfg.youtrackUrl, token, issueId)).fields;
  },
  async patch(issueId, field, value) {
    const cfg = await readConfig();
    const token = await loadYtToken(cfg);
    if (!cfg.youtrackUrl || !token) throw new Error('Not configured');
    await youtrack.patchIssue(cfg.youtrackUrl, token, issueId, field, value);
  },
});

const runwayStores: RunwayStores = {
  youtrack: youtrackRunwayStore,
  get jira(): RunwayMetadataStore {
    if (!jiraRunwayStore) {
      runwayDb = openRunwayDb(path.join(app.getPath('userData'), RUNWAY_DB_FILENAME));
      jiraRunwayStore = createJiraRunwayStore(runwayDb);
    }
    return jiraRunwayStore;
  },
};

function closeRunwayDb(): void {
  runwayDb?.close();
  runwayDb = null;
  jiraRunwayStore = null;
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

// Project short names in the active workspace, resolved the same way
// standupGenerate's scope: 'active-workspace' branch does. Daily Review
// (VERM-9) only ever needs this one scope — unlike Stand-up it has no
// scope/window config step (PLAN.md "Scope and window — fixed, not
// configurable") — so this is its own small helper rather than exposing
// standupGenerate's three-way scope switch for one branch of it.
async function activeWorkspaceProjectShortNames(url: string, token: string): Promise<string[]> {
  const allProjects = await youtrack.getProjects(url, token);
  const wsConfig = await readWorkspaceConfig();
  const activeWs =
    wsConfig?.workspaces.find((w) => w.id === wsConfig.activeWorkspaceId) ?? wsConfig?.workspaces[0];
  const projectIds = new Set(activeWs?.folders.flatMap((f) => f.projectIds) ?? []);
  return allProjects.filter((p) => projectIds.has(p.id)).map((p) => p.shortName);
}

export function registerIpc(): void {
  // Broadcast config-sync lifecycle events to every open renderer window so it
  // can surface toasts / banners (write failures, conflicts, version mismatch).
  articleConfig.setStatusNotifier((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('config:sync-status', status);
    }
  });

  ipcMain.handle(IPC.getConfig, (): Promise<AppConfig> => readConfig());

  ipcMain.handle(IPC.saveConfig, async (_e, patch: Partial<AppConfig>) => {
    await writeConfig(patch);
    return { ok: true };
  });

  ipcMain.handle(
    IPC.credentialStatus,
    async (): Promise<CredentialStatus> => {
      if (IS_E2E) {
        return { hasYouTrackToken: true, hasClaudeKey: true, hasJiraToken: true, backend: 'e2e', secure: true };
      }
      const cfg = await readConfig();
      return {
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
        const cfg = await readConfig();
        token =
          (args.token?.trim() || '') ||
          (await loadSecretWithSources(
            FILES.youtrackToken,
            cfg.youtrackTokenCommand,
            cfg.youtrackTokenFile,
          ));
        if (!token) return { ok: false, message: 'No API token found (check command, file, or paste a token).' };
        const displayName = await youtrack.getCurrentUser(args.url, token);
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
      return youtrack.getWorklogTypes(url, token);
    },
  );

  ipcMain.handle(
    IPC.testClaude,
    async (_e, args: TestClaudeArgs): Promise<TestClaudeResult> => {
      const key = (args.key?.trim() || '') || (await loadClaudeKey());
      if (!key) return { ok: false, error: 'No Claude API key found (check command, file, or paste a key).' };
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
      let token: string | null;
      try {
        token = (args.token?.trim() || '') || (await loadJiraToken());
      } catch {
        token = null;
      }
      if (!token) {
        return { ok: false, reason: 'no-token', cloudId: profile.cloudId, message: 'No Jira API token found (check command, file, or paste a token).' };
      }
      const r = await jira.probeJiraToken(profile, token);
      if (r.ok) return { ok: true, kind: r.kind, cloudId: r.cloudId, displayName: r.account.displayName };
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

  ipcMain.handle(
    IPC.aiCreateTask,
    async (_e, args: AiCreateTaskArgs): Promise<AiCreateTaskResult> => {
      const cfg = await readConfig();
      const key = await loadClaudeKey(cfg);
      if (!key) return { ok: false, error: 'No Claude API key configured.' };
      return claude.extractTaskFields(key, args.description, args.projects, cfg.modelForCreate);
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
    const token = await loadYtToken(cfg);
    if (!cfg.youtrackUrl || !token) return [];
    try {
      return await youtrack.getProjects(cfg.youtrackUrl, token);
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

  ipcMain.handle(IPC.getWorkspaceConfig, async () => {
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
  });

  ipcMain.handle(
    IPC.saveWorkspaceConfig,
    async (_e, config: VermilianConfig): Promise<{ ok: boolean }> => {
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
          const projects = await youtrack.getProjects(cfg.youtrackUrl, token);
          toSave = pruneStaleProjectIds(config, new Set(projects.map((p) => p.id)));
        } catch {
          /* offline or request failed — save as-is */
        }
      }

      // Write local file immediately (fast, offline-safe).
      await writeWorkspaceConfig(toSave);
      // Update Article cache and schedule debounced remote write.
      articleConfig.updateWorkspaceConfig(toSave);
      if (cfg.youtrackUrl && token) articleConfig.scheduleSave(cfg.youtrackUrl, token);
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.forceResyncWorkspaceConfig,
    async (): Promise<{ ok: boolean; error?: string }> => {
      const cfg = await readConfig();
      const token = await loadYtToken(cfg);
      if (!cfg.youtrackUrl || !token) {
        return { ok: false, error: 'YouTrack is not configured.' };
      }
      try {
        let wsConfig = await articleConfig.forceReload(cfg.youtrackUrl, token);
        if (wsConfig) {
          try {
            const projects = await youtrack.getProjects(cfg.youtrackUrl, token);
            const pruned = pruneStaleProjectIds(wsConfig, new Set(projects.map((p) => p.id)));
            if (JSON.stringify(pruned) !== JSON.stringify(wsConfig)) {
              articleConfig.updateWorkspaceConfig(pruned);
              articleConfig.scheduleSave(cfg.youtrackUrl, token);
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
    const token = await loadYtToken(cfg);
    if (!cfg.youtrackUrl || !token) return [];
    return youtrack.getIssues(cfg.youtrackUrl, token, args.projectShortName, args.includeResolved);
  });

  ipcMain.handle(IPC.searchIssues, async (_e, args: SearchIssuesArgs) => {
    const cfg = await readConfig();
    const token = await loadYtToken(cfg);
    if (!cfg.youtrackUrl || !token) return [];
    return youtrack.searchIssues(cfg.youtrackUrl, token, args.projectShortNames, args.query);
  });

  // Re-fetches and re-parses _vermilian-master-plan on every call — see
  // services/masterPlan.ts for why there is no persistent cache here.
  ipcMain.handle(IPC.getMasterPlan, async () => {
    const cfg = await readConfig();
    const token = await loadYtToken(cfg);
    return getMasterPlanState(cfg.youtrackUrl ?? '', token ?? '');
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
    const token = await loadYtToken(cfg);
    if (!cfg.youtrackUrl || !token) throw new Error('Not configured');
    return youtrack.getIssueDetail(cfg.youtrackUrl, token, issueId);
  });

  ipcMain.handle(
    IPC.patchIssue,
    async (_e, args: PatchIssueArgs): Promise<{ ok: boolean; error?: string }> => {
      try {
        const cfg = await readConfig();
        const token = await loadYtToken(cfg);
        if (!cfg.youtrackUrl || !token) return { ok: false, error: 'Not configured' };
        await youtrack.patchIssue(cfg.youtrackUrl, token, args.issueId, args.field, args.value);
        return { ok: true };
      } catch (e) {
        const err = e as { message?: string };
        return { ok: false, error: err.message ?? 'Save failed' };
      }
    },
  );

  ipcMain.handle(
    IPC.createIssue,
    async (_e, args: CreateIssueArgs): Promise<CreateIssueResult> => {
      try {
        const cfg = await readConfig();
        const token = await loadYtToken(cfg);
        if (!cfg.youtrackUrl || !token) return { ok: false, error: 'Not configured' };
        const result = await youtrack.createIssue(cfg.youtrackUrl, token, args);
        return { ok: true, id: result.id, idReadable: result.idReadable };
      } catch (e) {
        const err = e as { message?: string };
        return { ok: false, error: err.message ?? 'Create failed' };
      }
    },
  );

  ipcMain.handle(
    IPC.deleteIssue,
    async (_e, issueId: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const cfg = await readConfig();
        const token = await loadYtToken(cfg);
        if (!cfg.youtrackUrl || !token) return { ok: false, error: 'Not configured' };
        await youtrack.deleteIssue(cfg.youtrackUrl, token, issueId);
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
        const token = await loadYtToken(cfg);
        if (!cfg.youtrackUrl || !token) return { ok: false, error: 'Not configured' };
        await youtrack.moveIssue(cfg.youtrackUrl, token, args.issueId, args.targetProjectId);
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
        const token = await loadYtToken(cfg);
        const claudeKey = await loadClaudeKey(cfg);
        if (!cfg.youtrackUrl || !token) return { ok: false, error: 'YouTrack not configured.' };
        if (!claudeKey) return { ok: false, error: 'No Claude API key configured.' };

        const issues = await youtrack.getIssuesForRecommendation(cfg.youtrackUrl, token, args.issueIds);
        const result = await claude.getRecommendation(
          claudeKey,
          issues,
          args.candidateContext,
          args.outcome,
          cfg.modelForRecommendation,
        );
        return { ok: true, result };
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
        const token = await loadYtToken(cfg);
        if (!cfg.youtrackUrl || !token) return { ok: false, error: 'Not configured' };
        const topIssueId = args.result.ranked[0].issueId;
        await youtrack.postComment(cfg.youtrackUrl, token, topIssueId, comment);
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
  ipcMain.handle(IPC.dailyReviewGet, async (): Promise<DailyReviewGetResult> => {
    try {
      const cfg = await readConfig();
      const token = await loadYtToken(cfg);
      if (!cfg.youtrackUrl || !token) return { ok: false, error: 'YouTrack not configured.' };

      const projectShortNames = await activeWorkspaceProjectShortNames(cfg.youtrackUrl, token);
      const cutoffMs = Date.now() - DAILY_REVIEW_COMPLETED_WINDOW_HOURS * 60 * 60 * 1000;
      const { done } = await youtrack.getIssuesForStandup(cfg.youtrackUrl, token, projectShortNames, cutoffMs);

      return {
        ok: true,
        completed: done.map((t) => ({ idReadable: t.idReadable, summary: t.summary, priority: t.priority })),
      };
    } catch (e) {
      const err = e as { message?: string };
      return { ok: false, error: err.message ?? 'Daily Review failed to load.' };
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
      const client = await workspaceArticleClient();
      return client ? workspaceArticles.createWorkspaceArticle(client, doc) : NOT_CONFIGURED_WS;
    },
  );

  ipcMain.handle(
    IPC.updateWorkspaceArticle,
    async (_e, base: WorkspaceDocument, edited: WorkspaceDocument): Promise<SaveWorkspaceArticleResult> => {
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
      return workspaceArticles.updateWorkspaceArticle(client, base, edited);
    },
  );

  // ─── Migration to per-workspace articles (VERM-44) ──────────────────────────
  // Only these two handlers run it — never startup. The backend server of every
  // migrated workspace is the configuration YouTrack in main settings.

  function migrationOptions(raw: unknown): WorkspaceMigrationOptions {
    const name = typeof raw === 'object' && raw !== null ? (raw as WorkspaceMigrationOptions).jiraWorkspaceName : undefined;
    return typeof name === 'string' ? { jiraWorkspaceName: name } : {};
  }

  async function runMigration(
    run: typeof workspaceMigration.planWorkspaceMigration,
    rawOptions: unknown,
  ): Promise<WorkspaceMigrationResult> {
    const cfg = await readConfig();
    const token = await loadYtToken(cfg);
    if (!cfg.youtrackUrl || !token) return NOT_CONFIGURED_WS;
    return run(youtrackWorkspaceMigrationClient(cfg.youtrackUrl, token), cfg.youtrackUrl, migrationOptions(rawOptions));
  }

  ipcMain.handle(IPC.planWorkspaceMigration, (_e, options: unknown) =>
    runMigration(workspaceMigration.planWorkspaceMigration, options),
  );
  ipcMain.handle(IPC.applyWorkspaceMigration, (_e, options: unknown) =>
    runMigration(workspaceMigration.applyWorkspaceMigration, options),
  );

  ipcMain.handle(
    IPC.standupGenerate,
    async (_e, args: StandupGenerateArgs): Promise<StandupGenerateResult> => {
      try {
        const cfg = await readConfig();
        const token = await loadYtToken(cfg);
        const claudeKey = await loadClaudeKey(cfg);
        if (!cfg.youtrackUrl || !token) return { ok: false, error: 'YouTrack not configured.' };
        if (!claudeKey) return { ok: false, error: 'No Claude API key configured.' };

        const allProjects = await youtrack.getProjects(cfg.youtrackUrl, token);
        const wsConfig = await readWorkspaceConfig();

        let projectShortNames: string[];
        if (args.scope === 'active-workspace' && wsConfig) {
          const activeWs =
            wsConfig.workspaces.find((w) => w.id === wsConfig.activeWorkspaceId) ??
            wsConfig.workspaces[0];
          const projectIds = new Set(activeWs?.folders.flatMap((f) => f.projectIds) ?? []);
          projectShortNames = allProjects
            .filter((p) => projectIds.has(p.id))
            .map((p) => p.shortName);
        } else if (args.scope === 'custom' && args.customWorkspaceIds?.length && wsConfig) {
          const allowedIds = args.customWorkspaceIds;
          const projectIds = new Set(
            wsConfig.workspaces
              .filter((w) => allowedIds.includes(w.id))
              .flatMap((w) => w.folders.flatMap((f) => f.projectIds)),
          );
          projectShortNames = allProjects
            .filter((p) => projectIds.has(p.id))
            .map((p) => p.shortName);
        } else {
          // all-workspace → all projects
          projectShortNames = allProjects.map((p) => p.shortName);
        }

        const windowHours =
          args.window === '24h' ? 24
          : args.window === '48h' ? 48
          : args.window === '7d' ? 168
          : (args.customWindowHours ?? 48);
        const cutoffMs = Date.now() - windowHours * 60 * 60 * 1000;

        const issues = await youtrack.getIssuesForStandup(
          cfg.youtrackUrl,
          token,
          projectShortNames,
          cutoffMs,
        );

        const taskCount =
          issues.done.length + issues.inProgress.length + issues.blocked.length;

        if (taskCount === 0) return { ok: true, markdown: '', taskCount: 0 };

        const markdown = await claude.generateStandupReport(
          claudeKey,
          issues,
          cfg.modelForStandup,
        );
        return { ok: true, markdown, taskCount };
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
        const token = await loadYtToken(cfg);
        if (!cfg.youtrackUrl || !token) return { ok: false, error: 'YouTrack not configured.' };
        await youtrack.postWorklog(cfg.youtrackUrl, token, args.issueId, args.minutes, args.worklogType);
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
    // Ensure Article is loaded (no-op if already cached).
    const cfg = await readConfig();
    const token = await loadYtToken(cfg);
    if (cfg.youtrackUrl && token && !articleConfig.getCachedConfig()) {
      try { await articleConfig.load(cfg.youtrackUrl, token); } catch { /* ignore */ }
    }
    return articleConfig.getBoardConfig(projectId);
  });

  ipcMain.handle(IPC.saveBoardConfig, async (_e, config: BoardConfig): Promise<void> => {
    articleConfig.updateBoardConfig(config);
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
      const entry = await storeForIssue(runwayStores, issueId).update(
        args.workspaceId, issueId, args.patch,
      );
      return { ok: true, entry };
    } catch (e) {
      return runwayFailure(e);
    }
  });

  app.on('will-quit', closeRunwayDb);

  ipcMain.handle(IPC.saveDismissal, async (_e, entry: NotThisWeekDismissal): Promise<void> => {
    articleConfig.setDismissal(entry);
    const cfg = await readConfig();
    const token = await loadYtToken(cfg);
    if (cfg.youtrackUrl && token) articleConfig.scheduleSave(cfg.youtrackUrl, token);
  });

  ipcMain.handle(IPC.resetBoardConfig, async (_e, projectId: string): Promise<void> => {
    articleConfig.removeBoardConfig(projectId);
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
