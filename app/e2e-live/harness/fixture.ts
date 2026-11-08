/**
 * The `live` Playwright fixture every live scenario uses.
 *
 * - Runs the preflight once per worker. If it fails, every scenario is marked
 *   Blocked with the failing check as its reason and fails the run — it is
 *   never skipped and never passed.
 * - Gives each scenario a reproducible starting state: all harness fixtures in
 *   both harness projects are reset through the verifier before the scenario
 *   begins, so no scenario depends on another having run or succeeded.
 * - Collects the evidence the reporter needs: expected behavior, observed
 *   behavior, server values before and after, the preflight result.
 */

import { test as base, TestInfo } from '@playwright/test';
import fs from 'fs';
import { LiveApp, seedProfile, tempProfileDir } from './app';
import { Client, HarnessError, redact, verifierClient } from './clients';
import { Preflight, runPreflight } from './preflight';
import { ensureFixture, FocusState, Project, readIssue, resetFixtures, setFields, snapshot } from './server';
import { LiveSettings, loadSettings } from './settings';

export interface Live {
  settings: LiveSettings;
  preflight: Preflight;
  verifier: Client;
  project: Project;
  rejectProject: Project;
  /** Records the checklist expectation this scenario checks. */
  expected(text: string): void;
  /** Records something seen, for the report; does not assert. */
  observe(key: string, value: unknown): void;
  /** Marks part of the result as waiting on a decision rather than asserted. */
  pendingDecision(text: string): void;
  /** Reads and attaches current server values for the given issues. */
  server(label: string, issueIds: string[]): Promise<Record<string, FocusState>>;
  /** Reads one issue's current server values without attaching (for polling). */
  read(issueId: string): Promise<FocusState>;
  /** Ensures the named fixtures exist (in the harness project unless noted) after the reset. */
  fixture(name: string, project?: 'harness' | 'reject'): Promise<FocusState>;
  /** A launcher bound to this scenario's isolated profile. */
  app: LiveApp;
}

type WorkerFixtures = { preflightResult: { settings: LiveSettings; preflight: Preflight } };

async function attachJson(testInfo: TestInfo, name: string, value: unknown) {
  const file = testInfo.outputPath(`${name}.json`);
  fs.writeFileSync(file, redact(JSON.stringify(value, null, 2)));
  await testInfo.attach(name, { path: file, contentType: 'application/json' });
}

export const test = base.extend<{ live: Live }, WorkerFixtures>({
  preflightResult: [async ({}, use) => {
    const settings = loadSettings();
    const preflight = await runPreflight(settings);
    await use({ settings, preflight });
  }, { scope: 'worker' }],

  live: async ({ preflightResult }, use, testInfo) => {
    const { settings, preflight } = preflightResult;
    await attachJson(testInfo, 'preflight', preflight);
    if (!preflight.ok || !preflight.project || !preflight.rejectProject) {
      testInfo.annotations.push({ type: 'blocked', description: preflight.blockedReason ?? 'preflight did not complete' });
      throw new HarnessError(`BLOCKED by preflight — ${preflight.blockedReason}`);
    }
    const verifier = verifierClient(settings);
    const project = preflight.project;
    const rejectProject = preflight.rejectProject;
    const observed: Record<string, unknown> = {};

    // Reproducible start: every harness fixture back to unfocused/unranked/open.
    const reset = await resetFixtures(verifier, [project.shortName, rejectProject.shortName], settings.openState);
    await attachJson(testInfo, 'server-after-reset', reset);

    const profileDir = tempProfileDir();
    seedProfile(profileDir, {
      server: { url: settings.appUrl, login: settings.appLogin, tokenCommand: settings.appTokenCommand, tokenFile: settings.appTokenFile },
      projectIds: [project.id, rejectProject.id],
    });
    const app = new LiveApp(settings, testInfo, profileDir);

    const live: Live = {
      settings, preflight, verifier, project, rejectProject, app,
      expected: (text) => { testInfo.annotations.push({ type: 'expected', description: text }); },
      observe: (key, value) => { observed[key] = value; },
      pendingDecision: (text) => { testInfo.annotations.push({ type: 'pending-decision', description: text }); },
      server: async (label, ids) => {
        const snap = await snapshot(verifier, ids);
        await attachJson(testInfo, `server-${label}`, snap);
        return snap;
      },
      read: (issueId) => readIssue(verifier, issueId),
      fixture: async (name, which = 'harness') => {
        const st = await ensureFixture(verifier, which === 'harness' ? project : rejectProject, name);
        // A fixture created just now has the project's default state, not the reset state.
        if (st.focus !== null || st.focusRank !== null || st.whyNow !== null || st.status !== settings.openState) {
          await setFields(verifier, st.id, { focus: null, focusRank: null, whyNow: null, status: settings.openState });
        }
        return readIssue(verifier, st.id);
      },
    };

    try {
      await use(live);
    } finally {
      await app.finish().catch(() => undefined);
      await attachJson(testInfo, 'observed', observed);
    }
  },
});

export { expect } from '@playwright/test';
