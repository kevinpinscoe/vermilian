/**
 * Per-workspace configuration articles (VERM-43, ADR-0011 §4), through the
 * real IPC channels (window.vermilian.*WorkspaceArticle*) against the fake
 * YouTrack. Like the real Articles API, the fake's updates are unconditional
 * and its titles are not unique. "Another machine" is simulated two ways: an
 * update sent with an out-of-date base (as a second client would send), and
 * the e2e-only debugWriteWorkspaceArticle hook that overwrites an article
 * directly. Nothing in the app uses these articles yet (VERM-44 migrates,
 * VERM-46 switches), so the spec drives the API directly.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { freshUserDataDir, launchAppWithUserDataDir } from './helpers/launch';
import { defaultBoardConfig } from '../src/shared/boardConfig';
import {
  WORKSPACE_SCHEMA_VERSION,
  serialiseNewWorkspaceDocument,
  type WorkspaceDocument,
} from '../src/shared/workspaceSchema';

// Fictional values only.
const A = 'ws-e2e00a';
const B = 'ws-e2e00b';

function doc(workspaceId: string, overrides: Partial<WorkspaceDocument> = {}): WorkspaceDocument {
  return {
    schema: WORKSPACE_SCHEMA_VERSION,
    workspaceId,
    name: `Workspace ${workspaceId}`,
    order: 0,
    backend: { kind: 'youtrack', serverUrl: 'https://youtrack.example.com', credentialRef: 'youtrack-1' },
    ai: { credentialRef: null },
    folders: [{ id: 'folder-1', name: 'Projects', order: 0, parentId: null, projectIds: ['0-e1'] }],
    boards: { '0-e1': defaultBoardConfig('0-e1') },
    dismissals: {},
    ...overrides,
  };
}

async function ready(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="nav-project"]', { timeout: 15_000 });
  return page;
}

const api = {
  list: (page: Page) => page.evaluate(() => window.vermilian.listWorkspaceArticles()),
  read: (page: Page, id: string) => page.evaluate((x) => window.vermilian.readWorkspaceArticle(x), id),
  create: (page: Page, d: WorkspaceDocument) => page.evaluate((x) => window.vermilian.createWorkspaceArticle(x), d),
  update: (page: Page, base: WorkspaceDocument, edited: WorkspaceDocument) =>
    page.evaluate(([b, e]) => window.vermilian.updateWorkspaceArticle(b, e), [base, edited] as const),
  raw: (page: Page) => page.evaluate(() => window.vermilian.debugGetWorkspaceArticles!()),
  overwrite: (page: Page, articleId: string, content: string) =>
    page.evaluate(([id, c]) => window.vermilian.debugWriteWorkspaceArticle!(id, c), [articleId, content] as const),
};

async function readDoc(page: Page, id: string): Promise<WorkspaceDocument> {
  const r = await api.read(page, id);
  if (!r.ok || r.entry.status !== 'ok') throw new Error(`read ${id} failed: ${JSON.stringify(r)}`);
  return r.entry.document;
}

test.describe('Per-workspace configuration articles', () => {
  let app: ElectronApplication | undefined;

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  test('two workspaces are created, discovered, read and updated independently', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir());
    const page = await ready(app);

    expect(await api.list(page)).toEqual({ ok: true, workspaces: [] });
    const a = await api.create(page, doc(A, { order: 0 }));
    const b = await api.create(page, doc(B, { order: 1 }));
    expect(a).toMatchObject({ ok: true, created: true });
    expect(b).toMatchObject({ ok: true, created: true });

    const listed = await api.list(page);
    expect(listed.ok && listed.workspaces.map((w) => [w.workspaceId, w.status])).toEqual([
      [A, 'ok'],
      [B, 'ok'],
    ]);
    const titles = (await api.raw(page)).map((x) => x.summary).sort();
    expect(titles).toEqual([`_vermilian-ws-${A}`, `_vermilian-ws-${B}`]);

    const rawB = (await api.raw(page)).find((x) => x.summary.endsWith(B))!;
    const baseA = await readDoc(page, A);
    expect(await api.update(page, baseA, { ...baseA, name: 'Renamed A' })).toMatchObject({ ok: true, unchanged: false });
    expect((await readDoc(page, A)).name).toBe('Renamed A');
    expect((await api.raw(page)).find((x) => x.id === rawB.id)!.content).toBe(rawB.content);

    // Creating A again takes the update path: no second article.
    expect(await api.create(page, await readDoc(page, A))).toMatchObject({ ok: true, unchanged: true, created: false });
    expect(await api.raw(page)).toHaveLength(2);
  });

  test('two machines editing one workspace: different fields merge, the same field conflicts', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir());
    const page = await ready(app);
    await api.create(page, doc(A));
    const base = await readDoc(page, A); // both "machines" start here

    // Machine 1 renames a folder and adds a board.
    const m1 = await api.update(page, base, {
      ...base,
      folders: [{ ...base.folders[0], name: 'Renamed folder' }],
      boards: { ...base.boards, '0-e2': defaultBoardConfig('0-e2') },
    });
    expect(m1).toMatchObject({ ok: true });

    // Machine 2, still on the old base, changes the order — merges cleanly.
    const m2 = await api.update(page, base, { ...base, order: 5 });
    expect(m2).toMatchObject({ ok: true });
    const merged = await readDoc(page, A);
    expect(merged).toMatchObject({ order: 5, folders: [{ name: 'Renamed folder' }] });
    expect(Object.keys(merged.boards).sort()).toEqual(['0-e1', '0-e2']);

    // Machine 2 then renames the same folder differently, from the old base.
    const before = (await api.raw(page))[0].content;
    const m3 = await api.update(page, base, { ...base, folders: [{ ...base.folders[0], name: 'Other name' }] });
    expect(m3).toMatchObject({
      ok: false,
      reason: 'conflict',
      conflicts: [expect.objectContaining({ path: 'folders["folder-1"].name' })],
    });
    expect((await api.raw(page))[0].content).toBe(before);
  });

  test('unknown fields written by another client survive an update', async () => {
    app = await launchAppWithUserDataDir(freshUserDataDir());
    const page = await ready(app);
    await api.create(page, doc(A));
    const base = await readDoc(page, A);

    // A newer client on the other machine adds fields this version does not know.
    const [article] = await api.raw(page);
    const future = JSON.parse(article.content) as Record<string, unknown>;
    future.futureTopLevel = { keep: true };
    (future.folders as Array<Record<string, unknown>>)[0].colour = 'teal';
    expect(await api.overwrite(page, article.id, JSON.stringify(future, null, 2))).toBe(true);

    expect(await api.update(page, base, { ...base, name: 'Renamed' })).toMatchObject({ ok: true });
    const stored = JSON.parse((await api.raw(page))[0].content) as Record<string, unknown>;
    expect(stored).toMatchObject({ name: 'Renamed', futureTopLevel: { keep: true }, folders: [{ colour: 'teal' }] });
  });

  test('duplicate articles for one workspace are refused and left alone; others keep working', async () => {
    const seed = [
      { summary: `_vermilian-ws-${A}`, content: serialiseNewWorkspaceDocument(doc(A, { name: 'First' })) },
      { summary: `_vermilian-ws-${A}`, content: serialiseNewWorkspaceDocument(doc(A, { name: 'Second' })) },
      { summary: `_vermilian-ws-${B}`, content: serialiseNewWorkspaceDocument(doc(B, { order: 1 })) },
    ];
    app = await launchAppWithUserDataDir(freshUserDataDir(), { VERMILIAN_E2E_WS_ARTICLES: JSON.stringify(seed) });
    const page = await ready(app);
    const before = await api.raw(page);
    const dupIds = before.filter((x) => x.summary.endsWith(A)).map((x) => x.id).sort();

    const listed = await api.list(page);
    if (!listed.ok) throw new Error('list failed');
    expect(listed.workspaces.find((w) => w.workspaceId === A)).toMatchObject({ status: 'ambiguous', articleIds: dupIds });
    expect(listed.workspaces.find((w) => w.workspaceId === B)).toMatchObject({ status: 'ok' });

    expect(await api.update(page, doc(A), doc(A, { name: 'x' }))).toMatchObject({ ok: false, reason: 'ambiguous', articleIds: dupIds });
    expect(await api.create(page, doc(A))).toMatchObject({ ok: false, reason: 'ambiguous' });

    const baseB = await readDoc(page, B);
    expect(await api.update(page, baseB, { ...baseB, name: 'B renamed' })).toMatchObject({ ok: true });

    const after = await api.raw(page);
    expect(after.filter((x) => x.summary.endsWith(A))).toEqual(before.filter((x) => x.summary.endsWith(A)));
    expect(after).toHaveLength(3);
  });
});
