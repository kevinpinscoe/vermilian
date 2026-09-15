// Priority Desk — Manual desk, Now mode (VERM-5, delivery step 2 of the Priority
// Desk epic, VERM-3). A cross-project decision surface above "All tasks" in the
// left rail: at most three ranked cards (Now/Next/Then = Focus rank 1/2/3),
// scoped to the active workspace. Reuses VERM-4's Focus/rank hooks, mutations,
// and duplicate-rank repair banner verbatim — this file adds no second ranking
// mechanism of its own (docs/requirements.md § Priority Desk, ADR-0007).
//
// Choose-next mode, Epic context, AI recommendation, and Daily Review are later
// delivery steps and are explicitly out of scope here — see VERM-5.
import React from 'react';
import { Heading, Text, Button } from '@vibe/core';
import { Play } from '@vibe/icons';
import type { BoardIssue } from '../../../shared/workspace';
import { ChipCell } from '../project-board/KanbanView';
import { PRIORITY_COLORS } from '../project-board/colors';
import { FocusControl } from '../project-board/FocusControl';
import { FocusRankRepairBanner } from '../project-board/FocusRankRepairBanner';
import {
  useWorkspaceFocusRankHolders,
  type FocusRank,
  type FocusRankHolder,
} from '../project-board/focus';
import { useProjects } from '../workspace-nav/api';
import styles from './PriorityDesk.module.css';

interface PriorityDeskProps {
  onSelectIssue: (issueId: string) => void;
  onStartTimer: (issueId: string, idReadable: string, summary: string) => void;
}

interface SlotDef {
  rank: FocusRank;
  label: string;
}

const SLOTS: SlotDef[] = [
  { rank: 1, label: 'Now' },
  { rank: 2, label: 'Next' },
  { rank: 3, label: 'Then' },
];

export function PriorityDesk({ onSelectIssue, onStartTimer }: PriorityDeskProps) {
  const { byRank, isLoading } = useWorkspaceFocusRankHolders();
  const projects = useProjects();

  function projectNameFor(shortName: string): string {
    return projects.data?.find((p) => p.shortName === shortName)?.name ?? shortName;
  }

  const allEmpty = SLOTS.every((s) => (byRank.get(s.rank) ?? []).length === 0);

  return (
    <div className={styles.desk} data-testid="priority-desk">
      <div className={styles.header}>
        <Heading type="h3" weight="bold" className={styles.title} data-testid="priority-desk-title">
          ★ Priority Desk
        </Heading>
      </div>

      <div className={styles.body}>
        <FocusRankRepairBanner />

        {isLoading ? (
          <div className={styles.loading}>
            <Text type="text2">Loading…</Text>
          </div>
        ) : (
          <>
            {allEmpty && (
              <div className={styles.allEmptyNote} data-testid="priority-desk-all-empty">
                <Text type="text2">Nothing focused yet. Star a task to add it here.</Text>
              </div>
            )}

            <div className={styles.slots}>
              {SLOTS.map(({ rank, label }) => (
                <DeskSlot
                  key={rank}
                  rank={rank}
                  label={label}
                  holders={byRank.get(rank) ?? []}
                  projectNameFor={projectNameFor}
                  onSelectIssue={onSelectIssue}
                  onStartTimer={onStartTimer}
                />
              ))}
            </div>
          </>
        )}

        <Text type="text2" className={styles.footerNote}>
          ★ Focus is toggled the same way in board rows, Kanban cards, and the task detail panel.
        </Text>
      </div>
    </div>
  );
}

// ─── Slot ───────────────────────────────────────────────────────────────────

function DeskSlot({
  rank, label, holders, projectNameFor, onSelectIssue, onStartTimer,
}: {
  rank: FocusRank;
  label: string;
  holders: FocusRankHolder[];
  projectNameFor: (shortName: string) => string;
  onSelectIssue: (id: string) => void;
  onStartTimer: (issueId: string, idReadable: string, summary: string) => void;
}) {
  const slotKey = label.toLowerCase();

  return (
    <div className={styles.slot} data-testid={`priority-desk-slot-${slotKey}`}>
      <Text type="text2" className={styles.slotLabel}>{label}</Text>

      {holders.length === 0 && (
        <div className={styles.emptyCard} data-testid={`priority-desk-empty-${slotKey}`}>
          <Text type="text2" className={styles.emptyCardTitle}>Empty is fine</Text>
          <Text type="text2" className={styles.emptyCardHint}>Nothing forces this slot to fill.</Text>
        </div>
      )}

      {/* Two or more issues sharing this rank is the repair state handled by
          FocusRankRepairBanner above — never auto-resolved here. */}
      {holders.length > 1 && (
        <div className={styles.needsRepairCard} data-testid={`priority-desk-duplicate-${slotKey}`}>
          <Text type="text2" className={styles.needsRepairText}>
            {holders.length} issues share Focus rank {rank} — resolve above.
          </Text>
        </div>
      )}

      {holders.length === 1 && (
        <DeskCard
          holder={holders[0]}
          isNow={rank === 1}
          projectName={projectNameFor(holders[0].projectShortName)}
          onSelectIssue={onSelectIssue}
          onStartTimer={onStartTimer}
        />
      )}
    </div>
  );
}

// ─── Card ───────────────────────────────────────────────────────────────────

function DeskCard({
  holder, isNow, projectName, onSelectIssue, onStartTimer,
}: {
  holder: FocusRankHolder;
  isNow: boolean;
  projectName: string;
  onSelectIssue: (id: string) => void;
  onStartTimer: (issueId: string, idReadable: string, summary: string) => void;
}) {
  const issue: BoardIssue = holder.issue;

  return (
    <div
      className={`${styles.card} ${isNow ? styles.cardNow : ''}`}
      data-testid={`priority-desk-card-${issue.id}`}
      onClick={() => onSelectIssue(issue.id)}
    >
      <div className={styles.cardTop}>
        <span className={styles.cardId}>{issue.idReadable}</span>
        {/* Priority is display-only here — the desk never writes it (docs/requirements.md § Priority Desk). */}
        {issue.fields.priority && (
          <ChipCell value={issue.fields.priority} colorMap={PRIORITY_COLORS} />
        )}
      </div>

      <Text type="text2" className={styles.cardSummary}>{issue.summary}</Text>
      <Text type="text2" className={styles.cardMeta}>{projectName}</Text>

      {issue.fields.whyNow ? (
        <Text type="text2" className={styles.cardWhyNow}>&ldquo;{issue.fields.whyNow}&rdquo;</Text>
      ) : (
        <Text type="text2" className={styles.cardWhyNowEmpty}>No reason given yet.</Text>
      )}

      <div className={styles.cardFocusRow} onClick={(e) => e.stopPropagation()}>
        <FocusControl issue={issue} projectShortName={holder.projectShortName} />
      </div>

      <div className={styles.cardActions}>
        {isNow ? (
          <Button
            size="small"
            leftIcon={Play}
            onClick={(e) => { e.stopPropagation(); onStartTimer(issue.id, issue.idReadable, issue.summary); }}
            data-testid={`priority-desk-start-focus-${issue.id}`}
          >
            Start focus
          </Button>
        ) : (
          <Button
            size="small"
            kind="tertiary"
            onClick={(e) => { e.stopPropagation(); onSelectIssue(issue.id); }}
            data-testid={`priority-desk-open-${issue.id}`}
          >
            Open
          </Button>
        )}
      </div>
    </div>
  );
}
