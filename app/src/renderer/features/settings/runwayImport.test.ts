import { describe, expect, it } from 'vitest';
import type { RunwayImportPreview } from '../../../shared/ipc';
import { CANNOT_TELL_WARNING, importPreviewRows, importSuccessMessage, importWarningText } from './runwayImport';

const fmt = (iso: string) => `T(${iso})`;

const v1Preview: RunwayImportPreview = {
  token: 't',
  fileName: 'snap.sqlite',
  path: '/home/user/Documents/snap.sqlite',
  fileModifiedAt: '2026-01-05T09:00:00.000Z',
  sizeBytes: 8192,
  schemaVersion: 1,
  exportedBy: null,
  exportedAt: null,
  warning: { kind: 'cannot-tell' },
  snapshotRowCounts: { runway_entry: 4, dismissal: 1, runway_item: 0 },
  liveRowCounts: { runway_entry: 1, dismissal: 0, runway_item: 2 },
  backupDir: '/home/user/.config/Vermilian/runway-backups',
};

const v2Preview: RunwayImportPreview = {
  ...v1Preview,
  schemaVersion: 2,
  exportedBy: 'laptop-example',
  exportedAt: '2026-01-04T18:00:00.000Z',
  warning: null,
  snapshotRowCounts: { runway_entry: 4, dismissal: 1, runway_item: 3 },
};

function rowsOf(preview: RunwayImportPreview) {
  const rows = importPreviewRows(preview, fmt);
  return { rows, value: (testId: string) => rows.find((r) => r.testId === testId) };
}

describe('importPreviewRows: version 1 snapshot', () => {
  const { rows, value } = rowsOf(v1Preview);

  it('says it will be upgraded, in the staging copy and never the live database', () => {
    expect(value('runway-import-schema')?.value).toMatch(/^Version 1 — will be upgraded to version 2 on import\./);
    expect(value('runway-import-schema')?.value).toMatch(/staging copy, never in the live database/);
  });

  it('shows exporting computer and export time as not recorded, never a guess', () => {
    expect(value('runway-import-exported-by')?.value).toBe('Not recorded (version 1 snapshot)');
    expect(value('runway-import-export-time')?.value).toBe('Not recorded (version 1 snapshot)');
    const mtime = value('runway-import-file-mtime');
    expect(mtime?.label).toMatch(/file metadata, not the export time/);
    expect(mtime?.value).toBe('T(2026-01-05T09:00:00.000Z)');
    // The mtime is never presented under an "export" label.
    expect(rows.filter((r) => r.value.includes('2026-01-05')).every((r) => !/^Export/.test(r.label))).toBe(true);
  });

  it('shows the Runway order as empty with Desk counts as before', () => {
    expect(value('runway-import-snapshot-counts')?.value).toBe(
      '4 entries, 1 dismissal; Runway order empty (version 1 has no Runway order)',
    );
    expect(value('runway-import-live-counts')?.value).toBe('1 entry, 0 dismissals; Runway order 2 rows');
  });

  it('shows the cannot-tell warning verbatim', () => {
    expect(importWarningText(v1Preview, fmt)).toBe(
      'This snapshot does not record when it was exported, so Vermilian cannot tell whether this computer has ' +
        'newer Runway changes. Importing replaces all local Runway data.',
    );
    expect(importWarningText(v1Preview, fmt)).toBe(CANNOT_TELL_WARNING);
  });

  it('shows the file and backup location', () => {
    expect(value('runway-import-file')?.value).toBe(v1Preview.path);
    expect(value('runway-import-backup-dir')?.value).toBe(v1Preview.backupDir);
  });
});

describe('importPreviewRows: version 2 snapshot', () => {
  const { value } = rowsOf(v2Preview);

  it('shows the exporting computer, the export time and the Runway order count', () => {
    expect(value('runway-import-schema')?.value).toBe('Version 2');
    expect(value('runway-import-exported-by')?.value).toBe('laptop-example');
    expect(value('runway-import-export-time')?.value).toBe('T(2026-01-04T18:00:00.000Z)');
    expect(value('runway-import-snapshot-counts')?.value).toBe('4 entries, 1 dismissal; Runway order 3 rows');
  });

  it('shows no warning when nothing local is newer', () => {
    expect(importWarningText(v2Preview, fmt)).toBeNull();
  });

  it('names the latest newer local change', () => {
    const text = importWarningText(
      {
        ...v2Preview,
        warning: {
          kind: 'newer-local-changes',
          latestLocalChange: {
            table: 'runway_item',
            workspaceId: 'workspace-default',
            itemId: 'yt:DEMO-7',
            kind: 'issue',
            updatedAt: '2026-01-05T08:00:00.000Z',
          },
        },
      },
      fmt,
    );
    expect(text).toBe(
      'This computer has Runway changes newer than this snapshot. The latest is the Runway position of yt:DEMO-7 ' +
        'in workspace workspace-default, changed T(2026-01-05T08:00:00.000Z), after the snapshot was exported ' +
        '(T(2026-01-04T18:00:00.000Z)). Importing replaces all local Runway data, so that change will be lost.',
    );
  });

  it('names a Desk entry change as such', () => {
    const text = importWarningText(
      {
        ...v2Preview,
        warning: {
          kind: 'newer-local-changes',
          latestLocalChange: {
            table: 'runway_entry',
            workspaceId: 'ws-a',
            itemId: 'jira:DEMO-1',
            kind: 'issue',
            updatedAt: '2026-01-05T08:00:00.000Z',
          },
        },
      },
      fmt,
    );
    expect(text).toMatch(/^This computer has Runway changes newer than this snapshot\. The latest is the Priority Desk entry for jira:DEMO-1 in workspace ws-a/);
  });
});

describe('importSuccessMessage', () => {
  it('names the counts and the actual backup path', () => {
    expect(
      importSuccessMessage({
        backupPath: '/b/runway-before-import-20260105-093015.sqlite',
        rowCounts: { runway_entry: 4, dismissal: 1, runway_item: 3 },
        previousRowCounts: { runway_entry: 1, dismissal: 0, runway_item: 0 },
        prunedBackups: 0,
      }),
    ).toBe(
      'Imported Runway snapshot (4 entries, 1 dismissal; Runway order 3 rows). Previous data backed up to /b/runway-before-import-20260105-093015.sqlite',
    );
  });
});
