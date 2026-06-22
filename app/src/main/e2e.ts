// Single source of truth for "are we running under the e2e harness?".
// Set by e2e/helpers/launch.ts via the VERMILIAN_E2E env var. When true, the
// main process uses an in-memory fake YouTrack (api/fakeYouTrack.ts) and seeds
// a configured-but-fake connection so tests never touch production data.
export const IS_E2E = process.env.VERMILIAN_E2E === '1';
