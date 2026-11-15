import { describe, expect, it } from 'vitest';
import type { RunwayImportPreview } from '../../../shared/ipc';
import { importPreviewRows, importSuccessMessage } from './runwayImport';

const preview: RunwayImportPreview = {
  token: 't',
  fileName: 'snap.sqlite',
  path: '/home/user/Documents/snap.sqlite',
  fileModifiedAt: '2026-01-05T09:00:00.000Z',
  sizeBytes: 8192,
  schemaVersion: 1,
  snapshotRowCounts: { runway_entry: 4, dismissal: 1 },
  liveRowCounts: { runway_entry: 1, dismissal: 0 },
  backupDir: '/home/user/.config/Vermilian/runway-backups',
};

describe('importPreviewRows', () => {
  const rows = importPreviewRows(preview, (iso) => `T(${iso})`);
  const value = (testId: string) => rows.find((r) => r.testId === testId);

  it('says the export time is not recorded and labels the mtime as file metadata', () => {
    expect(value('runway-import-export-time')?.value).toBe('Not recorded in the snapshot');
    const mtime = value('runway-import-file-mtime');
    expect(mtime?.label).toMatch(/file metadata, not the export time/);
    expect(mtime?.value).toBe('T(2026-01-05T09:00:00.000Z)');
    // The mtime is never presented under an "export" label.
    expect(rows.filter((r) => r.value.includes('2026-01-05')).every((r) => !/^Export/.test(r.label))).toBe(true);
  });

  it('compares snapshot and current counts, with singular forms', () => {
    expect(value('runway-import-snapshot-counts')?.value).toBe('4 entries, 1 dismissal');
    expect(value('runway-import-live-counts')?.value).toBe('1 entry, 0 dismissals');
  });

  it('shows the schema version, file and backup location', () => {
    expect(value('runway-import-schema')?.value).toBe('1');
    expect(value('runway-import-file')?.value).toBe(preview.path);
    expect(value('runway-import-backup-dir')?.value).toBe(preview.backupDir);
  });
});

describe('importSuccessMessage', () => {
  it('names the counts and the actual backup path', () => {
    expect(
      importSuccessMessage({
        backupPath: '/b/runway-before-import-20260105-093015.sqlite',
        rowCounts: { runway_entry: 4, dismissal: 1 },
        previousRowCounts: { runway_entry: 1, dismissal: 0 },
        prunedBackups: 0,
      }),
    ).toBe('Imported Runway snapshot (4 entries, 1 dismissal). Previous data backed up to /b/runway-before-import-20260105-093015.sqlite');
  });
});
