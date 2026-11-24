// The Priority Desk's slots for a workspace's rows (VERM-99). Reads the
// Desk's own caches — YouTrack's Focus rank holders over the active
// workspace's projects, Jira's local Desk entries — and never writes.

import type { TrackerKind } from '../../../shared/tracker';
import { useWorkspaceFocusRankHolders } from '../project-board/focus';
import { useJiraRunway } from '../jira-board/jiraRunway';
import { useWorkspaceStore } from '../../stores/workspace';
import { jiraDeskSlots, youtrackDeskSlots, type DeskSlots } from './deskSlot';

const NONE: DeskSlots = new Map();

/**
 * The Desk slots of `workspaceId`. YouTrack's Desk is the active
 * workspace's, so another workspace gets none rather than the wrong Desk.
 */
export function useDeskSlots(workspaceId: string, tracker: TrackerKind): DeskSlots {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const { byRank: ytByRank } = useWorkspaceFocusRankHolders();
  const jira = useJiraRunway(workspaceId, tracker === 'jira' && workspaceId !== '');
  if (tracker === 'jira') return jiraDeskSlots(jira.index.byRank);
  return workspaceId === activeWorkspaceId ? youtrackDeskSlots(ytByRank) : NONE;
}
