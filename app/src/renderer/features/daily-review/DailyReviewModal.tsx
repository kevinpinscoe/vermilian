// Priority Desk Daily Review (VERM-9, docs/requirements.md § Priority Desk).
// The human decision surface complementing Daily Stand-up: Stand-up answers
// "what happened?", this answers "what requires my attention or decision
// now?" Deterministic only — no Claude call, no scoring, no interpretation
// (PLAN.md "Design decisions"). Every section reuses data Vermilian already
// fetches: Now/Next/Then via the same hook Priority Desk's Now mode uses,
// blocked-focused and needs-attention derived from the same board query, and
// recently-completed via the same Stand-up issue fetch with no Claude step
// after it. The three agent-work sections are fixed, inert placeholders —
// Vermilian has no agent-execution metadata store yet, and this view must
// never fabricate one from ordinary YouTrack fields.
import React from 'react';
import { Modal, ModalContent, ModalHeader, Button, Text, Heading, Loader, AttentionBox } from '@vibe/core';
import type { BoardIssue } from '../../../shared/workspace';
import { useWorkspaceFocusRankHolders } from '../project-board/focus';
import { useActiveWorkspaceIssues, deriveBlockedFocused, deriveNeedsAttention } from './boardData';
import { useDailyReviewCompleted } from './api';
import styles from './DailyReviewModal.module.css';

interface DailyReviewModalProps {
  onClose: () => void;
  onSelectIssue: (issueId: string) => void;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function DailyReviewModal({ onClose, onSelectIssue }: DailyReviewModalProps) {
  const { byRank, isLoading: focusLoading } = useWorkspaceFocusRankHolders();
  const { issues, isLoading: boardLoading, isError: boardError } = useActiveWorkspaceIssues();
  const completedQuery = useDailyReviewCompleted();

  const blockedFocused = deriveBlockedFocused(issues);
  const needsAttention = deriveNeedsAttention(issues);
  const now = new Date();

  function selectAndClose(issueId: string) {
    onSelectIssue(issueId);
    onClose();
  }

  const isLoading = focusLoading || boardLoading || completedQuery.isPending;
  const isError = boardError || (completedQuery.isSuccess && !completedQuery.data.ok);

  return (
    <Modal id="daily-review-modal" show onClose={onClose} size="large">
      <ModalHeader title={`Daily Review — ${formatDate(now)}`} />
      <ModalContent>
        <div className={styles.body} data-testid="daily-review-body">
          {isError && (
            <div data-testid="daily-review-error">
              <AttentionBox
                type="negative"
                title="Couldn't load Daily Review"
                text={
                  boardError
                    ? "One or more projects in this workspace failed to load."
                    : (completedQuery.data?.error ?? 'Failed to load recently completed work.')
                }
              />
            </div>
          )}

          {!isError && isLoading && (
            <div className={styles.loading} data-testid="daily-review-loading">
              <Loader size={40} />
              <Text type="text1">Loading…</Text>
            </div>
          )}

          {!isError && !isLoading && (
            <>
              <Section title="Now / Next / Then" testId="daily-review-focus-slots">
                <FocusSlots byRank={byRank} onSelectIssue={selectAndClose} />
              </Section>

              <Section title="Blocked focused work" testId="daily-review-blocked">
                <IssueList
                  issues={blockedFocused}
                  emptyText="Nothing focused is blocked."
                  testIdPrefix="daily-review-blocked"
                  onSelectIssue={selectAndClose}
                />
              </Section>

              <Section title="Needs attention" testId="daily-review-needs-attention">
                <Text type="text2" className={styles.sectionHint}>
                  Starred but never assigned a Focus rank — a decision left half-made.
                </Text>
                <IssueList
                  issues={needsAttention}
                  emptyText="Nothing starred is waiting on a rank."
                  testIdPrefix="daily-review-needs-attention"
                  onSelectIssue={selectAndClose}
                />
              </Section>

              <Section title="Recently completed" testId="daily-review-completed">
                <CompletedList tasks={completedQuery.data?.completed ?? []} />
              </Section>

              <Section title="Agent work awaiting review" testId="daily-review-agent-awaiting-review">
                <AgentSectionPlaceholder />
              </Section>

              <Section title="Agent work needing input" testId="daily-review-agent-needing-input">
                <AgentSectionPlaceholder />
              </Section>

              <Section title="Failed agent work" testId="daily-review-agent-failed">
                <AgentSectionPlaceholder />
              </Section>
            </>
          )}

          <div className={styles.actions}>
            <Button onClick={onClose} size="small">Close</Button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
}

// ─── Section shell ──────────────────────────────────────────────────────────

function Section({
  title, testId, children,
}: {
  title: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.section} data-testid={testId}>
      <Heading type="h3" weight="bold" className={styles.sectionTitle}>{title}</Heading>
      {children}
    </div>
  );
}

// ─── Now / Next / Then ──────────────────────────────────────────────────────

const SLOTS: { rank: 1 | 2 | 3; label: string }[] = [
  { rank: 1, label: 'Now' },
  { rank: 2, label: 'Next' },
  { rank: 3, label: 'Then' },
];

function FocusSlots({
  byRank, onSelectIssue,
}: {
  byRank: Map<1 | 2 | 3, { issue: BoardIssue }[]>;
  onSelectIssue: (issueId: string) => void;
}) {
  const allEmpty = SLOTS.every((s) => (byRank.get(s.rank) ?? []).length === 0);
  if (allEmpty) {
    return (
      <Text type="text2" data-testid="daily-review-focus-slots-empty">
        No tasks are ranked yet.
      </Text>
    );
  }
  return (
    <div className={styles.slotRow}>
      {SLOTS.map(({ rank, label }) => {
        const holders = byRank.get(rank) ?? [];
        return (
          <div key={rank} className={styles.slot} data-testid={`daily-review-slot-${label.toLowerCase()}`}>
            <Text type="text2" className={styles.slotLabel}>{label}</Text>
            {holders.length === 0 ? (
              <Text type="text2" className={styles.emptySlot}>Empty</Text>
            ) : (
              holders.map((h) => (
                <button
                  key={h.issue.id}
                  type="button"
                  className={styles.issueRow}
                  data-testid={`daily-review-slot-issue-${h.issue.id}`}
                  onClick={() => onSelectIssue(h.issue.id)}
                >
                  <span className={styles.issueId}>{h.issue.idReadable}</span> {h.issue.summary}
                </button>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Board-derived issue lists (blocked, needs attention) ──────────────────

function IssueList({
  issues, emptyText, testIdPrefix, onSelectIssue,
}: {
  issues: BoardIssue[];
  emptyText: string;
  testIdPrefix: string;
  onSelectIssue: (issueId: string) => void;
}) {
  if (issues.length === 0) {
    return <Text type="text2" data-testid={`${testIdPrefix}-empty`}>{emptyText}</Text>;
  }
  return (
    <div className={styles.list}>
      {issues.map((issue) => (
        <button
          key={issue.id}
          type="button"
          className={styles.issueRow}
          data-testid={`${testIdPrefix}-issue-${issue.id}`}
          onClick={() => onSelectIssue(issue.id)}
        >
          <span className={styles.issueId}>{issue.idReadable}</span> {issue.summary}
        </button>
      ))}
    </div>
  );
}

// ─── Recently completed — read-only, not clickable through to a live issue
// detail the way the board-derived lists are: these tasks came back from the
// Stand-up fetch (main/api/youtrack.ts's getIssuesForStandup), which carries
// no BoardIssue.id — only idReadable — so there is nothing to hand
// onSelectIssue. ──────────────────────────────────────────────────────────

function CompletedList({ tasks }: { tasks: { idReadable: string; summary: string }[] }) {
  if (tasks.length === 0) {
    return (
      <Text type="text2" data-testid="daily-review-completed-empty">
        Nothing completed in the last 48 hours.
      </Text>
    );
  }
  return (
    <div className={styles.list}>
      {tasks.map((t) => (
        <div key={t.idReadable} className={styles.issueRowStatic} data-testid={`daily-review-completed-${t.idReadable}`}>
          <span className={styles.issueId}>{t.idReadable}</span> {t.summary}
        </div>
      ))}
    </div>
  );
}

// ─── Agent-work placeholders ────────────────────────────────────────────────

function AgentSectionPlaceholder() {
  return (
    <AttentionBox
      type="neutral"
      text="Agent-execution tracking isn't set up yet, so there's nothing to show here."
    />
  );
}
