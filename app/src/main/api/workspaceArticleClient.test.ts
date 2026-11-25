import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceArticleTitle } from '../../shared/workspaceArticle';
import { youtrackWorkspaceArticleClient } from './workspaceArticleClient';
import { createPerWorkspaceApplyWorkspaces } from '../services/runwayApplyWorkspaces';

// The Apply cleanup (VERM-104) through the production YouTrack adapter, with
// YouTrack's HTTP responses stubbed. Synthetic IDs and hosts only.

const URL = 'https://yt.example.test';
const NEW_ID = 'ws-new00001';
const TITLE = workspaceArticleTitle(NEW_ID);

interface Article {
  id: string;
  summary: string;
  content: string;
  updated: number;
}

/** A stubbed YouTrack: articles by ID, with per-ID failures of the single read. */
function youtrack(articles: Article[], opts: { failRead?: Set<string>; listOnly?: Article[]; ignoreDelete?: boolean } = {}) {
  const store = new Map(articles.map((a) => [a.id, { ...a }]));
  const deleted: string[] = [];
  const res = (status: number, body: unknown) => ({
    ok: status < 400,
    status,
    statusText: status === 404 ? 'Not Found' : status >= 500 ? 'Server Error' : 'OK',
    headers: { get: () => null },
    json: async () => body,
  });
  const fetchMock = vi.fn(async (input: string, init: RequestInit = {}) => {
    const u = new globalThis.URL(input);
    if (u.pathname === '/api/admin/projects/VERM/articles') {
      return res(200, [...store.values(), ...(opts.listOnly ?? [])]);
    }
    const m = /^\/api\/articles\/([^/]+)$/.exec(u.pathname);
    if (!m) return res(404, { error: 'unexpected request' });
    const id = decodeURIComponent(m[1]);
    if (init.method === 'DELETE') {
      deleted.push(id);
      if (!store.has(id)) return res(404, { error: 'Not Found' });
      if (!opts.ignoreDelete) store.delete(id);
      return res(200, {});
    }
    if (opts.failRead?.has(id)) return res(503, { error: 'unavailable' });
    const a = store.get(id);
    return a ? res(200, a) : res(404, { error: 'Not Found' });
  });
  return { fetchMock, deleted, store };
}

const article = (id: string, summary = TITLE): Article => ({ id, summary, content: '{}', updated: 1 });
const cleanup = () => createPerWorkspaceApplyWorkspaces({ client: async () => youtrackWorkspaceArticleClient(URL, 'token'), generateWorkspaceId: () => NEW_ID });

afterEach(() => vi.unstubAllGlobals());

describe('Apply cleanup through the production YouTrack adapter (VERM-104)', () => {
  let yt: ReturnType<typeof youtrack>;
  const use = (y: ReturnType<typeof youtrack>) => {
    yt = y;
    vi.stubGlobal('fetch', y.fetchMock);
  };
  beforeEach(() => vi.unstubAllGlobals());

  it('a single read returns the article’s actual title', async () => {
    use(youtrack([article('art-2')]));
    expect(await youtrackWorkspaceArticleClient(URL, 'token').get('art-2')).toMatchObject({ id: 'art-2', summary: TITLE });
  });

  it('deletes its own article, confirms it gone, and succeeds', async () => {
    use(youtrack([article('art-2'), article('art-9', workspaceArticleTitle('ws-other0001'))]));
    expect(await cleanup().remove(NEW_ID, ['art-2'])).toEqual({ ok: true });
    expect(yt.deleted).toEqual(['art-2']);
    expect([...yt.store.keys()]).toEqual(['art-9']);
  });

  it('a failed read is not absence: nothing is deleted and the article is reported as this import’s, unconfirmed', async () => {
    use(youtrack([article('art-2')], { failRead: new Set(['art-2']) }));
    const r = await cleanup().remove(NEW_ID, ['art-2']);
    expect(r).toMatchObject({ ok: false, articleIds: ['art-2'], inspectArticleIds: [] });
    expect(yt.deleted).toEqual([]);
  });

  it('a known article still in the final listing is reported, even when its single read says it is gone', async () => {
    use(youtrack([], { listOnly: [article('art-2')] }));
    const r = await cleanup().remove(NEW_ID, ['art-2']);
    expect(r).toMatchObject({ ok: false, articleIds: ['art-2'] });
  });

  it('a delete YouTrack accepts but does not carry out is reported', async () => {
    use(youtrack([article('art-2')], { ignoreDelete: true }));
    expect(await cleanup().remove(NEW_ID, ['art-2'])).toMatchObject({ ok: false, articleIds: ['art-2'] });
  });
});
