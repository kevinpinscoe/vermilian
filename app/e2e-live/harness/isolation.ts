/**
 * Effective-permission allowlist for the application identity (VERM-10).
 *
 * Strict isolation (the original design, and the default): the app identity
 * holds permissions only in the two harness projects, and nothing global.
 *
 * GLBL exception (opt-in, VERMILIAN_LIVE_ACCEPT_GLBL_OBSERVER=1, Kevin's
 * decision): every new Hub account inherits "Registered Users: Observer in
 * GLBL". A role in Hub's Global project applies in every project, so it is
 * accepted only as exactly the read-only Hub permissions below, held globally.
 * Any YouTrack permission (issues, comments, articles, attachments, work
 * items) held globally or outside the harness projects, and any write held
 * globally, still fails.
 *
 * Pure: takes the permission cache, returns findings. No I/O.
 */

export interface PermEntry { permission: { key: string }; global: boolean; projects: Array<{ shortName: string }> | null }

/** Read-only Hub permissions the GLBL exception accepts, held globally. Nothing else. */
export const GLBL_ACCEPTED_GLOBAL = [
  'jetbrains.jetpass.project-read-basic',
  'jetbrains.jetpass.project-read',
  'jetbrains.jetpass.user-read-basic',
  'jetbrains.jetpass.user-read',
] as const;

export interface IsolationResult {
  ok: boolean;
  /** Each a reason the identity holds more than the rule allows. */
  violations: string[];
  /** Global permissions accepted under the GLBL exception (empty under strict isolation). */
  acceptedGlobal: string[];
}

export function evaluateIsolation(perms: PermEntry[], harnessProjects: string[], acceptGlblObserver: boolean): IsolationResult {
  const allowed = new Set(harnessProjects);
  const accepted = new Set<string>(acceptGlblObserver ? GLBL_ACCEPTED_GLOBAL : []);
  const violations: string[] = [];
  const acceptedGlobal: string[] = [];
  for (const p of perms) {
    const key = p.permission.key;
    if (p.global) {
      if (accepted.has(key)) acceptedGlobal.push(key);
      else violations.push(`${key} held globally${acceptGlblObserver ? ' (not in the accepted GLBL read-only set)' : ' (strict isolation allows no global permission)'}`);
      continue;
    }
    const outside = (p.projects ?? []).map((x) => x.shortName).filter((sn) => !allowed.has(sn));
    if (outside.length) violations.push(`${key} held in ${outside.join(', ')}`);
  }
  return { ok: violations.length === 0, violations, acceptedGlobal: acceptedGlobal.sort() };
}
