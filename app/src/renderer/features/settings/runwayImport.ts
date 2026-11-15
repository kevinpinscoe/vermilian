// Pure helpers for the Runway snapshot import (VERM-51) in Settings →
// Advanced. Unit-tested in runwayImport.test.ts; the component renders them.
import type { RunwayImportOutcome, RunwayImportPreview } from '../../../shared/ipc';

export interface PreviewRow {
  label: string;
  value: string;
  testId: string;
}

function counts(rowCounts: Record<string, number>): string {
  const entries = rowCounts.runway_entry ?? 0;
  const dismissals = rowCounts.dismissal ?? 0;
  return `${entries} ${entries === 1 ? 'entry' : 'entries'}, ${dismissals} ${dismissals === 1 ? 'dismissal' : 'dismissals'}`;
}

/**
 * The facts the confirmation shows. The snapshot does not record when it was
 * exported, so that is said plainly; the file's modification time is shown
 * only as file metadata, because copying a file can change it.
 */
export function importPreviewRows(
  preview: RunwayImportPreview,
  formatTime: (iso: string) => string = (iso) => new Date(iso).toLocaleString(),
): PreviewRow[] {
  return [
    { label: 'File', value: preview.path, testId: 'runway-import-file' },
    { label: 'Export time', value: 'Not recorded in the snapshot', testId: 'runway-import-export-time' },
    {
      label: 'File last modified (file metadata, not the export time)',
      value: formatTime(preview.fileModifiedAt),
      testId: 'runway-import-file-mtime',
    },
    { label: 'Schema version', value: String(preview.schemaVersion), testId: 'runway-import-schema' },
    { label: 'Snapshot holds', value: counts(preview.snapshotRowCounts), testId: 'runway-import-snapshot-counts' },
    { label: 'Will replace (current)', value: counts(preview.liveRowCounts), testId: 'runway-import-live-counts' },
    { label: 'Backup of current data first, in', value: preview.backupDir, testId: 'runway-import-backup-dir' },
  ];
}

/** The success toast text. */
export function importSuccessMessage(outcome: RunwayImportOutcome): string {
  return `Imported Runway snapshot (${counts(outcome.rowCounts)}). Previous data backed up to ${outcome.backupPath}`;
}
