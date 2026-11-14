import { describe, expect, it, vi } from 'vitest';
import { getWorkspaceMasterPlanState, type ArticleFetch } from './masterPlan';

// Fictional article content in the master-plan format.
const PLAN_A = '## Outcome A\n- Active epics: TEST-3\n- Success measure: the fictional thing ships\n';
const PLAN_B = '## Outcome B\n- Active epics: TEST-4\n';

function fetcher(articles: Record<string, ArticleFetch>) {
  return vi.fn(async (id: string): Promise<ArticleFetch> => articles[id] ?? { ok: false, status: 404 });
}

describe('getWorkspaceMasterPlanState', () => {
  it('is None without fetching anything when no article is referenced', async () => {
    const fetch = fetcher({});
    await expect(getWorkspaceMasterPlanState(null, fetch)).resolves.toEqual({ kind: 'none' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('loads and parses exactly the referenced article, by ID', async () => {
    const fetch = fetcher({ 'VERM-A-7': { ok: true, article: { id: '161-7', content: PLAN_A, updated: 5 } } });
    const s = await getWorkspaceMasterPlanState('VERM-A-7', fetch);
    expect(fetch).toHaveBeenCalledWith('VERM-A-7');
    expect(s.kind).toBe('loaded');
    if (s.kind === 'loaded') {
      expect(s.articleId).toBe('VERM-A-7');
      expect(s.outcomes.map((o) => o.name)).toEqual(['Outcome A']);
    }
  });

  it('different workspaces referencing different articles get different plans', async () => {
    const fetch = fetcher({
      'VERM-A-7': { ok: true, article: { id: '161-7', content: PLAN_A, updated: 5 } },
      'VERM-A-8': { ok: true, article: { id: '161-8', content: PLAN_B, updated: 6 } },
    });
    const a = await getWorkspaceMasterPlanState('VERM-A-7', fetch);
    const b = await getWorkspaceMasterPlanState('VERM-A-8', fetch);
    expect(a.kind === 'loaded' && a.outcomes[0].name).toBe('Outcome A');
    expect(b.kind === 'loaded' && b.outcomes[0].name).toBe('Outcome B');
  });

  it('a missing article is reported, never replaced by a title search or the global plan', async () => {
    const fetch = fetcher({});
    await expect(getWorkspaceMasterPlanState('VERM-A-404', fetch)).resolves.toEqual({ kind: 'reference-not-found', articleId: 'VERM-A-404' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('an article the credential cannot read is reported as inaccessible', async () => {
    for (const status of [401, 403]) {
      const fetch = fetcher({ 'VERM-A-9': { ok: false, status } });
      await expect(getWorkspaceMasterPlanState('VERM-A-9', fetch)).resolves.toEqual({ kind: 'reference-inaccessible', articleId: 'VERM-A-9' });
    }
  });

  it('any other failure is reported as an error', async () => {
    const fetch = fetcher({ 'VERM-A-9': { ok: false } });
    await expect(getWorkspaceMasterPlanState('VERM-A-9', fetch)).resolves.toEqual({ kind: 'reference-error', articleId: 'VERM-A-9' });
  });

  it('an article whose content cannot be used loads with its parse diagnostics', async () => {
    const fetch = fetcher({ 'VERM-A-7': { ok: true, article: { id: '161-7', content: 'just some prose, no outcomes', updated: 5 } } });
    const s = await getWorkspaceMasterPlanState('VERM-A-7', fetch);
    expect(s.kind).toBe('loaded');
    if (s.kind === 'loaded') expect(s.parseStatus).not.toBe('valid');
  });

  it('refuses a malformed reference without fetching', async () => {
    const fetch = fetcher({});
    await expect(getWorkspaceMasterPlanState('_vermilian-master-plan', fetch)).resolves.toEqual({ kind: 'reference-error', articleId: '' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
