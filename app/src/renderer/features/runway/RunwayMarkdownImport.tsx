// The Markdown import preview (VERM-102), opened from the Runway header's
// Import from Markdown… once a file has been chosen. It shows each proposed
// workspace with its numbered tickets, sections, notes and References, and
// writes nothing. Apply is VERM-104.
//
// Nothing is mapped or checked until the workspace list has been read; a
// failed read offers Retry. Each group is then checked on its own connection
// (runwayImportMatch, VERM-101). An ambiguous heading waits for a choice.
//
// Corrections (VERM-103), kept in memory until Cancel: rename a proposed new
// workspace (an existing workspace's name is read-only), map to an existing
// workspace or New workspace, Check tickets using, merge into another group,
// split a top-level ### into its own workspace, skip and include again, and
// tick a matched Reference to schedule it. Undo reverses the last edit and
// Reset restores the preview as first opened. The rules are in
// importCorrections.ts and importPreview.ts (unit-tested).
//
// Apply (VERM-104) is offered once every included group is ready
// (importApply.ts): the main process verifies the tickets again, backs up the
// Runway database, creates the new workspaces and fills their empty Runways.
// A group it sends back is shown with the reason (and rechecked when its
// tickets changed); after success the dialog closes and the current workspace
// stays active.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { AttentionBox, Button, Modal, ModalBasicLayout, ModalContent, ModalHeader, Text } from '@vibe/core';
import { parseRunwaySchedule, type ScheduleReferenceCue, type ScheduleReferenceReason } from '../../../shared/runwaySchedule';
import {
  type GroupCheck,
  type ImportWorkspaceList,
  type ImportWorkspaceOption,
  workspaceOptionLabels,
  type PreviewReference,
  type PreviewRow,
} from './importPreview';
import {
  createImportSession,
  displayName,
  groupCandidates,
  groupPreview,
  MAX_GROUP_NAME,
  nameCollisions,
  nameProblem,
  type Correction,
  type ImportSession,
  type ImportSessionState,
  type WorkingGroup,
} from './importCorrections';
import type { RunwayImportApplyResult } from '../../../shared/runwayImport';
import { appliedSummary, applyBlockers, applyPlan, BLOCKER_MESSAGE, canApply, destinationOf, type ApplyBlocker } from './importApply';
import { RUNWAY_ITEMS_QUERY_KEY } from './api';
import { ACTIVE_WORKSPACE_QUERY_KEY, WORKSPACE_CONFIG_QUERY_KEY } from '../workspace-nav/api';
import { useToastStore } from '../../stores/toast';
import modalLayout from '../../components/ModalLayout.module.css';
import styles from './RunwayMarkdownImport.module.css';

export interface RunwayMarkdownImportProps {
  fileName: string;
  text: string;
  activeWorkspaceId: string;
  /** The workspace list as read now; the first list read is the one used. */
  workspaces: ImportWorkspaceList;
  /** Reads the workspace list again after a failure. */
  onRetryWorkspaces(): void;
  onClose(): void;
}

const REASON: Record<ScheduleReferenceReason, string> = {
  prose: 'In prose',
  heading: 'In a heading',
  nested: 'In a nested bullet',
  table: 'In a table',
  code: 'In code',
  trailing: 'Later on a scheduled line',
  duplicate: 'Repeated',
};

const CUE: Record<ScheduleReferenceCue, string> = { see: 'after “see”', 'moved to': 'after “moved to”', 'replaced by': 'after “replaced by”' };

/** The Workspace selector's value for a proposed new workspace. */
const NEW = '__new__';

export function RunwayMarkdownImport({ fileName, text, activeWorkspaceId, workspaces, onRetryWorkspaces, onClose }: RunwayMarkdownImportProps) {
  const parsed = useMemo(() => parseRunwaySchedule(text), [text]);
  const session = useRef<ImportSession | null>(null);
  const [state, setState] = useState<ImportSessionState | null>(null);

  useEffect(() => {
    const s = createImportSession(parsed, activeWorkspaceId, (args) => window.vermilian.runwayImportMatch(args), setState);
    session.current = s;
    setState(s.state());
    return () => {
      s.dispose();
      session.current = null;
    };
  }, [parsed, activeWorkspaceId]);

  // The list is handed to the session as it is read; it keeps the first one.
  // Declared after the session effect, so it runs once the session exists,
  // and again for a new session.
  useEffect(() => {
    session.current?.setWorkspaces(workspaces);
  }, [workspaces, parsed, activeWorkspaceId]);

  const list = state?.workspaces ?? { state: 'loading' as const };
  const groups = state?.groups ?? null;
  const options = list.state === 'ready' ? list.workspaces : [];
  const edits = state?.corrections.length ?? 0;
  const apply = (c: Correction) => session.current?.apply(c) ?? false;

  // Apply (VERM-104).
  const queryClient = useQueryClient();
  const showToast = useToastStore((t) => t.show);
  const [applying, setApplying] = useState(false);
  const [problems, setProblems] = useState<Record<string, string[]>>({});
  const [applyError, setApplyError] = useState<Exclude<RunwayImportApplyResult, { ok: true }> | null>(null);
  // Problems from the last Apply are cleared by the next edit.
  useEffect(() => setProblems({}), [edits]);
  const destinations = useMemo(
    () => [...new Set((groups ?? []).filter((g) => !g.skipped).flatMap((g) => destinationOf(g) ?? []))].sort(),
    [groups],
  );
  const runwayLists = useQueries({
    queries: destinations.map((id) => ({
      queryKey: RUNWAY_ITEMS_QUERY_KEY(id),
      queryFn: () => window.vermilian.runwayItemsList({ workspaceId: id }),
    })),
  });
  const runwayRows: Record<string, number | undefined> = {};
  destinations.forEach((id, i) => {
    const data = runwayLists[i]?.data;
    runwayRows[id] = data?.ok ? data.items.length : undefined;
  });
  const blockers = groups && state ? applyBlockers(groups, state.checks, options, runwayRows) : {};
  const ready = Boolean(groups && canApply(groups, blockers));

  async function runApply() {
    if (!groups || !state) return;
    const plan = applyPlan(groups, state.checks);
    if (!plan) return;
    setApplying(true);
    setApplyError(null);
    setProblems({});
    try {
      const result = await window.vermilian.runwayMarkdownApply(plan);
      if (result.ok) {
        await queryClient.invalidateQueries({ queryKey: WORKSPACE_CONFIG_QUERY_KEY });
        await queryClient.invalidateQueries({ queryKey: ACTIVE_WORKSPACE_QUERY_KEY });
        for (const w of result.workspaces) await queryClient.invalidateQueries({ queryKey: RUNWAY_ITEMS_QUERY_KEY(w.workspaceId) });
        showToast('positive', `${appliedSummary(result.workspaces)} Backup: ${result.backupPath}`, 8000);
        onClose();
        return;
      }
      const byGroup: Record<string, string[]> = {};
      for (const p of result.problems) {
        byGroup[p.groupKey] = [...(byGroup[p.groupKey] ?? []), p.message];
        // Changed tickets are read again, so the preview shows the new order before another Apply.
        if (p.reason === 'tickets-changed' || p.reason === 'check-failed') session.current?.retry(p.groupKey);
      }
      for (const id of destinations) await queryClient.invalidateQueries({ queryKey: RUNWAY_ITEMS_QUERY_KEY(id) });
      setProblems(byGroup);
      if (result.code !== 'review' || result.remaining.length > 0) setApplyError(result);
    } catch (err) {
      setApplyError({ ok: false, code: 'write-failed', error: err instanceof Error ? err.message : String(err), problems: [], backupPath: null, remaining: [] });
    } finally {
      setApplying(false);
    }
  }

  return (
    <Modal id="runway-markdown-import" data-testid="runway-markdown-import" show onClose={onClose} size="large">
      <ModalBasicLayout className={modalLayout.layout}>
        <ModalHeader title={`Import preview — ${fileName}`} />
        <ModalContent>
          <div className={styles.body}>
            <Text type="text2" className={styles.lead}>
              Each <code>##</code> heading proposes a workspace. Scheduled tickets are numbered in order; other ticket
              mentions are listed under References. Correct the grouping here; nothing has been written.
            </Text>
            {list.state === 'loading' && (
              <Text type="text2" className={styles.status} data-testid="import-workspaces-loading">
                Reading your workspaces…
              </Text>
            )}
            {list.state === 'failed' && (
              <div className={styles.failure} data-testid="import-workspaces-error">
                <AttentionBox
                  className={modalLayout.attention}
                  type="warning"
                  title="Your workspaces could not be read"
                  text={`${list.error} The headings cannot be matched to workspaces, and no tickets are checked, until they are.`}
                />
                <Button size="small" kind="tertiary" onClick={onRetryWorkspaces} data-testid="import-workspaces-retry">
                  Retry
                </Button>
              </div>
            )}
            {groups && groups.length === 0 && (
              <Text type="text1" className={styles.empty} data-testid="import-empty">
                This file has no headings, tickets or notes to import.
              </Text>
            )}
            {groups?.map((g) => (
              <GroupSection
                key={g.groupKey}
                group={g}
                groups={groups}
                workspaces={options}
                check={state?.checks[g.groupKey]}
                apply={apply}
                onRetry={() => session.current?.retry(g.groupKey)}
                blockers={blockers[g.groupKey] ?? []}
                problems={problems[g.groupKey] ?? []}
              />
            ))}
            {applyError && (
              <div className={styles.failure} data-testid="import-apply-error">
                <AttentionBox className={modalLayout.attention} type="negative" title="The import was not applied" text={applyError.error} />
                {applyError.remaining.length > 0 && (
                  <div data-testid="import-apply-remaining">
                    <Text type="text2">These workspaces were created and could not be removed again; remove them by hand:</Text>
                    <ul>
                      {applyError.remaining.map((w) => (
                        <li key={w.workspaceId}>
                          {w.name} ({w.workspaceId})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {applyError.backupPath && (
                  <Text type="text2" data-testid="import-apply-backup">
                    Backup taken before Apply: {applyError.backupPath}
                  </Text>
                )}
              </div>
            )}
            <div className={styles.footer}>
              <Button size="small" kind="tertiary" disabled={edits === 0} onClick={() => session.current?.undo()} data-testid="import-undo">
                Undo
              </Button>
              <Button size="small" kind="tertiary" disabled={edits === 0} onClick={() => session.current?.reset()} data-testid="import-reset">
                Reset
              </Button>
              <Button size="small" kind="secondary" onClick={onClose} disabled={applying} data-testid="import-cancel">
                Cancel
              </Button>
              <Button size="small" kind="primary" onClick={() => void runApply()} disabled={!ready || applying} data-testid="import-apply">
                {applying ? 'Applying…' : 'Apply'}
              </Button>
            </div>
          </div>
        </ModalContent>
      </ModalBasicLayout>
    </Modal>
  );
}

interface GroupSectionProps {
  group: WorkingGroup;
  groups: readonly WorkingGroup[];
  workspaces: readonly ImportWorkspaceOption[];
  check: GroupCheck | undefined;
  apply(c: Correction): boolean;
  onRetry(): void;
  blockers: readonly ApplyBlocker[];
  /** Why the last Apply sent this group back. */
  problems: readonly string[];
}

/** Blockers already shown another way (the choose and checking lines). */
const SHOWN_ELSEWHERE: readonly ApplyBlocker[] = ['waiting', 'checking'];

function GroupSection({ group, groups, workspaces, check, apply, onRetry, blockers, problems }: GroupSectionProps) {
  const labels = useMemo(() => workspaceOptionLabels(workspaces), [workspaces]);
  const results = check?.state === 'done' && check.match.ok ? check.match.candidates : null;
  const preview = useMemo(() => groupPreview(group, results), [group, results]);
  const hasTickets = useMemo(() => groupCandidates(group).candidates.length > 0, [group]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const failure =
    check?.state === 'failed'
      ? { error: check.error, retryable: check.retryable }
      : check?.state === 'done' && !check.match.ok
        ? { error: check.match.error, retryable: check.match.retryable }
        : null;
  const waiting = group.connectionId === null;
  const checking = !waiting && (!check || check.state === 'pending');
  const title = displayName(group);
  const key = group.groupKey;
  const collisions = nameCollisions(group, groups, workspaces);
  const mergeTargets = groups.filter((o) => o.groupKey !== key && !o.skipped);
  const renameProblem = renaming === null ? null : nameProblem(renaming);

  if (group.skipped) {
    return (
      <section className={`${styles.group} ${styles.skipped}`} data-testid="import-group" data-group-key={key} data-skipped="true">
        <div className={styles.groupHeader}>
          <h3 className={styles.groupName} data-testid="import-group-name">
            {title}
          </h3>
          <span className={styles.tag}>Skipped</span>
          <Button size="small" kind="tertiary" onClick={() => apply({ op: 'skip', groupKey: key, skipped: false })} data-testid="import-include">
            Include again
          </Button>
        </div>
      </section>
    );
  }

  const workspaceValue =
    group.target.kind === 'existing' ? group.target.workspaceId : group.target.kind === 'active' ? group.target.workspaceId : group.target.kind === 'new' ? NEW : '';

  return (
    <section className={styles.group} data-testid="import-group" data-group-key={key}>
      <div className={styles.groupHeader}>
        {renaming === null ? (
          <h3 className={styles.groupName} data-testid="import-group-name">
            {title}
          </h3>
        ) : (
          <form
            className={styles.rename}
            onSubmit={(e) => {
              e.preventDefault();
              if (renameProblem === null && (apply({ op: 'rename', groupKey: key, name: renaming }) || renaming.trim() === group.name)) setRenaming(null);
            }}
          >
            <input
              autoFocus
              aria-label="Workspace name"
              maxLength={MAX_GROUP_NAME + 1}
              value={renaming}
              onChange={(e) => setRenaming(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setRenaming(null);
                }
              }}
              data-testid="import-rename-input"
            />
            <Button size="small" type="submit" disabled={renameProblem !== null} data-testid="import-rename-save">
              Save
            </Button>
            <Button size="small" kind="tertiary" onClick={() => setRenaming(null)} data-testid="import-rename-cancel">
              Cancel
            </Button>
            {renameProblem && (
              <span className={styles.tagWarn} data-testid="import-rename-error">
                {renameProblem}
              </span>
            )}
          </form>
        )}
        <span className={styles.target} data-testid="import-group-target" data-kind={group.target.kind}>
          {targetText(group)}
        </span>
      </div>

      <div className={styles.controls}>
        <label className={styles.connection}>
          <span>Workspace</span>
          <select
            data-testid="import-workspace"
            value={workspaceValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v) apply({ op: 'map', groupKey: key, workspaceId: v === NEW ? null : v });
            }}
          >
            {workspaceValue === '' && (
              <option value="" disabled>
                Choose a workspace…
              </option>
            )}
            <option value={NEW}>New workspace</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {labels.get(w.id) ?? w.name}
              </option>
            ))}
          </select>
        </label>
        {group.chooseConnection && (
          <label className={styles.connection}>
            <span>Check tickets using</span>
            <select
              data-testid="import-connection"
              value={group.connectionId ?? ''}
              onChange={(e) => e.target.value && apply({ op: 'connection', groupKey: key, workspaceId: e.target.value })}
            >
              {group.connectionId === null && (
                <option value="" disabled>
                  Choose a workspace…
                </option>
              )}
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {labels.get(w.id) ?? w.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {group.target.kind === 'new' && renaming === null && (
          <Button size="small" kind="tertiary" onClick={() => setRenaming(group.name ?? '')} data-testid="import-rename">
            Rename…
          </Button>
        )}
        {mergeTargets.length > 0 && (
          <label className={styles.connection}>
            <span className={styles.visuallyHidden}>Merge into another workspace</span>
            <select
              data-testid="import-merge"
              value=""
              onChange={(e) => e.target.value && apply({ op: 'merge', source: key, target: e.target.value })}
            >
              <option value="" disabled>
                Merge into…
              </option>
              {mergeTargets.map((o) => (
                <option key={o.groupKey} value={o.groupKey}>
                  {displayName(o)} (line {o.line})
                </option>
              ))}
            </select>
          </label>
        )}
        <Button size="small" kind="tertiary" onClick={() => apply({ op: 'skip', groupKey: key, skipped: true })} data-testid="import-skip">
          Skip
        </Button>
      </div>

      {group.target.kind === 'new' && group.name === null && renaming === null && (
        <Text type="text2" className={styles.status} data-testid="import-needs-name">
          This new workspace needs a name: choose Rename…
        </Text>
      )}
      {(collisions.workspaces.length > 0 || collisions.groups.length > 0) && (
        <div className={styles.collision} data-testid="import-name-collision">
          <Text type="text2">This name is already used.</Text>
          {collisions.workspaces.map((w) => (
            <Button key={w.id} size="small" kind="tertiary" onClick={() => apply({ op: 'map', groupKey: key, workspaceId: w.id })} data-testid="import-collision-map">
              Map to {labels.get(w.id) ?? w.name}
            </Button>
          ))}
          {collisions.groups.map((o) => (
            <Button key={o.groupKey} size="small" kind="tertiary" onClick={() => apply({ op: 'merge', source: key, target: o.groupKey })} data-testid="import-collision-merge">
              Merge into {displayName(o)} (line {o.line})
            </Button>
          ))}
        </div>
      )}

      {problems.length > 0 && (
        <div className={styles.failure} data-testid="import-group-problem">
          {problems.map((m) => (
            <AttentionBox key={m} className={modalLayout.attention} type="warning" text={m} />
          ))}
        </div>
      )}
      {blockers
        .filter((b) => !SHOWN_ELSEWHERE.includes(b))
        .map((b) => (
          <Text key={b} type="text2" className={styles.tagWarn} data-testid="import-group-blocker" data-reason={b}>
            {BLOCKER_MESSAGE[b]}
          </Text>
        ))}
      {hasTickets && waiting && (
        <Text type="text2" className={styles.status} data-testid="import-group-choose">
          Choose a workspace to check these tickets.
        </Text>
      )}
      {hasTickets && checking && (
        <Text type="text2" className={styles.status} data-testid="import-group-checking">
          Checking tickets…
        </Text>
      )}
      {failure && (
        <div className={styles.failure} data-testid="import-group-error">
          <AttentionBox className={modalLayout.attention} type="warning" title="The tickets could not be checked" text={`${failure.error} The outline below is unchanged.`} />
          {failure.retryable && (
            <Button size="small" kind="tertiary" onClick={onRetry} data-testid="import-group-retry">
              Retry
            </Button>
          )}
        </div>
      )}

      <ol className={styles.rows} data-testid="import-rows">
        {preview.rows.length === 0 && <li className={styles.muted}>No tickets, sections or notes under this heading.</li>}
        {preview.rows.map((row) => (
          <RowItem
            key={`${row.line}-${row.kind}-${row.kind === 'ticket' ? (row.refId ?? '') : ''}`}
            row={row}
            onSplit={(segment, line) => apply({ op: 'split', groupKey: key, segment, line })}
          />
        ))}
      </ol>

      {preview.references.length > 0 && (
        <div className={styles.references} data-testid="import-references">
          <h4 className={styles.referencesTitle}>References</h4>
          <ul>
            {preview.references.map((r, i) => (
              <ReferenceItem
                key={r.id ?? `dup-${r.line}-${i}`}
                reference={r}
                onTick={(ticked) => r.id && apply({ op: 'tick', groupKey: key, refId: r.id, ticked })}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function targetText(group: WorkingGroup): string {
  switch (group.target.kind) {
    case 'existing':
      return 'Existing workspace';
    case 'active':
      return 'Active workspace';
    case 'new':
      return 'New workspace';
    case 'unassigned':
      return 'No active workspace';
    case 'ambiguous':
      return `Matches ${group.target.workspaceNames.length} workspaces (${group.target.workspaceNames.map((n) => n.trim()).join(', ')}); choose one`;
  }
}

function checkboxText(box: string | null): string | null {
  if (box === null) return null;
  return box === ' ' ? '[ ]' : `[${box}]`;
}

function RowItem({ row, onSplit }: { row: PreviewRow; onSplit(segment: number, line: number): void }) {
  const common = { 'data-testid': 'import-row', 'data-kind': row.kind, 'data-line': row.line } as const;
  switch (row.kind) {
    case 'ticket':
      return (
        <li {...common} className={styles.ticket} data-key={row.key} data-ticked={row.refId ? 'true' : undefined}>
          <span className={styles.number} data-testid="import-row-number">
            #{row.number}
          </span>
          {row.checkbox !== null && <span className={styles.box}>{checkboxText(row.checkbox)}</span>}
          <span className={styles.key}>{row.key}</span>
          <span className={styles.summary}>{row.summary}</span>
          {row.titleHint && row.titleHint !== row.summary && <span className={styles.hint}>— {row.titleHint}</span>}
          {row.refId && <span className={styles.tag}>From a reference, line {row.line}</span>}
        </li>
      );
    case 'unchecked':
      return (
        <li {...common} className={styles.ticket}>
          <span className={styles.number}>#?</span>
          {row.checkbox !== null && <span className={styles.box}>{checkboxText(row.checkbox)}</span>}
          <span className={styles.key}>{row.text}</span>
          {row.titleHint && <span className={styles.hint}>— {row.titleHint}</span>}
          <span className={styles.tag}>Not checked</span>
        </li>
      );
    case 'unmatched':
      return (
        <li {...common} className={styles.note}>
          <span className={styles.noteText}>
            {row.text}
            {row.titleHint ? ` ${row.titleHint}` : ''}
          </span>
          <span className={styles.tagWarn} data-testid="import-row-unmatched">
            Unmatched, kept as a note: {row.message}
          </span>
        </li>
      );
    case 'duplicate':
      return (
        <li {...common} className={styles.note}>
          <span className={styles.noteText}>
            {row.text}
            {row.titleHint ? ` ${row.titleHint}` : ''}
          </span>
          <span className={styles.tag}>Already scheduled{row.ofNumber !== null ? ` as #${row.ofNumber}` : ''}</span>
        </li>
      );
    case 'section':
      return (
        <li {...common} className={styles.section} style={{ paddingLeft: row.depth * 16 }} data-join={row.join ? 'true' : undefined}>
          <span data-testid="import-section-text">{row.text}</span>
          {row.join && <span className={styles.tag}>Merged heading</span>}
          {row.splittable && (
            <Button size="xs" kind="tertiary" onClick={() => onSplit(row.segment, row.line)} data-testid="import-split">
              Make its own workspace
            </Button>
          )}
        </li>
      );
    case 'note':
      return (
        <li {...common} className={styles.note} style={{ paddingLeft: row.depth * 16 }}>
          <span className={styles.noteText}>{row.text}</span>
        </li>
      );
  }
}

function ReferenceItem({ reference: r, onTick }: { reference: PreviewReference; onTick(ticked: boolean): void }) {
  const why = `${REASON[r.reason]}${r.cue ? `, ${CUE[r.cue]}` : ''}`;
  let result: string;
  switch (r.status) {
    case 'unchecked':
      result = 'Not checked';
      break;
    case 'matched':
      result =
        r.scheduledAs !== null
          ? `Scheduled as #${r.scheduledAs}: ${r.key} — ${r.summary}`
          : r.alreadyAs !== null
            ? `Already scheduled as #${r.alreadyAs}: ${r.key}`
            : `${r.key} — ${r.summary}`;
      break;
    case 'unmatched':
      result = `Unmatched: ${r.message}`;
      break;
    case 'duplicate':
      result = r.ofNumber !== null ? `Already scheduled as #${r.ofNumber}` : 'Already scheduled';
      break;
  }
  return (
    <li className={styles.reference} data-testid="import-reference" data-line={r.line} data-status={r.status} data-text={r.text}>
      <input
        type="checkbox"
        checked={r.ticked}
        disabled={!r.tickable}
        onChange={(e) => onTick(e.target.checked)}
        aria-label={`Schedule ${r.text} from line ${r.line}`}
        data-testid="import-reference-tick"
      />
      <span className={styles.key}>{r.text}</span>
      <span className={styles.muted}>line {r.line}</span>
      <span className={styles.muted}>{why}</span>
      <span className={r.status === 'unmatched' ? styles.tagWarn : styles.summary}>{result}</span>
    </li>
  );
}
