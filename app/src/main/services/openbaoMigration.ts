// Moves a scope's credentials into OpenBao (VERM-64).
//
// Every reference is read from its current source, written, read back and
// compared before anything changes. The scope switches over only after all of
// them verify, in one configuration write, so a failure at any step leaves the
// active backend as it was. The original credentials are never touched here;
// removing them is a separate, confirmed step. Re-running is safe: a location
// already holding the same value is accepted, and one holding a different value
// is refused rather than overwritten.

import {
  OPENBAO_REASON_TEXT,
  type OpenBaoBinding,
  type OpenBaoFailureReason,
  type OpenBaoMigrationResult,
  type OpenBaoResult,
} from '../../shared/openbao';
import type { CredentialRef } from '../../shared/workspaceSchema';

export interface OpenBaoMigrationDeps {
  references: Array<{ credentialRef: CredentialRef; binding: OpenBaoBinding; active: boolean }>;
  /** Reads the credential from its current, non-OpenBao source. */
  readOriginal(ref: CredentialRef): Promise<{ ok: true; value: string } | { ok: false; message: string }>;
  store(binding: OpenBaoBinding, value: string): Promise<OpenBaoResult<'written' | 'unchanged'>>;
  /** Switches the verified references over in one write. */
  activate(verified: Array<{ credentialRef: CredentialRef; binding: OpenBaoBinding }>): Promise<boolean>;
}

export async function migrateToOpenBao(deps: OpenBaoMigrationDeps): Promise<OpenBaoMigrationResult> {
  const report: OpenBaoMigrationResult['references'] = [];
  const verified: Array<{ credentialRef: CredentialRef; binding: OpenBaoBinding }> = [];

  const stop = (index: number, credentialRef: CredentialRef, message: string): OpenBaoMigrationResult => {
    report.push({ credentialRef, step: 'failed', message });
    for (const later of deps.references.slice(index + 1)) {
      report.push({ credentialRef: later.credentialRef, step: 'not-attempted', message: 'Not attempted.' });
    }
    return {
      ok: false,
      activated: false,
      message: 'Migration stopped. The current credential storage is still active and nothing was removed.',
      references: report,
    };
  };

  for (const [index, { credentialRef, binding, active }] of deps.references.entries()) {
    if (active) {
      report.push({ credentialRef, step: 'already-active', message: 'Already using OpenBao.' });
      continue;
    }
    const original = await deps.readOriginal(credentialRef);
    if (!original.ok) return stop(index, credentialRef, original.message);
    const stored = await deps.store(binding, original.value);
    if (!stored.ok) return stop(index, credentialRef, OPENBAO_REASON_TEXT[stored.reason as OpenBaoFailureReason]);
    verified.push({ credentialRef, binding });
    report.push({ credentialRef, step: 'verified', message: 'Stored and verified.' });
  }

  if (verified.length === 0) {
    return { ok: true, activated: false, message: 'Nothing needed migrating.', references: report };
  }
  if (!(await deps.activate(verified))) {
    return {
      ok: false,
      activated: false,
      message: 'The credentials were stored, but the switch to OpenBao could not be saved. Run the migration again.',
      references: report,
    };
  }
  return {
    ok: true,
    activated: true,
    message: 'Migration verified and OpenBao is now active. The original credentials were kept.',
    references: report,
  };
}

/**
 * Why a reference's saved original may not be removed, or null when it may.
 * A Settings credential is removed only from the Settings scope, because the
 * app loads its workspace list with it. A workspace credential stays while any
 * other workspace still reads the same reference from this machine.
 */
export function cleanupBlocker(args: {
  legacy: boolean;
  settingsScope: boolean;
  active: boolean;
  /** Other workspaces naming this reference without their own OpenBao binding; null if unknown. */
  otherUsers: number | null;
}): string | null {
  if (!args.active) return 'This credential is not using OpenBao yet.';
  if (args.legacy && !args.settingsScope) {
    return 'This is a Settings credential. Move it to OpenBao under the Settings credentials scope first.';
  }
  if (args.otherUsers === null) return 'Vermilian could not confirm that no other workspace uses this credential.';
  if (args.otherUsers > 0) return 'Another workspace still uses this saved credential.';
  return null;
}
