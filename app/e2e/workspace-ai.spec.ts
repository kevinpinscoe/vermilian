/**
 * AI features use the active workspace's own Anthropic credential (VERM-47),
 * against the fake YouTrack, fake Jira and fake Claude.
 *
 * Under VERMILIAN_E2E a reference with nothing configured resolves to a
 * fictional key naming it, and the fake Claude records which reference each
 * call used (never a key). References beginning `e2e-missing` stay
 * unconfigured, to show "selected but unavailable on this machine". Every
 * value here is fictional.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { WORKSPACE_SCHEMA_VERSION, type WorkspaceDocument } from '../src/shared/workspaceSchema';

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);

const ytWorkspace = (workspaceId: string, name: string, order: number, aiRef: string | null): WorkspaceDocument => ({
  schema: WORKSPACE_SCHEMA_VERSION,
  workspaceId,
  name,
  order,
  backend: { kind: 'youtrack', serverUrl: 'http://e2e.local', credentialRef: 'youtrack-1' },
  ai: { credentialRef: aiRef },
  folders: [{ id: 'folder-a', name: 'Projects', order: 0, parentId: null, projectIds: ['0-e1'] }],
  boards: {},
  dismissals: {},
});

const SEEDS: WorkspaceDocument[] = [
  ytWorkspace('ws-e2eai1', 'Home AI', 0, 'anthropic-home'),
  ytWorkspace('ws-e2eai2', 'Work AI', 1, 'anthropic-work'),
  ytWorkspace('ws-e2eai3', 'No AI', 2, null),
  ytWorkspace('ws-e2eai4', 'Missing AI', 3, 'e2e-missing-1'),
  ytWorkspace('ws-e2eai5', 'Broken AI', 4, 'anthropic-broken'),
  {
    ...ytWorkspace('ws-e2eai6', 'Jira AI', 5, null),
    backend: { kind: 'jira', siteUrl: 'https://example.atlassian.net', email: 'user@example.com', cloudId: '', credentialRef: 'jira-1' },
    folders: [{ id: 'folder-j', name: 'Projects', order: 0, parentId: null, projectIds: ['DEMO'] }],
  },
  // Its credential is a real command that takes two seconds (a fictional
  // value): the window in which the user switches workspaces.
  ytWorkspace('ws-e2eai7', 'Slow AI', 6, 'anthropic-slow'),
];

const SLOW_KEY = 'fictional-slow-key';
const SLOW_SECONDS = 2;

const OUTCOME = { name: 'Ship it', activeEpics: [], successMeasure: null, targetWindow: null, risks: null };

let app: ElectronApplication;
let page: Page;

async function claudeCalls() {
  return page.evaluate(() => window.vermilian.debugGetClaudeCalls!());
}

async function activate(workspaceId: string) {
  const r = await page.evaluate((id) => window.vermilian.setActiveWorkspace(id), workspaceId);
  expect(r.ok).toBe(true);
}

/** Runs all three AI operations from the active workspace, as the renderer does. */
async function runAll(workspaceId: string) {
  return page.evaluate(async ({ id, outcome }) => {
    const create = await window.vermilian.aiCreateTask({ description: 'Write the fictional report', projects: [{ id: '0-e1', name: 'Test' }], workspaceId: id });
    const rec = await window.vermilian.getRecommendation({
      issueIds: ['0-e1-3'],
      candidateContext: [{ issueId: '0-e1-3', epicOutcomeContext: { kind: 'none' }, parentEpicIdReadable: null }] as never,
      outcome,
      workspaceId: id,
    });
    const standup = await window.vermilian.standupGenerate({ window: '7d', workspaceId: id });
    return { create, rec, standup };
  }, { id: workspaceId, outcome: OUTCOME });
}

async function readDoc(workspaceId: string): Promise<WorkspaceDocument> {
  const r = await page.evaluate((id) => window.vermilian.readWorkspaceArticle(id), workspaceId);
  if (!r.ok || r.entry.status !== 'ok') throw new Error('workspace article not readable');
  return r.entry.document;
}

async function openSwitcherWorkspace(name: string) {
  await tid(page, 'workspace-switcher').click();
  await page.locator('[data-testid="workspace-menu-item"]').filter({ hasText: name }).click();
  await expect(tid(page, 'workspace-switcher')).toContainText(name);
}

test.describe('per-workspace storage (e2e gate)', () => {
  test.beforeEach(async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_WORKSPACE_STORAGE: 'per-workspace' });
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="topbar-settings-btn"]', { timeout: 15_000 });
    for (const d of SEEDS) {
      const r = await page.evaluate((doc) => window.vermilian.createWorkspaceArticle(doc), d);
      expect(r.ok).toBe(true);
    }
    // A configured source that cannot be read: resolution must stop there.
    await page.evaluate(() => window.vermilian.setCredentialRefSources('anthropic-broken', { command: '', file: '/nonexistent/vermilian-e2e/broken.key' }));
    await page.evaluate(
      ({ key, seconds }) => window.vermilian.setCredentialRefSources('anthropic-slow', { command: `sleep ${seconds}; echo ${key}`, file: '' }),
      { key: SLOW_KEY, seconds: SLOW_SECONDS },
    );
    await page.reload();
    await expect(tid(page, 'workspace-switcher')).toBeVisible({ timeout: 15_000 });
  });

  test.afterEach(async () => { await app.close(); });

  test("two workspaces with different references: every AI operation uses its own workspace's", async () => {
    for (const [id, ref] of [['ws-e2eai1', 'anthropic-home'], ['ws-e2eai2', 'anthropic-work']] as const) {
      await activate(id);
      const before = (await claudeCalls()).length;
      const r = await runAll(id);
      expect(r.create.ok).toBe(true);
      expect(r.rec.ok).toBe(true);
      expect(r.standup.ok).toBe(true);
      const made = (await claudeCalls()).slice(before);
      expect(made.map((c) => c.fn).sort()).toEqual(['extractTaskFields', 'generateStandupReport', 'getRecommendation']);
      expect(new Set(made.map((c) => c.credentialRef))).toEqual(new Set([ref]));
    }
  });

  test('a workspace with no AI credential refuses every AI operation without contacting Anthropic', async () => {
    await activate('ws-e2eai3');
    const before = (await claudeCalls()).length;
    const r = await runAll('ws-e2eai3');
    for (const res of [r.create, r.rec, r.standup]) {
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/no Anthropic credential is selected/);
    }
    expect((await claudeCalls()).length).toBe(before);
    const ctx = await page.evaluate(() => window.vermilian.getActiveWorkspace());
    expect(ctx.ai).toMatchObject({ state: 'not-selected', credentialRef: null });
  });

  test('a credential whose configured source fails stops the operation: no fallback', async () => {
    await activate('ws-e2eai5');
    const before = (await claudeCalls()).length;
    const r = await runAll('ws-e2eai5');
    for (const res of [r.create, r.rec, r.standup]) {
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/^AI is unavailable: .*anthropic-broken/);
      expect(res.error).not.toContain('/nonexistent/');
    }
    expect((await claudeCalls()).length).toBe(before);
  });

  test('a request from a workspace that is no longer active sends nothing', async () => {
    await activate('ws-e2eai2');
    const before = (await claudeCalls()).length;
    const r = await page.evaluate(() => window.vermilian.aiCreateTask({ description: 'x', projects: [], workspaceId: 'ws-e2eai1' }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/active workspace changed/);
    expect((await claudeCalls()).length).toBe(before);
  });

  // The race: workspace A starts resolving its (slow) credential, the user
  // switches to B, A's credential arrives — and nothing may reach Anthropic.
  const OPS = {
    'AI task creation': (id: string) => window.vermilian.aiCreateTask({ description: 'Write the fictional report', projects: [{ id: '0-e1', name: 'Test' }], workspaceId: id }),
    'Priority Desk recommendation': (id: string) =>
      window.vermilian.getRecommendation({
        issueIds: ['0-e1-3'],
        candidateContext: [{ issueId: '0-e1-3', epicOutcomeContext: { kind: 'none' }, parentEpicIdReadable: null }] as never,
        outcome: { name: 'Ship it', activeEpics: [], successMeasure: null, targetWindow: null, risks: null },
        workspaceId: id,
      }),
    'stand-up generation': (id: string) => window.vermilian.standupGenerate({ window: '7d', workspaceId: id }),
  } as const;

  for (const [label, op] of Object.entries(OPS)) {
    test(`${label}: switching workspaces while the credential resolves refuses before Anthropic is contacted`, async () => {
      await activate('ws-e2eai7');
      const before = (await claudeCalls()).length;
      // 1–2. Start the operation in Slow AI without waiting for it (the trailing
      // `void 0` keeps evaluate from awaiting); its credential command runs.
      const t0 = Date.now();
      await page.evaluate(`window.__aiOp = (${op.toString()})('ws-e2eai7'); window.__aiOp.then(() => { window.__aiDone = Date.now(); }); void 0`);
      await page.waitForTimeout(500);
      // 3. Switch to Work AI before the credential arrives.
      await activate('ws-e2eai2');
      const switchedAt = Date.now() - t0;
      // 4–5. The credential finishes resolving; the operation is refused.
      const r = (await page.evaluate('window.__aiOp')) as { ok: boolean; error?: string };
      // The switch really did land while the credential was still resolving;
      // otherwise this test would not be exercising the race at all.
      const doneAt = ((await page.evaluate('window.__aiDone')) as number) - t0;
      expect(switchedAt).toBeLessThan(SLOW_SECONDS * 1000);
      expect(doneAt).toBeGreaterThan(switchedAt);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/active workspace changed/);
      expect(JSON.stringify(r)).not.toContain(SLOW_KEY);
      // Nothing reached the fake Claude — not with Slow AI's key, nor Work AI's.
      expect((await claudeCalls()).length).toBe(before);
    });
  }

  test('without a switch, the slow credential is used and the operation succeeds', async () => {
    await activate('ws-e2eai7');
    const before = (await claudeCalls()).length;
    const r = await page.evaluate(`(${OPS['AI task creation'].toString()})('ws-e2eai7')`) as { ok: boolean };
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain(SLOW_KEY);
    // The real (fictional) command's value, not an e2e stand-in or another reference.
    expect((await claudeCalls()).slice(before)).toEqual([{ fn: 'extractTaskFields', credentialRef: 'other' }]);
  });

  test('AI controls follow the active workspace when switching: available, none selected, unavailable here', async () => {
    const standup = tid(page, 'standup-btn');
    await openSwitcherWorkspace('Home AI');
    await expect(standup).toBeEnabled();
    await openSwitcherWorkspace('No AI');
    await expect(standup).toBeDisabled();
    await expect.poll(async () => (await page.evaluate(() => window.vermilian.getActiveWorkspace())).ai.state).toBe('not-selected');
    await openSwitcherWorkspace('Missing AI');
    await expect(standup).toBeDisabled();
    const ctx = await page.evaluate(() => window.vermilian.getActiveWorkspace());
    expect(ctx.ai.state).toBe('unavailable');
    expect(ctx.ai.message).toMatch(/e2e-missing-1 has no source configured on this machine/);
    await openSwitcherWorkspace('Work AI');
    await expect(standup).toBeEnabled();
  });

  test('a new workspace defaults to None; one can be chosen in the form', async () => {
    for (const [name, ai] of [['Default none', ''], ['Chosen AI', 'anthropic-chosen']] as const) {
      await tid(page, 'workspace-switcher').click();
      await tid(page, 'new-workspace-btn').click();
      await tid(page, 'new-workspace-input').fill(name);
      await tid(page, 'new-workspace-backend-youtrack').click();
      await tid(page, 'new-workspace-server-url').fill('http://e2e.local');
      if (ai) await tid(page, 'new-workspace-ai-credential-ref').fill(ai);
      await tid(page, 'new-workspace-submit').click();
      await expect(tid(page, 'workspace-switcher')).toContainText(name);
    }
    const listed = await page.evaluate(() => window.vermilian.listWorkspaceArticles());
    if (!listed.ok) throw new Error(listed.message);
    const docs = listed.workspaces.flatMap((e) => (e.status === 'ok' ? [e.document] : []));
    expect(docs.find((d) => d.name === 'Default none')?.ai.credentialRef).toBeNull();
    expect(docs.find((d) => d.name === 'Chosen AI')?.ai.credentialRef).toBe('anthropic-chosen');
  });

  test('the form refuses a malformed AI reference, such as a pasted key, without echoing it', async () => {
    await tid(page, 'workspace-switcher').click();
    await tid(page, 'new-workspace-btn').click();
    await tid(page, 'new-workspace-input').fill('Bad AI');
    await tid(page, 'new-workspace-backend-youtrack').click();
    await tid(page, 'new-workspace-server-url').fill('http://e2e.local');
    await tid(page, 'new-workspace-ai-credential-ref').fill('sk-fictional-PASTED-KEY');
    await tid(page, 'new-workspace-submit').click();
    await expect(tid(page, 'new-workspace-error')).toContainText('not a key');
    await expect(tid(page, 'new-workspace-error')).not.toContainText('PASTED');
  });

  test('Manage workspaces sets, changes and clears the reference of a YouTrack and a Jira workspace', async () => {
    for (const [id, name] of [['ws-e2eai3', 'No AI'], ['ws-e2eai6', 'Jira AI']] as const) {
      const before = await readDoc(id);
      for (const value of ['anthropic-new', 'anthropic-changed']) {
        await tid(page, 'workspace-switcher').click();
        await tid(page, 'manage-workspaces-btn').click();
        await page.locator(`[data-testid="workspace-row"][data-ws-name="${name}"] [data-testid="workspace-ai-btn"]`).click();
        await expect(tid(page, 'workspace-ai-input')).toBeVisible();
        await tid(page, 'workspace-ai-input').fill(value);
        await tid(page, 'workspace-ai-save').click();
        await expect(page.locator('#workspace-ai-credential-modal')).toHaveCount(0);
        await expect.poll(async () => (await readDoc(id)).ai.credentialRef).toBe(value);
      }
      await tid(page, 'workspace-switcher').click();
      await tid(page, 'manage-workspaces-btn').click();
      await page.locator(`[data-testid="workspace-row"][data-ws-name="${name}"] [data-testid="workspace-ai-btn"]`).click();
      await expect(tid(page, 'workspace-ai-current')).toHaveText('Current: anthropic-changed');
      await tid(page, 'workspace-ai-none').click();
      await expect.poll(async () => (await readDoc(id)).ai.credentialRef).toBeNull();

      // Nothing else about the workspace changed.
      const after = await readDoc(id);
      expect({ ...after, ai: before.ai }).toEqual(before);
    }
  });

  test('changing the active workspace reference switches its AI availability', async () => {
    await openSwitcherWorkspace('No AI');
    await expect(tid(page, 'standup-btn')).toBeDisabled();
    await tid(page, 'workspace-switcher').click();
    await tid(page, 'manage-workspaces-btn').click();
    await page.locator('[data-testid="workspace-row"][data-ws-name="No AI"] [data-testid="workspace-ai-btn"]').click();
    await tid(page, 'workspace-ai-input').fill('anthropic-home');
    await tid(page, 'workspace-ai-save').click();
    await expect(tid(page, 'standup-btn')).toBeEnabled();
  });
});

test.describe('legacy storage (before VERM-53 activation)', () => {
  test.beforeEach(async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir());
    page = await app.firstWindow();
    await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  });

  test.afterEach(async () => { await app.close(); });

  test('AI keeps using the Settings key, and no AI credential control is offered', async () => {
    const ctx = await page.evaluate(() => window.vermilian.getActiveWorkspace());
    expect(ctx.storage).toBe('legacy');
    expect(ctx.ai).toMatchObject({ state: 'available', credentialRef: 'anthropic-1' });
    await expect(tid(page, 'standup-btn')).toBeEnabled();

    const before = (await claudeCalls()).length;
    const r = await page.evaluate((id) => window.vermilian.aiCreateTask({ description: 'Write the fictional report', projects: [{ id: '0-e1', name: 'Test' }], workspaceId: id }), ctx.workspaceId);
    expect(r.ok).toBe(true);
    const made = (await claudeCalls()).slice(before);
    expect(made).toEqual([{ fn: 'extractTaskFields', credentialRef: 'legacy' }]);

    await tid(page, 'workspace-switcher').click();
    await tid(page, 'manage-workspaces-btn').click();
    await expect(tid(page, 'workspace-row').first()).toBeVisible();
    await expect(tid(page, 'workspace-ai-btn')).toHaveCount(0);
    await expect(tid(page, 'new-workspace-ai-credential-ref')).toHaveCount(0);
  });
});
