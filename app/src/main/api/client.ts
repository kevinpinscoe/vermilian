// Selects the real YouTrack REST client or the in-memory e2e fake based on the
// VERMILIAN_E2E flag. All main-process code that makes YouTrack calls should
// import `youtrack` from here rather than from './youtrack' directly, so the
// e2e harness can run against deterministic fixtures with no network access.

import * as real from './youtrack';
import * as fake from './fakeYouTrack';
import { IS_E2E } from '../e2e';

// Annotating as `typeof real` gives callers the real client's signatures and
// makes tsc reject the fake if its surface ever drifts from the real one.
export const youtrack: typeof real = IS_E2E ? (fake as typeof real) : real;
