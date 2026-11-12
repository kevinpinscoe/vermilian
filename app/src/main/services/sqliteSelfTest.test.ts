import { describe, expect, it } from 'vitest';
import { runSqliteSelfTest } from './sqliteSelfTest';

describe('runSqliteSelfTest', () => {
  it('passes every check under the Node runtime used for tests', async () => {
    const result = await runSqliteSelfTest();
    expect(result.error).toBeUndefined();
    expect(result.checks).toEqual({
      write: true,
      uniqueRankEnforced: true,
      backup: true,
      integrity: true,
      applicationId: true,
      userVersion: true,
      rowCount: true,
    });
    expect(result.ok).toBe(true);
    expect(result.sqlite).toMatch(/^3\./);
  });
});
