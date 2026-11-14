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

import type { StandupGenerateResult } from '../../shared/ipc';
import type { WorkspaceStorageMode } from '../../shared/activeWorkspace';
import { standupAvailability, standupProjectShortNames, type StandupWorkspace } from '../../shared/standup';
import type { StandupIssues } from '../api/youtrack';
import type { WorkspaceAiOperation } from './workspaceAiKey';
import type { WorkspaceYouTrackConnection } from './workspaceYouTrack';

export interface WorkspaceStandupTracker {
  getProjects(): Promise<ReadonlyArray<{ id: string; shortName: string }>>;
  getIssuesForStandup(projectShortNames: string[], cutoffMs: number): Promise<StandupIssues>;
}

export interface WorkspaceStandupDeps {
  storage: WorkspaceStorageMode;
  beginAi(): Promise<WorkspaceAiOperation>;
  loadWorkspace(workspaceId: string): Promise<StandupWorkspace | null>;
  /** Per-workspace storage: the workspace's own connection. */
  connectWorkspace(workspaceId: string): Promise<WorkspaceYouTrackConnection>;
  /** Legacy storage: the Settings connection. */
  legacyConnection(): Promise<WorkspaceYouTrackConnection>;
  tracker(url: string, token: string): WorkspaceStandupTracker;
  generate(key: string, issues: StandupIssues): Promise<string>;
  cutoffMs: number;
}

export async function generateWorkspaceStandup(d: WorkspaceStandupDeps): Promise<StandupGenerateResult> {
  const ai = await d.beginAi();
  if (!ai.ok) return { ok: false, error: ai.error };

  const workspace = await d.loadWorkspace(ai.workspaceId);
  if (!workspace) return { ok: false, error: 'There is no active workspace to report on.' };
  const avail = standupAvailability(workspace.backend);
  if (!avail.available) return { ok: false, error: avail.reason };

  const conn = d.storage === 'legacy' ? await d.legacyConnection() : await d.connectWorkspace(ai.workspaceId);
  if (!conn.ok) return { ok: false, error: conn.error };
  const tracker = d.tracker(conn.url, conn.token);

  const projects = standupProjectShortNames(workspace, await tracker.getProjects());
  if (!projects.ok) return { ok: false, error: projects.error };
  if (projects.shortNames.length === 0) return { ok: true, markdown: '', taskCount: 0 };

  const issues = await tracker.getIssuesForStandup(projects.shortNames, d.cutoffMs);
  const taskCount = issues.done.length + issues.inProgress.length + issues.blocked.length;
  if (taskCount === 0) return { ok: true, markdown: '', taskCount: 0 };

  const sent = await ai.send((key) => d.generate(key, issues));
  if (!sent.ok) return { ok: false, error: sent.error };
  return { ok: true, markdown: sent.value, taskCount };
}
