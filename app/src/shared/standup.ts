// Stand-ups cover the active workspace only (VERM-48, proposal decision C3,
// R5.4 G2). The cross-workspace scopes ("All workspaces", "Custom") are
// withdrawn: a stand-up reports the projects of the one workspace it was
// generated from, with that workspace's Anthropic credential (VERM-47), and
// never another workspace's data.
//
// A Jira workspace has no stand-up in Phase 1: the report is built from
// YouTrack activity, and a Jira workspace's projects are not YouTrack
// projects. It is refused with a message — never answered with an empty
// report or with YouTrack data.
//
// Pure TypeScript: no Electron, no React.

import type { ActiveBackendContext } from './activeWorkspace';
import type { WorkspaceFolder } from './workspace';
import type { YouTrackProjectSettingsMap } from './youtrackStandup';

export const JIRA_STANDUP_UNSUPPORTED_MESSAGE =
  'Stand-ups are not available for Jira workspaces yet: Phase 1 supports them for YouTrack workspaces only.';

export type StandupAvailability = { available: true; reason: null } | { available: false; reason: string };

/**
 * Whether this workspace's backend can have a stand-up at all. A YouTrack
 * workspace reads through its own connection (its server and credential
 * reference under per-workspace storage), so its server does not matter.
 */
export function standupAvailability(backend: ActiveBackendContext | null): StandupAvailability {
  if (backend?.kind === 'jira') return { available: false, reason: JIRA_STANDUP_UNSUPPORTED_MESSAGE };
  return { available: true, reason: null };
}

export interface StandupWorkspace {
  id: string;
  backend: ActiveBackendContext | null;
  folders: readonly Pick<WorkspaceFolder, 'projectIds'>[];
  /** Per-workspace storage only: per-project Status overrides (VERM-114). */
  youtrackProjects?: YouTrackProjectSettingsMap;
}

export type StandupProjects = { ok: true; shortNames: string[] } | { ok: false; error: string };

/**
 * The YouTrack projects a stand-up covers: exactly the workspace's own,
 * matched against the projects the server lists. A workspace that does not
 * exist, or cannot have a stand-up, is refused rather than widened.
 */
export function standupProjectShortNames(
  workspace: StandupWorkspace | null,
  allProjects: ReadonlyArray<{ id: string; shortName: string }>,
): StandupProjects {
  if (!workspace) return { ok: false, error: 'There is no active workspace to report on.' };
  const avail = standupAvailability(workspace.backend);
  if (!avail.available) return { ok: false, error: avail.reason };
  const ids = new Set(workspace.folders.flatMap((f) => f.projectIds));
  return { ok: true, shortNames: allProjects.filter((p) => ids.has(p.id)).map((p) => p.shortName) };
}
