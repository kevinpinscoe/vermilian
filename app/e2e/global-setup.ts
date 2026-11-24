import {
  createRunRoot,
  endRun,
  EVIDENCE_ENV,
  keepProfiles,
  listE2eFolders,
  redirectTmp,
  RUN_ROOT_ENV,
  sweepStale,
} from './helpers/profiles';

// Creates the run's root before any worker starts and returns the teardown
// that removes it after the last test, pass or fail (VERM-54). The variables
// set here are inherited by every worker process and, through launch.ts, by
// every Electron process.
//
// VERM-112: TMPDIR/TMP/TEMP point at the root for the whole run, so any temp
// folder a spec or Chromium makes is removed with it. The teardown then fails
// the run if the root itself survives, and warns about e2e folders that
// appeared in the real temp directory meanwhile.
export default function globalSetup(): () => void {
  for (const dir of sweepStale()) console.log(`[e2e] removed stale profile directory ${dir}`);
  const root = createRunRoot();
  process.env[RUN_ROOT_ENV] = root;
  const tmp = redirectTmp(root);
  const before = listE2eFolders(tmp);
  return () => {
    const report = endRun({ root, tmp, before, keep: keepProfiles(), evidenceDir: process.env[EVIDENCE_ENV] });
    for (const line of report.lines) console.log(line);
    if (!report.ok) throw new Error(`e2e cleanup check failed: ${root} is still present`);
  };
}
