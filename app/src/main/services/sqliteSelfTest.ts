// SQLite compatibility self-test (ADR-0011).
//
// Proves that Node's built-in `node:sqlite` works inside the running process —
// in particular inside the packaged Electron app, where the RunAsNode fuse is
// off and the main bundle is built by Vite. It exercises exactly the features
// the Runway metadata store depends on: opening a file database, the
// application_id / user_version pragmas, a unique index, the online backup API
// used for export snapshots, and a read-only integrity check of the copy.
//
// It only ever touches a fresh temporary directory, never the user's data.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';

/** Arbitrary 32-bit tag used only by this self-test database. */
export const SELFTEST_APPLICATION_ID = 0x564d5354; // "VMST"
const SELFTEST_USER_VERSION = 1;
const ROWS = 3;

export interface SqliteSelfTestResult {
  ok: boolean;
  node: string;
  sqlite: string | undefined;
  platform: string;
  arch: string;
  checks: Record<string, boolean>;
  error?: string;
}

function pragmaValue(db: DatabaseSync, name: string): unknown {
  const row = db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined;
  return row ? Object.values(row)[0] : undefined;
}

export async function runSqliteSelfTest(): Promise<SqliteSelfTestResult> {
  const checks: Record<string, boolean> = {};
  const result: SqliteSelfTestResult = {
    ok: false,
    node: process.versions.node,
    sqlite: process.versions.sqlite,
    platform: process.platform,
    arch: process.arch,
    checks,
  };
  const dir = mkdtempSync(join(tmpdir(), 'vermilian-sqlite-selftest-'));
  let source: DatabaseSync | undefined;
  let copy: DatabaseSync | undefined;
  try {
    source = new DatabaseSync(join(dir, 'source.db'));
    source.exec(`PRAGMA application_id = ${SELFTEST_APPLICATION_ID}`);
    source.exec(`PRAGMA user_version = ${SELFTEST_USER_VERSION}`);
    source.exec(
      'CREATE TABLE runway (workspace_id TEXT NOT NULL, issue_id TEXT NOT NULL, ' +
        'focus_rank INTEGER, PRIMARY KEY (workspace_id, issue_id))',
    );
    source.exec(
      'CREATE UNIQUE INDEX runway_rank ON runway (workspace_id, focus_rank) ' +
        'WHERE focus_rank IS NOT NULL',
    );
    const insert = source.prepare('INSERT INTO runway VALUES (?, ?, ?)');
    for (let i = 1; i <= ROWS; i++) insert.run('ws-a', `jira:DEMO-${i}`, i);
    checks.write = true;

    try {
      insert.run('ws-a', 'jira:DEMO-99', 1);
      checks.uniqueRankEnforced = false;
    } catch {
      checks.uniqueRankEnforced = true;
    }

    const copyPath = join(dir, 'snapshot.db');
    const pages = await backup(source, copyPath);
    checks.backup = pages > 0;

    copy = new DatabaseSync(copyPath, { readOnly: true });
    checks.integrity = pragmaValue(copy, 'integrity_check') === 'ok';
    checks.applicationId = pragmaValue(copy, 'application_id') === SELFTEST_APPLICATION_ID;
    checks.userVersion = pragmaValue(copy, 'user_version') === SELFTEST_USER_VERSION;
    const count = copy.prepare('SELECT COUNT(*) AS n FROM runway').get() as { n: number };
    checks.rowCount = count.n === ROWS;

    result.ok = Object.values(checks).every(Boolean);
  } catch (err) {
    result.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  } finally {
    copy?.close();
    source?.close();
    rmSync(dir, { recursive: true, force: true });
  }
  return result;
}
