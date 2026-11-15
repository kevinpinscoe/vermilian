import { createRunRoot, keepProfiles, removeDir, RUN_ROOT_ENV, sweepStale } from './helpers/profiles';

// Creates the run's profile root before any worker starts and returns the
// teardown that removes it after the last test, pass or fail (VERM-54). The
// env var set here is inherited by every worker process.
export default function globalSetup(): () => void {
  for (const dir of sweepStale()) console.log(`[e2e] removed stale profile directory ${dir}`);
  const root = createRunRoot();
  process.env[RUN_ROOT_ENV] = root;
  return () => {
    if (keepProfiles()) {
      console.log(`[e2e] kept Electron profiles in ${root} (VERMILIAN_E2E_KEEP_PROFILES=1)`);
      return;
    }
    removeDir(root);
  };
}
