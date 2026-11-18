import React, { useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Heading, Loader, Text } from '@vibe/core';
import { formatDate } from '../project-board/KanbanView';
import { describeHiddenColumns, jiraBoardColumns, jiraStatusOptions, splitHiddenColumns, withAlwaysShownColumn } from './jiraBoard';
import { JiraColumnsMenu } from './JiraColumnsMenu';
import { JiraStatusPills } from './JiraStatusPills';
import { useJiraHiddenStatuses } from './useJiraHiddenStatuses';
import { JiraReconnect } from './JiraReconnect';
import { JIRA_POLL_INTERVAL_MS } from '../../../shared/jiraPoll';
import { pollJiraProject, workspaceJiraIssuesPrefix, workspaceJiraPollQueryKey } from './jiraBoardSync';
import { useJiraWorkspaceIssues } from './useJiraWorkspaceIssues';
import { JiraFocusControl } from './JiraFocusControl';
import { EMPTY_FILTER, applyFilter, type FilterState } from '../project-board/grouping';
import { AssigneePills, DefaultAssigneePill } from '../project-board/FilterPills';
import { DefaultAssigneeBar, useDefaultAssignee } from '../project-board/DefaultAssigneeBar';
import { defaultAssigneeFilter } from '../project-board/defaultAssignee';
import { BoardSearch } from '../search/BoardSearch';
import pbStyles from '../project-board/ProjectBoard.module.css';
import { boardSourceId, jiraSourceIds } from '../../../shared/jiraSource';
import type { WorkspaceJiraBoard } from '../../../shared/workspace';
import styles from './JiraWorkspaceBoard.module.css';

interface JiraWorkspaceBoardProps {
  workspaceId: string;
  workspaceName: string;
  projectKeys: string[];
  // Jira boards chosen alongside the projects (VERM-59).
  boards?: WorkspaceJiraBoard[];
  // Status columns the workspace hides (VERM-60), and the hook to reload the
  // workspace once the Columns menu saves a new choice.
  hiddenStatuses?: string[];
  onHiddenStatusesSaved?: () => void;
  // This workspace's Default assignee on this computer (VERM-68); '' for none.
  defaultAssignee?: string;
  onChooseProjects: () => void;
  selectedIssueKey?: string | null;
  // Opens the read-only detail panel (VERM-35).
  onSelectIssue: (issueKey: string) => void;
  onOpenSettings: () => void;
}

export { workspaceJiraIssuesQueryKey } from './jiraBoardSync';

/**
 * A Jira workspace's board, read-only (VERM-34). Issues come from Jira through
 * the workspace's own connection; cards cannot be dragged, edited or used to
 * start a timer, because nothing in Phase 1 writes to Jira. Clicking a card
 * opens its read-only detail panel (VERM-35). The star and rank on each card
 * are Vermilian's own Runway metadata, kept in the local store (VERM-38).
 */
export function JiraWorkspaceBoard({
  workspaceId,
  workspaceName,
  projectKeys,
  boards = [],
  hiddenStatuses = [],
  onHiddenStatusesSaved = () => undefined,
  defaultAssignee = '',
  onChooseProjects,
  selectedIssueKey = null,
  onSelectIssue,
  onOpenSettings,
}: JiraWorkspaceBoardProps) {
  const [showDone, setShowDone] = useState(false);
  // Board search text and Assignee pills (VERM-61/62), the same FilterState
  // and applyFilter the YouTrack boards use. Not persisted.
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);

  const queryClient = useQueryClient();
  // Every source of the board's issues: the projects, then the boards.
  const sources = useMemo(() => jiraSourceIds(projectKeys, boards.map((b) => b.id)), [projectKeys, boards]);
  const sourceNames = useMemo(() => Object.fromEntries(boards.map((b) => [boardSourceId(b.id), `Board "${b.name}"`])), [boards]);
  const { results, issues, priorities, loading, failures, notices, reconnect } = useJiraWorkspaceIssues(workspaceId, sources, showDone, sourceNames);

  // The incremental poll, every JIRA_POLL_INTERVAL_MS while the window is
  // visible, once a project's list has loaded. It merges what changed into
  // the lists above and stores nothing of its own.
  useQueries({
    queries: sources.map((source, i) => ({
      queryKey: workspaceJiraPollQueryKey(workspaceId, source, showDone),
      queryFn: ({ signal }: { signal: AbortSignal }) => pollJiraProject(queryClient, workspaceId, source, showDone, signal),
      enabled: results[i]?.data?.ok === true,
      staleTime: JIRA_POLL_INTERVAL_MS,
      refetchInterval: JIRA_POLL_INTERVAL_MS,
      refetchIntervalInBackground: false,
      // Catch up as soon as a hidden window is shown again — a full read if
      // it was hidden past the lookback — instead of at the next tick. Only
      // this query: the app's default stays off.
      refetchOnWindowFocus: true,
      retry: false,
    })),
  });

  const retry = () => {
    void queryClient.invalidateQueries({ queryKey: workspaceJiraIssuesPrefix(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: ['workspace', 'jira-issue-detail', workspaceId] });
  };

  const summaryOf = (key: string) => issues.find((i) => i.idReadable === key)?.summary;

  // "Me" is this workspace's own Jira account, read through its own
  // connection; until it is known the Me pill is simply not offered.
  const myAccount = useQuery({
    queryKey: ['workspace', 'jira-my-account', workspaceId],
    queryFn: () => window.vermilian.getWorkspaceJiraMyAccountId(workspaceId),
    staleTime: Infinity,
    retry: false,
    enabled: sources.length > 0,
  });
  const myAccountId = myAccount.data?.ok ? myAccount.data.accountId : '';

  // Columns come from every loaded issue, so they keep their order and place
  // while a filter empties some of them; each shows "N of M" while filtering.
  const columns = useMemo(() => jiraBoardColumns(issues, priorities), [issues, priorities]);
  // Every status the workspace's projects define, for the filter (VERM-67).
  const statusList = useQuery({
    queryKey: ['workspace', 'jira-statuses', workspaceId, sources] as const,
    queryFn: () => window.vermilian.listWorkspaceJiraStatuses(workspaceId),
    staleTime: 5 * 60 * 1000,
    retry: false,
    enabled: sources.length > 0,
  });
  const knownStatuses = useMemo(() => (statusList.data?.ok ? statusList.data.statuses : []), [statusList.data]);
  const statusesIncomplete = statusList.isError || (statusList.data !== undefined && (!statusList.data.ok || statusList.data.incomplete));
  const statusFilter = useJiraHiddenStatuses(workspaceId, hiddenStatuses, onHiddenStatusesSaved);
  const boardColumns = useMemo(() => withAlwaysShownColumn(columns, knownStatuses), [columns, knownStatuses]);
  const statusOptions = useMemo(
    () => jiraStatusOptions(boardColumns, knownStatuses, statusFilter.hidden),
    [boardColumns, knownStatuses, statusFilter.hidden],
  );
  // Columns the workspace hides, counted rather than dropped (VERM-60).
  const { shown: shownColumns, hidden: hiddenColumns } = useMemo(
    () => splitHiddenColumns(boardColumns, statusFilter.hidden),
    [boardColumns, statusFilter.hidden],
  );
  const { view: assigneeView, toggleShowAll } = useDefaultAssignee(workspaceId, defaultAssignee, issues, myAccountId);
  const effectiveFilter = useMemo(() => defaultAssigneeFilter(filter, assigneeView), [filter, assigneeView]);
  const filtering = effectiveFilter.search.trim() !== '' || effectiveFilter.assignee.length > 0;
  const visible = useMemo(() => new Set(applyFilter(issues, effectiveFilter, myAccountId).map((i) => i.id)), [issues, effectiveFilter, myAccountId]);
  // Issues the Default assignee hides do not count, so a search still finds them.
  const searchMatchCount = useMemo(
    () => applyFilter(issues, defaultAssigneeFilter({ ...EMPTY_FILTER, search: filter.search }, assigneeView), myAccountId).length,
    [issues, filter.search, assigneeView, myAccountId],
  );
  const toggleAssignee = (v: string) =>
    setFilter((f) => ({ ...f, assignee: f.assignee.includes(v) ? f.assignee.filter((a) => a !== v) : [...f.assignee, v] }));

  return (
    <div className={styles.board} data-testid="jira-workspace-board">
      <div className={styles.header}>
        <Heading type="h3" weight="bold">{workspaceName}</Heading>
        <span className={styles.readOnly} data-testid="jira-board-read-only" title="Nothing in this version changes Jira issues.">
          Jira · read-only
        </span>
        <span className={styles.count} data-testid="jira-issue-count">
          {filtering ? `${visible.size} of ${issues.length}` : issues.length} issues
        </span>
        <span className={styles.spacer} />
        <label className={styles.toggle}>
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} data-testid="jira-show-done" />
          Show done
        </label>
        <JiraColumnsMenu
          workspaceId={workspaceId}
          statuses={statusOptions}
          hidden={statusFilter.hidden}
          onSaved={onHiddenStatusesSaved}
        />
        <Button kind="tertiary" size="small" data-testid="choose-jira-projects-btn" onClick={onChooseProjects}>
          Choose projects and boards…
        </Button>
      </div>

      {reconnect ? (
        <JiraReconnect workspaceName={workspaceName} failure={reconnect} onRetry={retry} onOpenSettings={onOpenSettings} />
      ) : sources.length === 0 ? (
        <div className={styles.empty} data-testid="jira-workspace-projects">
          <Text type="text1">No Jira projects or boards chosen yet.</Text>
        </div>
      ) : (
        <>
          {projectKeys.length > 0 && (
            <div className={styles.projects} data-testid="jira-workspace-projects">Jira projects: {projectKeys.join(', ')}</div>
          )}
          {boards.length > 0 && (
            <div className={styles.projects} data-testid="jira-workspace-boards">Jira boards: {boards.map((b) => b.name).join(', ')}</div>
          )}
          <div className={styles.searchRow}>
            <BoardSearch
              value={filter.search}
              onChange={(search) => setFilter((f) => ({ ...f, search }))}
              localMatchCount={searchMatchCount}
              scope={{ kind: 'jira', workspaceId }}
              onSelectIssue={(issue) => onSelectIssue(issue.idReadable)}
              placeholder={`Search ${workspaceName} by key or text  ( / )`}
            />
          </div>
          {(issues.length > 0 || statusOptions.length > 0) && (
            <div className={pbStyles.filterBar} data-testid="ws-filter-bar">
              <JiraStatusPills
                statuses={statusOptions}
                hidden={statusFilter.hidden}
                saving={statusFilter.saving}
                onToggle={statusFilter.toggle}
              />
              {assigneeView.mode === 'mine' ? (
                <DefaultAssigneePill issues={issues} value={assigneeView.value} onToggle={toggleShowAll} />
              ) : (
                <AssigneePills issues={issues} myId={myAccountId} active={filter.assignee} onToggle={toggleAssignee} />
              )}
              {assigneeView.mode !== 'mine' && filter.assignee.length > 0 && (
                <button type="button" className={pbStyles.filterClear} onClick={() => setFilter((f) => ({ ...f, assignee: [] }))}>Clear</button>
              )}
            </div>
          )}
          <DefaultAssigneeBar view={assigneeView} onToggle={toggleShowAll} />
          {statusesIncomplete && (
            <div className={styles.projects} role="status" data-testid="jira-status-list-note">
              Some Jira statuses could not be listed, so the Status filter may be incomplete.
            </div>
          )}
          {statusFilter.error && (
            <div className={styles.error} role="alert" data-testid="jira-status-filter-error">{statusFilter.error}</div>
          )}
          {hiddenColumns.length > 0 && (
            <div className={styles.hiddenColumns} data-testid="jira-hidden-columns">
              {describeHiddenColumns(hiddenColumns)}
            </div>
          )}
          {notices.length > 0 && (
            <div className={styles.projects} role="status" data-testid="jira-board-notice">
              {notices.map((n) => <div key={n}>{n}</div>)}
            </div>
          )}
          {failures.length > 0 && (
            <div className={styles.error} role="alert" data-testid="jira-board-error">
              {failures.map((f) => <div key={f}>{f}</div>)}
            </div>
          )}
          {loading && issues.length === 0 ? (
            <div className={styles.empty}><Loader size="small" /></div>
          ) : (
            <div className={styles.columns}>
              {shownColumns.map((col) => {
                const shown = filtering ? col.issues.filter((i) => visible.has(i.id)) : col.issues;
                return (
                <section key={col.status} className={styles.column} data-testid="jira-column" data-status={col.status} data-role={col.role ?? ''}>
                  <div className={styles.columnHeader}>
                    <span>{col.status}</span>
                    <span className={styles.columnCount} data-testid="jira-column-count">
                      {filtering ? `${shown.length} of ${col.issues.length}` : col.issues.length}
                    </span>
                  </div>
                  {shown.map((issue) => (
                    <article
                      key={issue.id}
                      className={`${styles.card} ${issue.idReadable === selectedIssueKey ? styles.cardSelected : ''}`}
                      data-testid="jira-card"
                      data-issue-key={issue.idReadable}
                      // Read-only: Jira cards are never draggable (VERM-34).
                      draggable={false}
                      role="button"
                      tabIndex={0}
                      aria-roledescription="read-only Jira issue"
                      aria-current={issue.idReadable === selectedIssueKey ? 'true' : undefined}
                      onClick={() => onSelectIssue(issue.idReadable)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectIssue(issue.idReadable);
                        }
                      }}
                    >
                      <div className={styles.cardTop}>
                        <span className={styles.cardKey}>{issue.idReadable}</span>
                        {/* Vermilian's own Runway metadata, kept locally (VERM-38): not a Jira write. */}
                        <JiraFocusControl workspaceId={workspaceId} issueKey={issue.idReadable} summaryOf={summaryOf} />
                      </div>
                      <div className={styles.cardSummary}>{issue.summary}</div>
                      <div className={styles.cardMeta}>
                        {issue.fields.priority && <span className={styles.chip} data-testid="jira-card-priority">{issue.fields.priority}</span>}
                        {issue.fields.dueDate !== null && <span className={styles.due}>Due {formatDate(issue.fields.dueDate)}</span>}
                        {issue.parentEpic && <span className={styles.epic} title={issue.parentEpic.summary}>{issue.parentEpic.idReadable}</span>}
                      </div>
                    </article>
                  ))}
                </section>
                );
              })}
              {columns.length === 0 && !loading && failures.length === 0 && (
                <div className={styles.empty}><Text type="text1">No {showDone ? '' : 'open '}issues in these projects.</Text></div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
