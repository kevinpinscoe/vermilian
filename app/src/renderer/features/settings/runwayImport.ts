// Pure helpers for the Runway snapshot import (VERM-51, VERM-79) in Settings →
// Advanced. Unit-tested in runwayImport.test.ts; the component renders them.
import type { RunwayImportOutcome, RunwayImportPreview } from '../../../shared/ipc';

export interface PreviewRow {
  label: string;
  value: string;
  testId: string;
}

type FormatTime = (iso: string) => string;
const defaultFormat: FormatTime = (iso) => new Date(iso).toLocaleString();

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function deskCounts(rowCounts: Record<string, number>): string {
  return `${plural(rowCounts.runway_entry ?? 0, 'entry', 'entries')}, ${plural(rowCounts.dismissal ?? 0, 'dismissal', 'dismissals')}`;
}

function orderCount(rowCounts: Record<string, number>): string {
  const n = rowCounts.runway_item ?? 0;
  return n === 0 ? 'Runway order empty' : `Runway order ${plural(n, 'row', 'rows')}`;
}

function counts(rowCounts: Record<string, number>): string {
  return `${deskCounts(rowCounts)}; ${orderCount(rowCounts)}`;
}

const NOT_RECORDED_V1 = 'Not recorded (version 1 snapshot)';
const NOT_RECORDED = 'Not recorded in the snapshot';

/**
 * The facts the confirmation shows. A version 1 snapshot records neither its
 * exporting computer nor its export time, so that is said plainly — never a
 * guess. The file's modification time is shown only as file metadata,
 * because copying a file can change it.
 */
export function importPreviewRows(preview: RunwayImportPreview, formatTime: FormatTime = defaultFormat): PreviewRow[] {
  const v1 = preview.schemaVersion === 1;
  const notRecorded = v1 ? NOT_RECORDED_V1 : NOT_RECORDED;
  return [
    { label: 'File', value: preview.path, testId: 'runway-import-file' },
    {
      label: 'Snapshot version',
      value: v1
        ? 'Version 1 — will be upgraded to version 2 on import. The upgrade happens in the staging copy, never in the live database.'
        : `Version ${preview.schemaVersion}`,
      testId: 'runway-import-schema',
    },
    { label: 'Exported by computer', value: preview.exportedBy ?? notRecorded, testId: 'runway-import-exported-by' },
    {
      label: 'Export time',
      value: preview.exportedAt ? formatTime(preview.exportedAt) : notRecorded,
      testId: 'runway-import-export-time',
    },
    {
      label: 'File last modified (file metadata, not the export time)',
      value: formatTime(preview.fileModifiedAt),
      testId: 'runway-import-file-mtime',
    },
    {
      label: 'Snapshot holds',
      value: v1 ? `${deskCounts(preview.snapshotRowCounts)}; Runway order empty (version 1 has no Runway order)` : counts(preview.snapshotRowCounts),
      testId: 'runway-import-snapshot-counts',
    },
    { label: 'Will replace (current)', value: counts(preview.liveRowCounts), testId: 'runway-import-live-counts' },
    { label: 'Backup of current data first, in', value: preview.backupDir, testId: 'runway-import-backup-dir' },
  ];
}

/** The exact version 1 warning text required by the spec. */
export const CANNOT_TELL_WARNING =
  'This snapshot does not record when it was exported, so Vermilian cannot tell whether this computer has ' +
  'newer Runway changes. Importing replaces all local Runway data.';

type Warning = RunwayImportPreview['warnings'][number];
type Formatter = FormatTime;

// Up to three examples, then "and N more".
function sample(items: string[]): string {
  const shown = items.slice(0, 3).join('; ');
  return items.length > 3 ? `${shown}; and ${items.length - 3} more` : shown;
}

function week(value: string | null): string {
  return value === null ? 'not dismissed' : `dismissed for the week of ${value}`;
}

function warningText(warning: Warning, preview: RunwayImportPreview, formatTime: Formatter): string {
  if (warning.kind === 'cannot-tell') return CANNOT_TELL_WARNING;
  if (warning.kind === 'newer-local-changes') {
    const change = warning.latestLocalChange;
    const what =
      change.table === 'runway_entry'
        ? `the Priority Desk entry for ${change.itemId}`
        : change.kind === 'issue'
          ? `the Runway position of ${change.itemId}`
          : `a Runway ${change.kind}`;
    return (
      `This computer has Runway changes newer than this snapshot. The latest is ${what} in workspace ` +
      `${change.workspaceId}, changed ${formatTime(change.updatedAt)}` +
      (preview.exportedAt ? `, after the snapshot was exported (${formatTime(preview.exportedAt)})` : '') +
      '. Importing replaces all local Runway data, so that change will be lost.'
    );
  }
  const parts: string[] = [];
  if (warning.dismissals.length > 0) {
    parts.push(
      `it would change ${warning.dismissals.length === 1 ? 'a dismissal' : `${warning.dismissals.length} dismissals`} (` +
        sample(
          warning.dismissals.map(
            (d) => `${d.issueId} in workspace ${d.workspaceId}: ${week(d.local)} here, ${week(d.snapshot)} in the snapshot`,
          ),
        ) +
        ')',
    );
  }
  if (warning.restored.length > 0) {
    parts.push(
      `it would restore ${warning.restored.length === 1 ? 'a record' : `${warning.restored.length} records`} not on this computer, ` +
        'perhaps removed here after the export (' +
        sample(
          warning.restored.map((r) =>
            r.table === 'runway_entry'
              ? `the Priority Desk entry for ${r.itemId} in workspace ${r.workspaceId}`
              : r.kind === 'issue'
                ? `Runway ticket ${r.itemId} in workspace ${r.workspaceId}`
                : `a Runway ${r.kind} in workspace ${r.workspaceId}`,
          ),
        ) +
        ')',
    );
  }
  return (
    `Vermilian cannot tell whether this computer's copy or the snapshot's is newer for some records: ` +
    `${parts.join(', and ')}. Importing replaces all local Runway data.`
  );
}

/**
 * The replacement warnings shown before the user can confirm, in order.
 * Empty when the snapshot holds exactly this computer's data.
 */
export function importWarningTexts(preview: RunwayImportPreview, formatTime: FormatTime = defaultFormat): string[] {
  return preview.warnings.map((w) => warningText(w, preview, formatTime));
}

/** The success toast text. */
export function importSuccessMessage(outcome: RunwayImportOutcome): string {
  return `Imported Runway snapshot (${counts(outcome.rowCounts)}). Previous data backed up to ${outcome.backupPath}`;
}
