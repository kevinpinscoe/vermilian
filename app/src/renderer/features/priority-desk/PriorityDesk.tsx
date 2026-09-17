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
// VERM-7 adds the native Epic → Subtask context this file previously deferred:
// Now-mode cards show a resolvable parent Epic (BoardIssue.parentEpic, read-
// only — see api/youtrack.ts), and Choose next gains the active-Epic filter
// VERM-6 left unpopulated. AI recommendation and Daily Review remain later
// delivery steps.
import React, { useState } from 'react';
import { Heading, Text, Button, AttentionBox } from '@vibe/core';
import { Play } from '@vibe/icons';
import type { BoardIssue, ParentEpic } from '../../../shared/workspace';
import { STATUS_OPTIONS } from '../../../shared/workspace';
import type { ConfirmationAction, RecommendationItem, RecommendationResult } from '../../../shared/ipc';
import { ChipCell } from '../project-board/KanbanView';
import { PRIORITY_COLORS } from '../project-board/colors';
import { FocusControl } from '../project-board/FocusControl';
import { FocusRankRepairBanner } from '../project-board/FocusRankRepairBanner';
import {
  useWorkspaceFocusRankHolders,
  useFocusMutations,
  decideRankAssignment,
  type FocusRank,
  type FocusRankHolder,
} from '../project-board/focus';
import { useProjects } from '../workspace-nav/api';
import { useCredentialStatus } from '../settings/api';
import { useWorkspaceStore } from '../../stores/workspace';
import { useChooseNextCandidates, type Candidate } from './candidates';
import { currentWeekMonday, useDismissIssue } from './dismissals';
import { useMasterPlan } from './masterPlanApi';
import { MasterPlanDiagnosticBanner } from './MasterPlanDiagnosticBanner';
import { resolveEpicOutcome } from '../../../shared/masterPlan';
import type { Outcome } from '../../../shared/masterPlan';
import {
  buildCandidateContext,
  planConfirmationWrites,
  useGetRecommendation,
  usePostRecommendationAudit,
} from './recommendationApi';
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
  // Mode, the Status filter, and the Epic filter are per-session UI state
  // only — not persisted, matching the design wireframe's own note
  // (screen-priority-desk-now.d2).
  const [mode, setMode] = useState<Mode>('now');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [epicFilter, setEpicFilter] = useState<string | null>(null);

  const { byRank, isLoading: nowLoading } = useWorkspaceFocusRankHolders();
  const {
    candidates, isLoading: candidatesLoading, isError: candidatesError, epicOptions,
  } = useChooseNextCandidates(statusFilter, epicFilter);
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
        <MasterPlanDiagnosticBanner />

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
            epicFilter={epicFilter}
            epicOptions={epicOptions}
            onEpicFilterChange={setEpicFilter}
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

  // Only a cleanly 'loaded' Master Plan contributes an outcome label — a
  // missing article, a discovery problem, or an Epic with a conflicting
  // (>1 outcome) association all fall through to "no outcome shown", never
  // a guess. Every non-'found' case is already covered by the persistent
  // diagnostic banner above, including the conflict case itself.
  const { data: masterPlan } = useMasterPlan();
  const outcomes = masterPlan?.kind === 'loaded' ? masterPlan.outcomes : [];
  const epicOutcome = issue.parentEpic
    ? resolveEpicOutcome(outcomes, issue.parentEpic.idReadable)
    : { kind: 'none' as const };

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
      {issue.parentEpic && (
        <Text type="text2" className={styles.cardEpic} data-testid={`priority-desk-card-epic-${issue.id}`}>
          {/* The Epic identifier is always the native YouTrack idReadable —
              never anything read from the Master Plan article, which is only
              ever a lookup key (VERM-7 review correction, 2026-09-16). */}
          Epic: <span className={styles.cardEpicId}>{issue.parentEpic.idReadable}</span> {issue.parentEpic.summary}
        </Text>
      )}
      {issue.parentEpic && epicOutcome.kind === 'found' && (
        <Text type="text2" className={styles.cardOutcome} data-testid={`priority-desk-card-outcome-${issue.id}`}>
          Outcome: <span className={styles.cardOutcomeName}>{epicOutcome.outcome.name}</span>
        </Text>
      )}

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
  candidates, isLoading, isError, statusFilter, onStatusFilterChange,
  epicFilter, epicOptions, onEpicFilterChange, projectNameFor, onSelectIssue,
}: {
  candidates: Candidate[];
  isLoading: boolean;
  isError: boolean;
  statusFilter: string | null;
  onStatusFilterChange: (v: string | null) => void;
  epicFilter: string | null;
  epicOptions: ParentEpic[];
  onEpicFilterChange: (v: string | null) => void;
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
      {epicOptions.length > 0 && (
        <EpicFilter value={epicFilter} options={epicOptions} onChange={onEpicFilterChange} />
      )}

      {!isLoading && !isError && (
        <AskForRecommendation candidates={candidates} />
      )}

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

// ─── Ask for recommendation (VERM-8) ───────────────────────────────────────
// docs/requirements.md § Priority Desk "Ask for recommendation". Outcome
// selection is mandatory before the button is enabled — no outcome means no
// context to reason against. Never writes a field itself: the three
// confirmation actions below are the only paths that do, and each does
// exactly what it documents (PLAN.md "Confirmation actions and field
// writes"). If the Claude API key is not configured, the button stays
// disabled with an explanatory title rather than attempting (and failing) a
// call — the rest of Choose next is completely unaffected.

function AskForRecommendation({ candidates }: { candidates: Candidate[] }) {
  const { data: masterPlan } = useMasterPlan();
  const { data: credStatus } = useCredentialStatus();
  const outcomes = masterPlan?.kind === 'loaded' ? masterPlan.outcomes : [];

  const [selectedOutcomeName, setSelectedOutcomeName] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<RecommendationResult | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const getRecommendation = useGetRecommendation();

  const selectedOutcome = outcomes.find((o) => o.name === selectedOutcomeName) ?? null;
  const hasClaudeKey = credStatus?.hasClaudeKey ?? false;
  const disabled =
    !selectedOutcome || candidates.length === 0 || !hasClaudeKey || getRecommendation.isPending;

  function disabledReason(): string | undefined {
    if (candidates.length === 0) return 'No eligible candidates to evaluate.';
    if (!hasClaudeKey) return 'Configure a Claude API key in Settings to use this.';
    if (!selectedOutcome) return 'Select a Master Plan outcome first.';
    return undefined;
  }

  async function handleAsk() {
    if (!selectedOutcome) return;
    setRequestError(null);
    setRecommendation(null);
    const candidateContext = buildCandidateContext(candidates, outcomes, selectedOutcome);
    const issueIds = candidates.map((c) => c.issue.id);
    try {
      const res = await getRecommendation.mutateAsync({ issueIds, candidateContext, outcome: selectedOutcome });
      if (!res.ok || !res.result) {
        setRequestError(res.error ?? 'Recommendation request failed.');
        return;
      }
      setRecommendation(res.result);
    } catch (e) {
      setRequestError(e instanceof Error ? e.message : 'Recommendation request failed.');
    }
  }

  function handleOutcomeChange(name: string | null) {
    setSelectedOutcomeName(name);
    setRecommendation(null);
    setRequestError(null);
  }

  return (
    <div className={styles.recommendationSection} data-testid="priority-desk-recommendation-section">
      {outcomes.length > 0 && (
        <OutcomeSelector value={selectedOutcomeName} outcomes={outcomes} onChange={handleOutcomeChange} />
      )}

      <div className={styles.recommendationAskRow} title={disabledReason()}>
        <Button
          size="small"
          kind="secondary"
          disabled={disabled}
          loading={getRecommendation.isPending}
          onClick={() => { void handleAsk(); }}
          data-testid="priority-desk-ask-recommendation"
        >
          Ask for recommendation
        </Button>
      </div>

      {requestError && (
        <div data-testid="priority-desk-recommendation-error">
          <AttentionBox type="negative" title="Recommendation failed" text={requestError} />
        </div>
      )}

      {recommendation && (
        <RecommendationPanel
          result={recommendation}
          candidates={candidates}
          onDismiss={() => setRecommendation(null)}
        />
      )}
    </div>
  );
}

function OutcomeSelector({
  value, outcomes, onChange,
}: {
  value: string | null;
  outcomes: Outcome[];
  onChange: (v: string | null) => void;
}) {
  return (
    <div className={styles.statusFilter} data-testid="priority-desk-outcome-selector">
      {outcomes.map((outcome) => (
        <button
          key={outcome.name}
          type="button"
          data-testid="priority-desk-outcome-pill"
          data-value={outcome.name}
          className={`${styles.filterPill} ${value === outcome.name ? styles.filterPillActive : ''}`}
          onClick={() => onChange(value === outcome.name ? null : outcome.name)}
        >
          {outcome.name}
        </button>
      ))}
    </div>
  );
}

function RecommendationPanel({
  result, candidates, onDismiss,
}: {
  result: RecommendationResult;
  candidates: Candidate[];
  onDismiss: () => void;
}) {
  const { byRank } = useWorkspaceFocusRankHolders();
  const { toggleFocus, setRank } = useFocusMutations();
  const postAudit = usePostRecommendationAudit();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function projectShortNameFor(issueId: string): string {
    return candidates.find((c) => c.issue.id === issueId)?.projectShortName ?? '';
  }
  function currentlyFocused(issueId: string): boolean {
    return candidates.find((c) => c.issue.id === issueId)?.issue.fields.focus === 'Yes';
  }

  async function confirmChoice(action: ConfirmationAction) {
    const res = await postAudit.mutateAsync({ result, action });
    if (!res.ok) {
      setActionError(res.error ?? 'Failed to record the audit comment.');
      return;
    }
    setActionError(null);
    onDismiss();
  }

  async function handleApplyToDesk() {
    if (result.kind !== 'ranked') return;
    setActionError(null);
    setBusy(true);
    try {
      // Refuse-not-resolve (PLAN.md "Trims"): if any of the top three's
      // target rank is already held by a *different* issue, the whole
      // action is refused with a message rather than silently displacing
      // the existing holder or reimplementing the conflict dialog inline.
      const conflicts = result.ranked.slice(0, 3).flatMap((item, i) => {
        const rank = (i + 1) as FocusRank;
        const decision = decideRankAssignment(byRank, rank, item.issueId);
        if (decision.kind === 'direct') return [];
        const holder = decision.kind === 'confirm' ? decision.holder : decision.holders[0];
        return [{ rank, holder }];
      });
      if (conflicts.length > 0) {
        setActionError(
          `Focus rank ${conflicts.map((c) => c.rank).join(', ')} is already held by another issue ` +
          `(${conflicts.map((c) => c.holder.issue.idReadable).join(', ')}) — resolve it from the board ` +
          'or Now mode first, then try again.',
        );
        return;
      }
      const writes = planConfirmationWrites(result.ranked, 'apply-to-desk', currentlyFocused);
      for (const write of writes) {
        if (write.kind !== 'setRank') continue;
        await setRank({ issueId: write.issueId, projectShortName: projectShortNameFor(write.issueId) }, write.rank);
      }
      await confirmChoice('apply-to-desk');
    } finally {
      setBusy(false);
    }
  }

  async function handleStarOnly() {
    if (result.kind !== 'ranked') return;
    setActionError(null);
    setBusy(true);
    try {
      const writes = planConfirmationWrites(result.ranked, 'star-only', currentlyFocused);
      for (const write of writes) {
        if (write.kind !== 'toggleFocusOn') continue;
        await toggleFocus(write.issueId, projectShortNameFor(write.issueId), false);
      }
      await confirmChoice('star-only');
    } finally {
      setBusy(false);
    }
  }

  async function handleKeepMyOrder() {
    setActionError(null);
    setBusy(true);
    try {
      await confirmChoice('keep-my-order');
    } finally {
      setBusy(false);
    }
  }

  if (result.kind === 'clarification') {
    return (
      <div data-testid="priority-desk-recommendation-clarification">
        <AttentionBox type="primary" title="Need more to go on" text={result.question} />
      </div>
    );
  }

  return (
    <div className={styles.recommendationPanel} data-testid="priority-desk-recommendation-panel">
      <Text type="text2" className={styles.recommendationHeading}>Ranked</Text>
      {result.ranked.map((item, i) => (
        <RecommendationRow key={item.issueId} item={item} rank={i + 1} testIdPrefix="priority-desk-recommendation-ranked" />
      ))}

      {result.alternates.length > 0 && (
        <>
          <Text type="text2" className={styles.recommendationHeading}>Alternates</Text>
          {result.alternates.map((item) => (
            <RecommendationRow key={item.issueId} item={item} rank={null} testIdPrefix="priority-desk-recommendation-alternate" />
          ))}
        </>
      )}

      {actionError && (
        <div data-testid="priority-desk-recommendation-action-error">
          <AttentionBox type="negative" title="Couldn't apply" text={actionError} />
        </div>
      )}

      <div className={styles.recommendationActions}>
        <Button size="small" disabled={busy} onClick={() => { void handleApplyToDesk(); }} data-testid="priority-desk-recommendation-apply">
          Apply to desk
        </Button>
        <Button size="small" kind="secondary" disabled={busy} onClick={() => { void handleStarOnly(); }} data-testid="priority-desk-recommendation-star">
          Star only
        </Button>
        <Button size="small" kind="tertiary" disabled={busy} onClick={() => { void handleKeepMyOrder(); }} data-testid="priority-desk-recommendation-keep">
          Keep my order
        </Button>
      </div>
    </div>
  );
}

function RecommendationRow({
  item, rank, testIdPrefix,
}: {
  item: RecommendationItem;
  rank: number | null;
  testIdPrefix: string;
}) {
  return (
    <div className={styles.recommendationRow} data-testid={`${testIdPrefix}-${item.issueId}`}>
      <Text type="text1" weight="bold">
        {rank !== null ? `${rank}. ` : ''}{item.idReadable} — {item.summary}
      </Text>
      <Text type="text2" className={styles.recommendationEvidence}>Outcome: {item.evidence.outcomeContribution}</Text>
      <Text type="text2" className={styles.recommendationEvidence}>Dependencies: {item.evidence.dependencyReadiness}</Text>
      <Text type="text2" className={styles.recommendationEvidence}>Urgency: {item.evidence.urgency}</Text>
      <Text type="text2" className={styles.recommendationEvidence}>Effort: {item.evidence.effort}</Text>
      <Text type="text2" className={styles.recommendationEvidence}>Risk: {item.evidence.risk}</Text>
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

// ─── Epic filter ────────────────────────────────────────────────────────────
// Single-select, same shape as StatusFilter above, conjunctive with it
// (docs/requirements.md § Priority Desk, "Choose-next eligibility"). Options
// come from useChooseNextCandidates' epicOptions — derived from native Epic
// links already present in the fetched issue set, never hard-coded — so the
// filter renders nothing at all when no issue in the workspace has a
// resolvable parent Epic yet.

function EpicFilter({
  value, options, onChange,
}: {
  value: string | null;
  options: ParentEpic[];
  onChange: (v: string | null) => void;
}) {
  return (
    <div className={styles.statusFilter} data-testid="priority-desk-epic-filter">
      <button
        type="button"
        data-testid="priority-desk-epic-pill"
        data-value=""
        className={`${styles.filterPill} ${value === null ? styles.filterPillActive : ''}`}
        onClick={() => onChange(null)}
      >
        All epics
      </button>
      {options.map((epic) => (
        <button
          key={epic.id}
          type="button"
          data-testid="priority-desk-epic-pill"
          data-value={epic.id}
          className={`${styles.filterPill} ${value === epic.id ? styles.filterPillActive : ''}`}
          onClick={() => onChange(value === epic.id ? null : epic.id)}
        >
          {epic.idReadable}
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
