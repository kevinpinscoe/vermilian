// Selects the real Claude client or the in-memory e2e fake based on the
// VERMILIAN_E2E flag. Main-process code that calls Claude should import `claude`
// from here rather than from './claude' directly, so the e2e harness can run the
// AI-create and stand-up flows against deterministic output with no API key.

import * as real from './claude';
import * as fake from './fakeClaude';
import { IS_E2E } from '../e2e';

// Annotating as `typeof real` gives callers the real client's signatures and
// makes tsc reject the fake if its surface ever drifts from the real one.
export const claude: typeof real = IS_E2E ? (fake as typeof real) : real;
