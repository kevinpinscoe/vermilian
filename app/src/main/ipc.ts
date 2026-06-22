import { ipcMain, dialog, shell, app, BrowserWindow } from 'electron';
import {
  IPC,
  type CredentialStatus,
  type SaveSecretResult,
  type TestYouTrackArgs,
  type TestYouTrackResult,
  type TestClaudeArgs,
  type TestClaudeResult,
  type GetWorklogTypesArgs,
  type GetIssuesArgs,
  type PatchIssueArgs,
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
} from '../shared/ipc';
import type { AppConfig } from '../shared/config';
import type { VermilianConfig } from '../shared/workspace';
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
import * as claude from './api/claude';
import * as standupService from './services/standup';
import * as checkpoint from './services/timerCheckpoint';
import * as articleConfig from './services/articleConfig';
import type { BoardConfig } from '../shared/boardConfig';

// Quit-protection state (set by renderer when timer is running).
let quitProtected = false;

export function isQuitProtected(): boolean {
  return quitProtected;
}

export function forceQuit(): void {
  quitProtected = false; // allow the quit to proceed without interception
  app.quit();
}

export function sendQuitRequested(): void {
  BrowserWindow.getAllWindows()[0]?.webContents.send('timer:quit-requested');
}

// Helpers — load credentials via the three-source chain (command → file → safeStorage).
async function loadYtToken(cfg?: AppConfig): Promise<string | null> {
  if (IS_E2E) return 'e2e-token';
  const c = cfg ?? (await readConfig());
  return loadSecretWithSources(FILES.youtrackToken, c.youtrackTokenCommand, c.youtrackTokenFile);
}
async function loadClaudeKey(cfg?: AppConfig): Promise<string | null> {
  if (IS_E2E) return 'e2e-claude-key';
  const c = cfg ?? (await readConfig());
  return loadSecretWithSources(FILES.claudeKey, c.claudeKeyCommand, c.claudeKeyFile);
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
        return { hasYouTrackToken: true, hasClaudeKey: true, backend: 'e2e', secure: true };
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
    return youtrack.getProjects(cfg.youtrackUrl, token);
  });

  ipcMain.handle(IPC.getWorkspaceConfig, async () => {
    // Try Article first; fall back to local file.
    const cached = articleConfig.getWorkspaceConfig();
    if (cached) return cached;
    const local = await readWorkspaceConfig();
    if (local) return local;
    // Trigger a background Article load for next call.
    const cfg = await readConfig();
    const token = await loadYtToken(cfg);
    if (cfg.youtrackUrl && token) {
      void articleConfig.load(cfg.youtrackUrl, token).catch((_e: unknown) => { /* best effort */ });
    }
    return null;
  });

  ipcMain.handle(
    IPC.saveWorkspaceConfig,
    async (_e, config: VermilianConfig): Promise<{ ok: boolean }> => {
      // Write local file immediately (fast, offline-safe).
      await writeWorkspaceConfig(config);
      // Update Article cache and schedule debounced remote write.
      articleConfig.updateWorkspaceConfig(config);
      const cfg = await readConfig();
      const token = await loadYtToken(cfg);
      if (cfg.youtrackUrl && token) articleConfig.scheduleSave(cfg.youtrackUrl, token);
      return { ok: true };
    },
  );

  ipcMain.handle(IPC.getIssues, async (_e, args: GetIssuesArgs) => {
    const cfg = await readConfig();
    const token = await loadYtToken(cfg);
    if (!cfg.youtrackUrl || !token) return [];
    return youtrack.getIssues(cfg.youtrackUrl, token, args.projectShortName, args.includeResolved);
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
