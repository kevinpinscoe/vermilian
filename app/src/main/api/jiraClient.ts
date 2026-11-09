// Selects the real Jira REST client or the in-memory e2e fake based on the
// VERMILIAN_E2E flag, the same way client.ts does for YouTrack.

import * as real from './jira';
import * as fake from './fakeJira';
import { IS_E2E } from '../e2e';

export const jira: typeof real = IS_E2E ? (fake as typeof real) : real;
