import React, { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Button, Heading, Loader, Text } from '@vibe/core';
import type { BoardIssue } from '../../../shared/workspace';
import { formatDate } from '../project-board/KanbanView';
import { jiraBoardColumns } from './jiraBoard';
import styles from './JiraWorkspaceBoard.module.css';

interface JiraWorkspaceBoardProps {
  workspaceId: string;
  workspaceName: string;
  projectKeys: string[];
  onChooseProjects: () => void;
  selectedIssueKey?: string | null;
  // Opens the read-only detail panel (VERM-35).
  onSelectIssue: (issueKey: string) => void;
}

export const workspaceJiraIssuesQueryKey = (workspaceId: string, projectKey: string, includeResolved: boolean) =>
  ['workspace', 'jira-issues', workspaceId, projectKey, includeResolved] as const;

/**
 * A Jira workspace's board, read-only (VERM-34). Issues come from Jira through
 * the workspace's own connection; cards cannot be dragged, edited or used to
 * start a timer, because nothing in Phase 1 writes to Jira. Clicking a card
 * opens its read-only detail panel (VERM-35).
 */
export function JiraWorkspaceBoard({
  workspaceId,
  workspaceName,
  projectKeys,
  onChooseProjects,
  selectedIssueKey = null,
  onSelectIssue,
}: JiraWorkspaceBoardProps) {
  const [showDone, setShowDone] = useState(false);

  const results = useQueries({
    queries: projectKeys.map((projectKey) => ({
      queryKey: workspaceJiraIssuesQueryKey(workspaceId, projectKey, showDone),
      queryFn: () => window.vermilian.getWorkspaceJiraIssues({ workspaceId, projectKey, includeResolved: showDone }),
      staleTime: 60 * 1000,
    })),
  });

  const loading = results.some((r) => r.isLoading);
  const failures = results.flatMap((r, i) => (r.data && !r.data.ok ? [`${projectKeys[i]}: ${r.data.message}`] : r.error ? [`${projectKeys[i]}: ${(r.error as Error).message}`] : []));

  const { issues, priorities } = useMemo(() => {
    const all: BoardIssue[] = [];
    const prio: Record<string, string[]> = {};
    results.forEach((r, i) => {
      if (r.data?.ok) {
        all.push(...r.data.issues);
        prio[projectKeys[i]] = r.data.priorities;
      }
    });
    return { issues: all, priorities: prio };
  }, [results, projectKeys]);

  const columns = useMemo(() => jiraBoardColumns(issues, priorities), [issues, priorities]);

  return (
    <div className={styles.board} data-testid="jira-workspace-board">
      <div className={styles.header}>
        <Heading type="h3" weight="bold">{workspaceName}</Heading>
        <span className={styles.readOnly} data-testid="jira-board-read-only" title="Nothing in this version changes Jira issues.">
          Jira · read-only
        </span>
        <span className={styles.count} data-testid="jira-issue-count">{issues.length} issues</span>
        <span className={styles.spacer} />
        <label className={styles.toggle}>
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} data-testid="jira-show-done" />
          Show done
        </label>
        <Button kind="tertiary" size="small" data-testid="choose-jira-projects-btn" onClick={onChooseProjects}>
          Choose Jira projects…
        </Button>
      </div>

      {projectKeys.length === 0 ? (
        <div className={styles.empty} data-testid="jira-workspace-projects">
          <Text type="text1">No Jira projects chosen yet.</Text>
        </div>
      ) : (
        <>
          <div className={styles.projects} data-testid="jira-workspace-projects">Jira projects: {projectKeys.join(', ')}</div>
          {failures.length > 0 && (
            <div className={styles.error} role="alert" data-testid="jira-board-error">
              {failures.map((f) => <div key={f}>{f}</div>)}
            </div>
          )}
          {loading && issues.length === 0 ? (
            <div className={styles.empty}><Loader size="small" /></div>
          ) : (
            <div className={styles.columns}>
              {columns.map((col) => (
                <section key={col.status} className={styles.column} data-testid="jira-column" data-status={col.status} data-role={col.role ?? ''}>
                  <div className={styles.columnHeader}>
                    <span>{col.status}</span>
                    <span className={styles.columnCount}>{col.issues.length}</span>
                  </div>
                  {col.issues.map((issue) => (
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
                      <div className={styles.cardKey}>{issue.idReadable}</div>
                      <div className={styles.cardSummary}>{issue.summary}</div>
                      <div className={styles.cardMeta}>
                        {issue.fields.priority && <span className={styles.chip} data-testid="jira-card-priority">{issue.fields.priority}</span>}
                        {issue.fields.dueDate !== null && <span className={styles.due}>Due {formatDate(issue.fields.dueDate)}</span>}
                        {issue.parentEpic && <span className={styles.epic} title={issue.parentEpic.summary}>{issue.parentEpic.idReadable}</span>}
                      </div>
                    </article>
                  ))}
                </section>
              ))}
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
