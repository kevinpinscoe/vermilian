// One stand-up, for the active workspace only (VERM-48). Dependencies are
// passed in so the isolation is unit-testable without Electron.
//
// One workspace identity drives everything: beginAi() resolves the Anthropic
// key for the active workspace and names it (VERM-47), and that same
// workspace supplies the projects and the YouTrack connection —
//   legacy storage        the global Settings connection, as before VERM-53;
//   per-workspace storage the workspace's own server and credential
//                         reference (services/workspaceYouTrack.ts), with no
//                         fallback to the Settings token or another workspace.
// A Jira or missing workspace is refused before any connection is made. A
// switch while projects or issues load is caught by send() immediately
// before Anthropic is contacted.

import type { DailyReviewGetResult, StandupGenerateResult } from '../../shared/ipc';
import type { WorkspaceStorageMode } from '../../shared/activeWorkspace';
import { standupAvailability, standupProjectShortNames, type StandupWorkspace } from '../../shared/standup';
import { buildStandupPlan, type StandupPlanWarning } from '../../shared/youtrackStandup';
import type { YouTrackProjectMetadata } from '../../shared/youtrackProjectFields';
import type { StandupIssues } from '../api/youtrack';
import type { YouTrackProvider } from '../providers/youtrackProvider';
import type { WorkspaceAiOperation } from './workspaceAiKey';
import type { WorkspaceYouTrackConnection } from './workspaceYouTrack';

export interface WorkspaceStandupTracker {
  getProjects(): Promise<ReadonlyArray<{ id: string; shortName: string }>>;
  getProjectFieldMetadata: YouTrackProvider['getProjectFieldMetadata'];
  getIssuesForStandup: YouTrackProvider['getIssuesForStandup'];
}

/**
 * Where a workspace report's data comes from — shared by the stand-up and
 * the Priority Desk Daily Review (VERM-114), so both read through the same
 * connection rule:
 *   legacy storage        the configured shared (Settings) connection;
 *   per-workspace storage the workspace's own connection, with no fallback.
 */
export interface WorkspaceReportSourceDeps {
  storage: WorkspaceStorageMode;
  loadWorkspace(workspaceId: string): Promise<StandupWorkspace | null>;
  /** Per-workspace storage: the workspace's own connection. */
  connectWorkspace(workspaceId: string): Promise<WorkspaceYouTrackConnection>;
  /** Legacy storage: the Settings connection. */
  legacyConnection(): Promise<WorkspaceYouTrackConnection>;
  tracker(url: string, token: string): WorkspaceStandupTracker;
}

export type WorkspaceReportIssues =
  | { ok: true; issues: StandupIssues; warnings: StandupPlanWarning[] }
  | { ok: false; error: string };

const NO_ISSUES: StandupIssues = { done: [], inProgress: [], blocked: [] };

/**
 * One workspace's report issues: its projects, each project's own Status
 * configuration (discovery), the plan built from that and the workspace's
 * overrides, and the issues read with it. Discovery and the issue read use
 * the one connection the storage mode selects. A project whose
 * configuration cannot be read is named in a warning and left out.
 */
export async function readWorkspaceReportIssues(
  d: WorkspaceReportSourceDeps,
  workspaceId: string,
  cutoffMs: number,
): Promise<WorkspaceReportIssues> {
  const workspace = await d.loadWorkspace(workspaceId);
  if (!workspace) return { ok: false, error: 'There is no active workspace to report on.' };
  const avail = standupAvailability(workspace.backend);
  if (!avail.available) return { ok: false, error: avail.reason };

  const conn = d.storage === 'legacy' ? await d.legacyConnection() : await d.connectWorkspace(workspaceId);
  if (!conn.ok) return { ok: false, error: conn.error };
  const tracker = d.tracker(conn.url, conn.token);

  const projects = standupProjectShortNames(workspace, await tracker.getProjects());
  if (!projects.ok) return { ok: false, error: projects.error };
  if (projects.shortNames.length === 0) return { ok: true, issues: NO_ISSUES, warnings: [] };

  const metadata = await Promise.all(
    projects.shortNames.map((shortName) =>
      tracker.getProjectFieldMetadata(shortName).then(
        (m): YouTrackProjectMetadata | null => m,
        () => null,
      ),
    ),
  );
  // Overrides live in the workspace document; legacy storage has none and
  // uses the derived defaults only.
  const plan = buildStandupPlan(
    projects.shortNames.map((shortName, i) => ({ shortName, metadata: metadata[i] })),
    d.storage === 'legacy' ? undefined : workspace.youtrackProjects,
  );
  if (plan.projects.length === 0) return { ok: true, issues: NO_ISSUES, warnings: plan.warnings };
  const issues = await tracker.getIssuesForStandup(plan, cutoffMs);
  return { ok: true, issues, warnings: plan.warnings };
}

export interface WorkspaceStandupDeps extends WorkspaceReportSourceDeps {
  beginAi(): Promise<WorkspaceAiOperation>;
  generate(key: string, issues: StandupIssues): Promise<string>;
  cutoffMs: number;
}

export async function generateWorkspaceStandup(d: WorkspaceStandupDeps): Promise<StandupGenerateResult> {
  const ai = await d.beginAi();
  if (!ai.ok) return { ok: false, error: ai.error };

  const read = await readWorkspaceReportIssues(d, ai.workspaceId, d.cutoffMs);
  if (!read.ok) return { ok: false, error: read.error };
  const { issues } = read;
  const warnings = read.warnings.map((w) => w.message);
  const taskCount = issues.done.length + issues.inProgress.length + issues.blocked.length;
  if (taskCount === 0) return { ok: true, markdown: '', taskCount: 0, warnings };

  const sent = await ai.send((key) => d.generate(key, issues));
  if (!sent.ok) return { ok: false, error: sent.error };
  return { ok: true, markdown: sent.value, taskCount, warnings };
}

export interface WorkspaceDailyReviewDeps extends WorkspaceReportSourceDeps {
  /** The active workspace's ID, or '' when there is none. */
  activeWorkspaceId(): Promise<string>;
  cutoffMs: number;
}

export const DAILY_REVIEW_NOT_ACTIVE_MESSAGE =
  'That workspace is no longer active, so its Daily Review was not loaded.';

/**
 * The Daily Review's "recently completed" list (VERM-9) for one workspace,
 * read exactly as a stand-up reads it (VERM-114): same connection rule, same
 * discovery, same done mapping. Deterministic — no Claude call.
 *
 * The review is bound to the workspace the renderer asked for (VERM-114
 * review), and every answer names it; the renderer caches by it and refuses
 * an answer naming any other. A read may only start for the active
 * workspace: anything else is refused here, before the workspace is loaded or
 * its credential resolved, so another workspace's connection is never used.
 * The check is made once, at the start, so a read that began while its
 * workspace was active still finishes — its answer lands in that
 * workspace's own cache entry.
 */
export async function getWorkspaceDailyReview(d: WorkspaceDailyReviewDeps, workspaceId: string): Promise<DailyReviewGetResult> {
  const active = await d.activeWorkspaceId();
  if (!workspaceId || !active) return { ok: false, ...(workspaceId ? { workspaceId } : {}), error: 'There is no active workspace to review.' };
  if (workspaceId !== active) return { ok: false, workspaceId, refused: 'not-active', error: DAILY_REVIEW_NOT_ACTIVE_MESSAGE };
  const read = await readWorkspaceReportIssues(d, workspaceId, d.cutoffMs);
  if (!read.ok) return { ok: false, workspaceId, error: read.error };
  return {
    ok: true,
    workspaceId,
    completed: read.issues.done.map((t) => ({ idReadable: t.idReadable, summary: t.summary, priority: t.priority })),
    // Only what affects completed work: a project left out, or no done state.
    warnings: read.warnings.filter((w) => w.group === null || w.group === 'done').map((w) => w.message),
  };
}
