import { defineConfig } from 'vitest/config';

// Unit tests cover pure logic (board grouping/filtering/sorting, API transforms).
// They run in a plain Node environment — no Electron, no DOM. E2E (Playwright)
// lives separately under e2e/ and is excluded here.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', 'out/**', 'e2e/**'],
  },
});
