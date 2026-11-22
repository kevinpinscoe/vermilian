import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from './workspace';

describe('workspace store: Runway view (VERM-85)', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ runwayActive: false, priorityDeskActive: false, activeProjectId: null, activeProjectShortName: null, selectedIssueId: null });
  });

  it('openRunway replaces the board and the Desk, and closes the detail panel', () => {
    useWorkspaceStore.setState({ priorityDeskActive: true, activeProjectId: '0-1', activeProjectShortName: 'READ', selectedIssueId: '2-12' });
    useWorkspaceStore.getState().openRunway();
    expect(useWorkspaceStore.getState()).toMatchObject({
      runwayActive: true,
      priorityDeskActive: false,
      activeProjectId: null,
      activeProjectShortName: null,
      selectedIssueId: null,
    });
  });

  it('a ticket opened from the Runway keeps the Runway showing', () => {
    useWorkspaceStore.getState().openRunway();
    useWorkspaceStore.getState().setSelectedIssue('2-12');
    expect(useWorkspaceStore.getState()).toMatchObject({ runwayActive: true, selectedIssueId: '2-12' });
  });

  it('the Desk, a project or All tasks leaves the Runway', () => {
    const s = useWorkspaceStore.getState();
    s.openRunway();
    s.openPriorityDesk();
    expect(useWorkspaceStore.getState().runwayActive).toBe(false);
    s.openRunway();
    s.setActiveProject('0-1', 'READ');
    expect(useWorkspaceStore.getState().runwayActive).toBe(false);
    s.openRunway();
    s.setActiveProject(null, null);
    expect(useWorkspaceStore.getState().runwayActive).toBe(false);
  });
});
