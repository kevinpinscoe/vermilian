// The Markdown import preview (VERM-102), opened from the Runway header's
// Import from Markdown… once a file has been chosen. Read-only: it shows
// each proposed workspace with its numbered tickets, sections, notes and
// References, and writes nothing. Cancel is the only action; Apply is
// VERM-104, and correcting the grouping or ticking a Reference is VERM-103.
//
// Each group is checked on its own connection (runwayImportMatch, VERM-101):
// an existing workspace's own, or for a proposed new or ambiguous one the
// workspace chosen in Check tickets using, which rechecks that group only.
// The latest choice wins, however the answers arrive. A group whose
// connection fails keeps its outline with the tickets unchecked. The rules
// are in importPreview.ts (unit-tested).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AttentionBox, Button, Modal, ModalBasicLayout, ModalContent, ModalHeader, Text } from '@vibe/core';
import { parseRunwaySchedule, type ScheduleReferenceCue, type ScheduleReferenceReason } from '../../../shared/runwaySchedule';
import {
  buildGroupPreview,
  createGroupChecker,
  proposeGroups,
  type GroupCheck,
  type GroupChecker,
  type ImportWorkspaceOption,
  type PreviewReference,
  type PreviewRow,
  type ProposedGroup,
} from './importPreview';
import modalLayout from '../../components/ModalLayout.module.css';
import styles from './RunwayMarkdownImport.module.css';

export interface RunwayMarkdownImportProps {
  fileName: string;
  text: string;
  activeWorkspaceId: string;
  workspaces: readonly ImportWorkspaceOption[];
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

export function RunwayMarkdownImport({ fileName, text, activeWorkspaceId, workspaces, onClose }: RunwayMarkdownImportProps) {
  const parsed = useMemo(() => parseRunwaySchedule(text), [text]);
  const groups = useMemo(() => proposeGroups(parsed, workspaces, activeWorkspaceId), [parsed, workspaces, activeWorkspaceId]);
  const [connections, setConnections] = useState<Record<string, string>>(() => Object.fromEntries(groups.map((g) => [g.groupKey, g.connectionId])));
  const [checks, setChecks] = useState<Record<string, GroupCheck>>({});
  const checker = useRef<GroupChecker | null>(null);

  useEffect(() => {
    const c = createGroupChecker(
      (args) => window.vermilian.runwayImportMatch(args),
      (groupKey, check) => setChecks((prev) => ({ ...prev, [groupKey]: check })),
    );
    checker.current = c;
    for (const g of groups) c.check(g, g.connectionId);
    return () => c.dispose();
  }, [groups]);

  function changeConnection(group: ProposedGroup, connectionId: string) {
    setConnections((prev) => ({ ...prev, [group.groupKey]: connectionId }));
    checker.current?.check(group, connectionId);
  }

  return (
    <Modal id="runway-markdown-import" data-testid="runway-markdown-import" show onClose={onClose} size="large">
      <ModalBasicLayout className={modalLayout.layout}>
        <ModalHeader title={`Import preview — ${fileName}`} />
        <ModalContent>
          <div className={styles.body}>
            <Text type="text2" className={styles.lead}>
              Each <code>##</code> heading proposes a workspace. Scheduled tickets are numbered in file order; other ticket
              mentions are listed under References. Nothing has been written.
            </Text>
            {groups.length === 0 && (
              <Text type="text1" className={styles.empty} data-testid="import-empty">
                This file has no headings, tickets or notes to import.
              </Text>
            )}
            {groups.map((g) => (
              <GroupSection
                key={g.groupKey}
                group={g}
                workspaces={workspaces}
                connectionId={connections[g.groupKey] ?? g.connectionId}
                check={checks[g.groupKey]}
                onConnection={(id) => changeConnection(g, id)}
                onRetry={() => checker.current?.check(g, connections[g.groupKey] ?? g.connectionId)}
              />
            ))}
            <div className={styles.footer}>
              <Button size="small" kind="secondary" onClick={onClose} data-testid="import-cancel">
                Cancel
              </Button>
            </div>
          </div>
        </ModalContent>
      </ModalBasicLayout>
    </Modal>
  );
}

interface GroupSectionProps {
  group: ProposedGroup;
  workspaces: readonly ImportWorkspaceOption[];
  connectionId: string;
  check: GroupCheck | undefined;
  onConnection(id: string): void;
  onRetry(): void;
}

function GroupSection({ group, workspaces, connectionId, check, onConnection, onRetry }: GroupSectionProps) {
  // Only the answer for the connection selected now is shown.
  const current = check && check.connectionId === connectionId ? check : undefined;
  const results = current?.state === 'done' && current.match.ok ? current.match.candidates : null;
  const preview = useMemo(() => buildGroupPreview(group.group, group.candidates, results), [group, results]);
  const failure =
    current?.state === 'failed'
      ? { error: current.error, retryable: current.retryable }
      : current?.state === 'done' && !current.match.ok
        ? { error: current.match.error, retryable: current.match.retryable }
        : null;
  const checking = !current || current.state === 'pending';
  const title = group.name ?? 'Before the first heading';

  return (
    <section className={styles.group} data-testid="import-group" data-group-key={group.groupKey}>
      <div className={styles.groupHeader}>
        <h3 className={styles.groupName} data-testid="import-group-name">
          {title}
        </h3>
        <span className={styles.target} data-testid="import-group-target" data-kind={group.target.kind}>
          {targetText(group)}
        </span>
      </div>
      {group.chooseConnection && (
        <label className={styles.connection}>
          <span>Check tickets using</span>
          <select data-testid="import-connection" value={connectionId} onChange={(e) => onConnection(e.target.value)}>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {group.candidates.length > 0 && checking && (
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
          <RowItem key={`${row.line}-${row.kind}`} row={row} />
        ))}
      </ol>

      {preview.references.length > 0 && (
        <div className={styles.references} data-testid="import-references">
          <h4 className={styles.referencesTitle}>References</h4>
          <ul>
            {preview.references.map((r, i) => (
              <ReferenceItem key={`${r.line}-${i}`} reference={r} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function targetText(group: ProposedGroup): string {
  switch (group.target.kind) {
    case 'existing':
      return `Existing workspace: ${group.target.workspaceName}`;
    case 'active':
      return `Active workspace: ${group.target.workspaceName}`;
    case 'new':
      return 'New workspace';
    case 'ambiguous':
      return `Matches ${group.target.workspaceNames.length} workspaces (${group.target.workspaceNames.map((n) => n.trim()).join(', ')}); to be chosen before Apply`;
  }
}

function checkboxText(box: string | null): string | null {
  if (box === null) return null;
  return box === ' ' ? '[ ]' : `[${box}]`;
}

function RowItem({ row }: { row: PreviewRow }) {
  const common = { 'data-testid': 'import-row', 'data-kind': row.kind, 'data-line': row.line } as const;
  switch (row.kind) {
    case 'ticket':
      return (
        <li {...common} className={styles.ticket} data-key={row.key}>
          <span className={styles.number} data-testid="import-row-number">
            #{row.number}
          </span>
          {row.checkbox !== null && <span className={styles.box}>{checkboxText(row.checkbox)}</span>}
          <span className={styles.key}>{row.key}</span>
          <span className={styles.summary}>{row.summary}</span>
          {row.titleHint && row.titleHint !== row.summary && <span className={styles.hint}>— {row.titleHint}</span>}
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
        <li {...common} className={styles.section} style={{ paddingLeft: row.depth * 16 }}>
          {row.text}
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

function ReferenceItem({ reference: r }: { reference: PreviewReference }) {
  const why = `${REASON[r.reason]}${r.cue ? `, ${CUE[r.cue]}` : ''}`;
  let result: string;
  switch (r.status) {
    case 'unchecked':
      result = 'Not checked';
      break;
    case 'matched':
      result = `${r.key} — ${r.summary}`;
      break;
    case 'unmatched':
      result = `Unmatched: ${r.message}`;
      break;
    case 'duplicate':
      result = r.ofNumber !== null ? `Already scheduled as #${r.ofNumber}` : 'Already scheduled';
      break;
  }
  return (
    <li className={styles.reference} data-testid="import-reference" data-line={r.line} data-status={r.status}>
      {/* Read-only here: ticking a Reference to schedule it is VERM-103. */}
      <input type="checkbox" checked={false} disabled readOnly aria-label={`Schedule ${r.text}`} data-testid="import-reference-tick" />
      <span className={styles.key}>{r.text}</span>
      <span className={styles.muted}>line {r.line}</span>
      <span className={styles.muted}>{why}</span>
      <span className={r.status === 'unmatched' ? styles.tagWarn : styles.summary}>{result}</span>
    </li>
  );
}
