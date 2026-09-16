// Priority Desk — Manual desk, Now mode (VERM-5) and Choose-next mode (VERM-6),
// delivery step 2 of the Priority Desk epic (VERM-3). A cross-project decision
// surface above "All tasks" in the left rail. Now mode: at most three ranked
// cards (Now/Next/Then = Focus rank 1/2/3). Choose next: at most seven eligible
// candidates (docs/requirements.md § Priority Desk "Choose-next eligibility"),
// a Status filter, and "Not this week" dismissal. Both modes reuse VERM-4's
// Focus/rank hooks, mutations, and duplicate-rank repair banner verbatim — no
// second ranking mechanism, and rank assignment on a candidate card goes
// through the same FocusControl (star, then rank badge) used everywhere else
// rather than a new drag-to-slot interaction.
//
// The active-Epic filter listed in VERM-6's original scope is deferred to
// VERM-7 — no native Epic/Subtask link data exists in Vermilian yet (scope
// decision recorded on VERM-6/VERM-7, 2026-09-16). Epic context, AI
// recommendation, and Daily Review remain later delivery steps.
import React, { useState } from 'react';
import { Heading, Text, Button, AttentionBox } from '@vibe/core';
import { Play } from '@vibe/icons';
import type { BoardIssue } from '../../../shared/workspace';
import { STATUS_OPTIONS } from '../../../shared/workspace';
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
import { useWorkspaceStore } from '../../stores/workspace';
import { useChooseNextCandidates, type Candidate } from './candidates';
import { currentWeekMonday, useDismissIssue } from './dismissals';
import styles from './PriorityDesk.module.css';

interface PriorityDeskProps {
  onSelectIssue: (issueId: string) => void;
  onStartTimer: (issueId: string, idReadable: string, summary: string) => void;
}

type Mode = 'now' | 'choose-next';

interface SlotDef {
  rank: FocusRank;
  label: string;
}

const SLOTS: SlotDef[] = [
  { rank: 1, label: 'Now' },
  { rank: 2, label: 'Next' },
  { rank: 3, label: 'Then' },
];

// Statuses a candidate could plausibly have — Done is excluded from the filter
// options because it is already excluded from eligibility itself.
const CANDIDATE_STATUS_OPTIONS = STATUS_OPTIONS.filter((s) => s !== 'Done');

export function PriorityDesk({ onSelectIssue, onStartTimer }: PriorityDeskProps) {
  // Mode and the Status filter are per-session UI state only — not persisted,
  // matching the design wireframe's own note (screen-priority-desk-now.d2).
  const [mode, setMode] = useState<Mode>('now');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const { byRank, isLoading: nowLoading } = useWorkspaceFocusRankHolders();
  const { candidates, isLoading: candidatesLoading, isError: candidatesError } = useChooseNextCandidates(statusFilter);
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
        <ModeSwitch mode={mode} onChange={setMode} candidateCount={candidates.length} />
      </div>

      <div className={styles.body}>
        <FocusRankRepairBanner />

        {mode === 'now' ? (
          nowLoading ? (
            <div className={styles.loading}>
              <Text type="text2">Loading…</Text>
            </div>
          ) : (
            <>
              {allEmpty && (
                <div className={styles.allEmptyNote} data-testid="priority-desk-all-empty">
                  <Text type="text2">
                    No tasks are ranked yet. Assign Focus rank 1, 2, or 3 from a board, Kanban card, or task detail.
                  </Text>
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
          )
        ) : (
          <ChooseNext
            candidates={candidates}
            isLoading={candidatesLoading}
            isError={candidatesError}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            projectNameFor={projectNameFor}
            onSelectIssue={onSelectIssue}
          />
        )}

        <Text type="text2" className={styles.footerNote}>
          ★ Focus is toggled the same way in board rows, Kanban cards, and the task detail panel.
        </Text>
      </div>
    </div>
  );
}

// ─── Mode switch ────────────────────────────────────────────────────────────

function ModeSwitch({
  mode, onChange, candidateCount,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  // Deliberately the count of candidates actually displayed (`candidates.length`,
  // capped at MAX_CANDIDATES) — "choices you can act on from here right now" —
  // not `totalEligible`, which can exceed the seven-item cap. Kept explicit here
  // because the two numbers can differ and the badge must not read as a promise
  // of how many are eligible (review finding on VERM-6's PR, 2026-09-16).
  candidateCount: number;
}) {
  return (
    <div className={styles.segmented} data-testid="priority-desk-mode-switch">
      <button
        type="button"
        data-testid="priority-desk-mode-now"
        className={`${styles.segmentedBtn} ${mode === 'now' ? styles.segmentedBtnActive : ''}`}
        onClick={() => onChange('now')}
      >
        Now
      </button>
      <button
        type="button"
        data-testid="priority-desk-mode-choose-next"
        className={`${styles.segmentedBtn} ${mode === 'choose-next' ? styles.segmentedBtnActive : ''}`}
        onClick={() => onChange('choose-next')}
      >
        Choose next ({candidateCount})
      </button>
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

// ─── Choose next ────────────────────────────────────────────────────────────

function ChooseNext({
  candidates, isLoading, isError, statusFilter, onStatusFilterChange, projectNameFor, onSelectIssue,
}: {
  candidates: Candidate[];
  isLoading: boolean;
  isError: boolean;
  statusFilter: string | null;
  onStatusFilterChange: (v: string | null) => void;
  projectNameFor: (shortName: string) => string;
  onSelectIssue: (id: string) => void;
}) {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const dismissIssue = useDismissIssue();

  function handleDismiss(issueId: string) {
    dismissIssue.mutate({ workspace: activeWorkspaceId, issueId, dismissedWeekOf: currentWeekMonday() });
  }

  return (
    <div data-testid="priority-desk-choose-next">
      <StatusFilter value={statusFilter} onChange={onStatusFilterChange} />

      {isError ? (
        <div data-testid="priority-desk-candidates-error">
          <AttentionBox
            type="negative"
            title="Couldn't load Choose next"
            text="One or more projects in this workspace failed to load. The candidate set would be incomplete, so nothing is shown until it can be loaded in full."
          />
        </div>
      ) : isLoading ? (
        <div className={styles.loading} data-testid="priority-desk-candidates-loading">
          <Text type="text2">Loading…</Text>
        </div>
      ) : candidates.length === 0 ? (
        <div className={styles.allEmptyNote} data-testid="priority-desk-no-candidates">
          <Text type="text2">
            No eligible candidates — nothing else is unfinished, or everything is already focused or dismissed.
          </Text>
        </div>
      ) : (
        <div className={styles.candidateGrid} data-testid="priority-desk-candidate-grid">
          {candidates.map((c) => (
            <CandidateCard
              key={c.issue.id}
              candidate={c}
              projectName={projectNameFor(c.projectShortName)}
              onSelectIssue={onSelectIssue}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Status filter ──────────────────────────────────────────────────────────
// Single-select — "when set" (docs/requirements.md § Priority Desk,
// "Choose-next eligibility"); clicking the active pill again clears it back
// to "All". The workspace scope is implicit (Priority Desk is already scoped
// to the active workspace) and needs no control here.

function StatusFilter({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className={styles.statusFilter} data-testid="priority-desk-status-filter">
      <button
        type="button"
        data-testid="priority-desk-status-pill"
        data-value=""
        className={`${styles.filterPill} ${value === null ? styles.filterPillActive : ''}`}
        onClick={() => onChange(null)}
      >
        All
      </button>
      {CANDIDATE_STATUS_OPTIONS.map((opt) => (
        <button
          key={opt}
          type="button"
          data-testid="priority-desk-status-pill"
          data-value={opt}
          className={`${styles.filterPill} ${value === opt ? styles.filterPillActive : ''}`}
          onClick={() => onChange(value === opt ? null : opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

// ─── Candidate card ─────────────────────────────────────────────────────────

function CandidateCard({
  candidate, projectName, onSelectIssue, onDismiss,
}: {
  candidate: Candidate;
  projectName: string;
  onSelectIssue: (id: string) => void;
  onDismiss: (issueId: string) => void;
}) {
  const { issue, projectShortName } = candidate;

  return (
    <div
      className={styles.candidateCard}
      data-testid={`priority-desk-candidate-${issue.id}`}
      onClick={() => onSelectIssue(issue.id)}
    >
      <div className={styles.cardTop}>
        <span className={styles.cardId} data-testid="priority-desk-candidate-id">{issue.idReadable}</span>
        {issue.fields.priority && (
          <ChipCell value={issue.fields.priority} colorMap={PRIORITY_COLORS} />
        )}
      </div>

      <Text type="text2" className={styles.cardSummary}>{issue.summary}</Text>
      <Text type="text2" className={styles.cardMeta}>{projectName}</Text>

      <div className={styles.cardFocusRow} onClick={(e) => e.stopPropagation()}>
        <FocusControl issue={issue} projectShortName={projectShortName} />
      </div>

      <div className={styles.cardActions}>
        <Button
          size="small"
          kind="tertiary"
          onClick={(e) => { e.stopPropagation(); onSelectIssue(issue.id); }}
          data-testid={`priority-desk-candidate-open-${issue.id}`}
        >
          Open
        </Button>
        <Button
          size="small"
          kind="tertiary"
          onClick={(e) => { e.stopPropagation(); onDismiss(issue.id); }}
          data-testid={`priority-desk-candidate-dismiss-${issue.id}`}
        >
          Not this week
        </Button>
      </div>
    </div>
  );
}
