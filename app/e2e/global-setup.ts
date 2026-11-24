import { startRun } from './helpers/profiles';

// Creates the run's root before any worker starts and returns the teardown
// that removes it after the last test, pass or fail (VERM-54). The variables
// set here are inherited by every worker process and, through launch.ts, by
// every Electron process.
//
// VERM-112: TMPDIR/TMP/TEMP point at the root for the whole run, so any temp
// folder a spec or Chromium makes is removed with it. The teardown fails the
// run if the root itself survives, warns about e2e folders that appeared in
// the real temp directory meanwhile, and always restores the five variables
// setup changed (see startRun in helpers/profiles.ts).
export default function globalSetup(): () => void {
  return startRun();
}
