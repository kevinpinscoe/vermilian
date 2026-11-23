import { describe, expect, it } from 'vitest';
import { createYouTrackPriorityOrders, MAX_PRIORITY_ORDER_PROJECTS, type PriorityOrderConnection } from './youtrackPriorityOrders';

// Synthetic project names only.
function handler(bundles: Record<string, string[] | Error>, conn?: PriorityOrderConnection) {
  const asked: Array<{ workspaceId: string; project?: string }> = [];
  const h = createYouTrackPriorityOrders({
    async connection(workspaceId) {
      asked.push({ workspaceId });
      return conn ?? {
        ok: true,
        async read(project) {
          asked.push({ workspaceId, project });
          const b = bundles[project];
          if (b instanceof Error) throw b;
          return b ?? [];
        },
      };
    },
  });
  return { h, asked };
}

describe('youtrackPriorityOrders (VERM-92)', () => {
  it("reads each project's bundle order on the workspace's connection", async () => {
    const { h, asked } = handler({ READ: ['Minor', 'Critical'], PLAT: ['P1', 'P2'] });
    await expect(h({ workspaceId: 'ws-a', projectShortNames: ['READ', 'PLAT', 'READ'] })).resolves.toEqual({
      ok: true, orders: { READ: ['Minor', 'Critical'], PLAT: ['P1', 'P2'] },
    });
    expect(asked.every((x) => x.workspaceId === 'ws-a')).toBe(true);
    expect(asked.filter((x) => x.project).map((x) => x.project)).toEqual(['READ', 'PLAT']);
  });

  it('leaves out a project whose read fails, keeping the others', async () => {
    const { h } = handler({ READ: ['Minor'], SYNC: new Error('403') });
    await expect(h({ workspaceId: 'ws-a', projectShortNames: ['READ', 'SYNC'] })).resolves.toEqual({ ok: true, orders: { READ: ['Minor'] } });
  });

  it('reports a connection failure and tries nothing else', async () => {
    const { h, asked } = handler({}, { ok: false, error: 'No credential.' });
    await expect(h({ workspaceId: 'ws-a', projectShortNames: ['READ'] })).resolves.toEqual({ ok: false, error: 'No credential.' });
    expect(asked).toEqual([{ workspaceId: 'ws-a' }]);
  });

  it('ignores names unsafe for a request path and asks nothing for none', async () => {
    const { h, asked } = handler({ READ: ['Minor'] });
    await expect(h({ workspaceId: 'ws-a', projectShortNames: ['../admin', 'READ?x', 7, 'READ'] })).resolves.toEqual({ ok: true, orders: { READ: ['Minor'] } });
    await expect(h({ workspaceId: 'ws-a', projectShortNames: ['a/b'] })).resolves.toEqual({ ok: true, orders: {} });
    expect(asked.filter((x) => x.project).map((x) => x.project)).toEqual(['READ']);
  });

  it('rejects malformed requests', async () => {
    const { h } = handler({});
    expect((await h({ projectShortNames: ['READ'] })).ok).toBe(false);
    expect((await h({ workspaceId: 'ws-a' })).ok).toBe(false);
    const many = Array.from({ length: MAX_PRIORITY_ORDER_PROJECTS + 1 }, (_, i) => `P${i}`);
    expect((await h({ workspaceId: 'ws-a', projectShortNames: many })).ok).toBe(false);
  });
});
