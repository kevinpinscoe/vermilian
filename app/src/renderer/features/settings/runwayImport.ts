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

/**
 * The replacement warning shown before the user can confirm, or null. Names
 * the latest local change when this computer has Runway changes newer than
 * the snapshot's export time.
 */
export function importWarningText(preview: RunwayImportPreview, formatTime: FormatTime = defaultFormat): string | null {
  const warning = preview.warning;
  if (!warning) return null;
  if (warning.kind === 'cannot-tell') return CANNOT_TELL_WARNING;
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

/** The success toast text. */
export function importSuccessMessage(outcome: RunwayImportOutcome): string {
  return `Imported Runway snapshot (${counts(outcome.rowCounts)}). Previous data backed up to ${outcome.backupPath}`;
}
