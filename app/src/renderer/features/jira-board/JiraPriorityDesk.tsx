// The Priority Desk for a Jira workspace (VERM-38): Now / Next / Then are the
// issues holding Focus rank 1 / 2 / 3 in this workspace's local Runway store
// (ADR-0011 §6). Ranks and Why now come from the store; the summary and
// priority on each card come live from Jira through the board's own queries,
// so nothing about an issue's content is stored locally. Nothing is written
// to Jira, and Jira's Rank field is never read or written.
//
// Choose next, the AI recommendation and "Not this week" stay YouTrack-only
// for now; this desk is Now mode.
import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Heading, Loader, Text } from '@vibe/core';
import type { BoardIssue } from '../../../shared/workspace';
import type { RunwayRank } from '../../../shared/runway';
import { ChipCell } from '../project-board/KanbanView';
import { PRIORITY_COLORS } from '../project-board/colors';
import { JiraFocusControl } from './JiraFocusControl';
import { JiraReconnect } from './JiraReconnect';
import { runwayEntryFor, useJiraRunway, type JiraRunwayIndex } from './jiraRunway';
import { useJiraWorkspaceIssues } from './useJiraWorkspaceIssues';
import { workspaceJiraIssuesPrefix } from './jiraBoardSync';
import styles from '../priority-desk/PriorityDesk.module.css';

interface JiraPriorityDeskProps {
  workspaceId: string;
  workspaceName: string;
  projectKeys: string[];
  onSelectIssue: (issueKey: string) => void;
  onOpenSettings: () => void;
}

const SLOTS: { rank: RunwayRank; label: string }[] = [
  { rank: 1, label: 'Now' },
  { rank: 2, label: 'Next' },
  { rank: 3, label: 'Then' },
];

export function JiraPriorityDesk({ workspaceId, workspaceName, projectKeys, onSelectIssue, onOpenSettings }: JiraPriorityDeskProps) {
  const queryClient = useQueryClient();
  const runway = useJiraRunway(workspaceId);
  // Open issues only, the board's default view, so the desk shares its cache.
  const { issues, loading, reconnect } = useJiraWorkspaceIssues(workspaceId, projectKeys, false);
  const issueByKey = new Map(issues.map((i) => [i.idReadable, i]));
  const summaryOf = (key: string) => issueByKey.get(key)?.summary;
  const allEmpty = SLOTS.every((s) => !runway.index.byRank.has(s.rank));

  return (
    <div className={styles.desk} data-testid="priority-desk" data-backend="jira">
      <div className={styles.header}>
        <Heading type="h3" weight="bold" className={styles.title} data-testid="priority-desk-title">
          ★ Priority Desk
        </Heading>
      </div>

      <div className={styles.body}>
        {reconnect ? (
          <JiraReconnect workspaceName={workspaceName} failure={reconnect} onRetry={() => void queryClient.invalidateQueries({ queryKey: workspaceJiraIssuesPrefix(workspaceId) })} onOpenSettings={onOpenSettings} />
        ) : runway.isError ? (
          <div className={styles.allEmptyNote} role="alert" data-testid="jira-desk-runway-error">
            <Text type="text2">Couldn&apos;t read the Priority Desk store: {runway.error?.message}</Text>
          </div>
        ) : runway.isLoading ? (
          <div className={styles.loading}><Loader size="small" /></div>
        ) : (
          <>
            {allEmpty && (
              <div className={styles.allEmptyNote} data-testid="priority-desk-all-empty">
                <Text type="text2">
                  No Jira issues are ranked yet. Star an issue on the board or in its detail panel, then give it rank 1, 2, or 3.
                </Text>
              </div>
            )}
            <div className={styles.slots}>
              {SLOTS.map(({ rank, label }) => (
                <JiraDeskSlot
                  key={rank}
                  rank={rank}
                  label={label}
                  workspaceId={workspaceId}
                  runway={runway.index}
                  issue={(() => { const k = runway.index.byRank.get(rank); return k ? issueByKey.get(k) : undefined; })()}
                  issuesLoading={loading}
                  summaryOf={summaryOf}
                  onSelectIssue={onSelectIssue}
                />
              ))}
            </div>
          </>
        )}

        <Text type="text2" className={styles.footerNote}>
          ★ Focus, rank and Why now for Jira issues are kept in Vermilian on this computer. Jira is never changed.
        </Text>
      </div>
    </div>
  );
}

function JiraDeskSlot({
  rank, label, workspaceId, runway, issue, issuesLoading, summaryOf, onSelectIssue,
}: {
  rank: RunwayRank;
  label: string;
  workspaceId: string;
  runway: JiraRunwayIndex;
  issue: BoardIssue | undefined;
  issuesLoading: boolean;
  summaryOf: (key: string) => string | undefined;
  onSelectIssue: (issueKey: string) => void;
}) {
  const slotKey = label.toLowerCase();
  const issueKey = runway.byRank.get(rank);

  return (
    <div className={styles.slot} data-testid={`priority-desk-slot-${slotKey}`}>
      <Text type="text2" className={styles.slotLabel}>{label}</Text>

      {issueKey === undefined ? (
        <div className={styles.emptyCard} data-testid={`priority-desk-empty-${slotKey}`}>
          <Text type="text2" className={styles.emptyCardTitle}>Empty is fine</Text>
          <Text type="text2" className={styles.emptyCardHint}>Nothing forces this slot to fill.</Text>
        </div>
      ) : (
        <div
          className={`${styles.card} ${rank === 1 ? styles.cardNow : ''}`}
          data-testid={`priority-desk-card-${issueKey}`}
          onClick={() => onSelectIssue(issueKey)}
        >
          <div className={styles.cardTop}>
            <span className={styles.cardId}>{issueKey}</span>
            {issue?.fields.priority && <ChipCell value={issue.fields.priority} colorMap={PRIORITY_COLORS} />}
          </div>

          <Text type="text2" className={styles.cardSummary}>
            {issue
              ? issue.summary
              : issuesLoading
                ? 'Loading from Jira…'
                // Done, moved out of this workspace's projects, or deleted:
                // the rank stays until it is cleared here.
                : 'Not among this workspace\'s open Jira issues.'}
          </Text>
          {issue && <Text type="text2" className={styles.cardMeta}>Jira project {issueKey.slice(0, issueKey.lastIndexOf('-'))}</Text>}

          {(() => {
            const whyNow = runwayEntryFor(runway, issueKey).whyNow;
            return whyNow ? (
              <Text type="text2" className={styles.cardWhyNow} data-testid={`priority-desk-why-now-${issueKey}`}>&ldquo;{whyNow}&rdquo;</Text>
            ) : (
              <Text type="text2" className={styles.cardWhyNowEmpty}>No reason given yet.</Text>
            );
          })()}

          <div className={styles.cardFocusRow} onClick={(e) => e.stopPropagation()}>
            <JiraFocusControl workspaceId={workspaceId} issueKey={issueKey} summaryOf={summaryOf} />
          </div>

          <div className={styles.cardActions}>
            <Button
              size="small"
              kind="tertiary"
              onClick={(e) => { e.stopPropagation(); onSelectIssue(issueKey); }}
              data-testid={`priority-desk-open-${issueKey}`}
            >
              Open
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
