import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { defaultBoardConfig } from '../../shared/boardConfig';

// The pending-save activation gate (VERM-53 review): unsaved edits to
// _vermilian-config must be written and verified before activation starts,
// no edit may land while it runs, and a clean state writes nothing.

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vermilian-articleconfig-'));
vi.mock('electron', () => ({ app: { getPath: () => userData } }));

// A YouTrack stand-in for the one article.
const yt = {
  article: { id: 'art-1', content: '{"version":1,"workspaces":[],"boards":{},"dismissals":{}}', updated: 1 },
  updates: 0,
  inFlight: 0,
  maxInFlight: 0,
  failUpdates: 0, // number of updates to refuse
  dropUpdates: false, // accept the update but do not store it (read-back differs)
  delayMs: 0,
};
vi.mock('../api/client', () => ({
  youtrack: {
    getVermilianArticle: async (_u: string, _t: string, id: string) => (id === yt.article.id ? { ...yt.article } : null),
    findVermilianArticle: async () => ({ ...yt.article }),
    createVermilianArticle: async () => null,
    updateVermilianArticle: async (_u: string, _t: string, _id: string, content: string) => {
      yt.inFlight++;
      yt.maxInFlight = Math.max(yt.maxInFlight, yt.inFlight);
      try {
        if (yt.delayMs) await new Promise((r) => setTimeout(r, yt.delayMs));
        yt.updates++;
        if (yt.failUpdates > 0) {
          yt.failUpdates--;
          return null;
        }
        const updated = yt.article.updated + 1;
        yt.article = { ...yt.article, updated, ...(yt.dropUpdates ? {} : { content }) };
        return { updated };
      } finally {
        yt.inFlight--;
      }
    },
  },
}));

const ac = await import('./articleConfig');
const URL = 'https://youtrack.example.com';
const TOKEN = 'fictional-token';
const board = (color: string) => ({ ...defaultBoardConfig('0-12'), colors: { status: { Open: color } } });
const stored = () => JSON.parse(yt.article.content) as { boards: Record<string, { colors?: unknown }> };

beforeEach(async () => {
  ac.resetForTests();
  Object.assign(yt, {
    article: { id: 'art-1', content: '{"version":1,"workspaces":[],"boards":{},"dismissals":{}}', updated: 1 },
    updates: 0, inFlight: 0, maxInFlight: 0, failUpdates: 0, dropUpdates: false, delayMs: 0,
  });
  ac.setWriteGuard(async () => ({ allowed: true, message: '' }));
  await ac.load(URL, TOKEN);
});
afterEach(() => ac.unfreezeAfterActivation('', ''));

describe('activation gate for pending legacy saves', () => {
  it('a clean state writes nothing', async () => {
    ac.freezeForActivation();
    expect(await ac.settleForActivation(URL, TOKEN)).toEqual({ ok: true, wrote: false });
    expect(yt.updates).toBe(0);
  });

  it('a pending (debounced) edit is written and verified before activation', async () => {
    ac.updateBoardConfig(board('#111111'));
    ac.scheduleSave(URL, TOKEN);
    ac.freezeForActivation();
    expect(await ac.settleForActivation(URL, TOKEN)).toEqual({ ok: true, wrote: true });
    expect(yt.updates).toBe(1);
    expect(stored().boards['0-12'].colors).toEqual({ status: { Open: '#111111' } });
  });

  it('a failed write refuses activation and keeps the edit for a retry', async () => {
    ac.updateBoardConfig(board('#222222'));
    yt.failUpdates = 1;
    ac.freezeForActivation();
    const r = await ac.settleForActivation(URL, TOKEN);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.message).toMatch(/could not be saved.*Activation did not start/);
    expect(stored().boards['0-12']).toBeUndefined();
    // After unfreezing, the kept edit can still be saved.
    ac.unfreezeAfterActivation(URL, TOKEN);
    await ac.flush(URL, TOKEN);
    expect(stored().boards['0-12'].colors).toEqual({ status: { Open: '#222222' } });
  });

  it('a write YouTrack accepts but does not show on read-back is not a save', async () => {
    ac.updateBoardConfig(board('#333333'));
    yt.dropUpdates = true;
    ac.freezeForActivation();
    const r = await ac.settleForActivation(URL, TOKEN);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.message).toMatch(/reading it back/);
  });

  it('a save that is retrying after a failure is settled, not treated as saved', async () => {
    vi.useFakeTimers();
    try {
      ac.updateBoardConfig(board('#444444'));
      yt.failUpdates = 1;
      await ac.flush(URL, TOKEN); // fails; a retry is scheduled
      expect(stored().boards['0-12']).toBeUndefined();
      ac.freezeForActivation(); // cancels the retry timer
      const r = await ac.settleForActivation(URL, TOKEN);
      expect(r).toEqual({ ok: true, wrote: true });
      expect(stored().boards['0-12'].colors).toEqual({ status: { Open: '#444444' } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a refused (guard-blocked) save refuses activation', async () => {
    ac.updateBoardConfig(board('#555555'));
    ac.setWriteGuard(async () => ({ allowed: false, message: 'Activated on another machine.' }));
    ac.freezeForActivation();
    const r = await ac.settleForActivation(URL, TOKEN);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.message).toContain('Activated on another machine.');
  });

  it('overlapping writes run one at a time, and the gate waits for the one in flight', async () => {
    yt.delayMs = 20;
    ac.updateBoardConfig(board('#666666'));
    const first = ac.flush(URL, TOKEN);
    while (yt.inFlight === 0) await new Promise((r) => setTimeout(r, 1)); // the first write is now in flight
    ac.updateBoardConfig(board('#777777')); // a newer edit, made during the first write
    ac.freezeForActivation();
    const settled = await ac.settleForActivation(URL, TOKEN);
    await first;
    expect(settled).toEqual({ ok: true, wrote: true });
    expect(yt.maxInFlight).toBe(1);
    expect(yt.updates).toBe(2); // the first write, then the gate's write of the newer edit
    expect(stored().boards['0-12'].colors).toEqual({ status: { Open: '#777777' } });
  });

  it('while frozen, edits are refused and nothing is scheduled', async () => {
    ac.freezeForActivation();
    expect(ac.updateBoardConfig(board('#888888'))).toBe(false);
    expect(ac.setDismissal({ workspace: 'w', issueId: '1-1', dismissedWeekOf: '2026-11-16' })).toBe(false);
    expect(ac.removeBoardConfig('0-12')).toBe(false);
    expect(ac.updateWorkspaceConfig({ version: 1, activeWorkspaceId: '', workspaces: [] })).toBe(false);
    ac.scheduleSave(URL, TOKEN);
    expect(await ac.settleForActivation(URL, TOKEN)).toEqual({ ok: true, wrote: false });
    expect(yt.updates).toBe(0);
    ac.unfreezeAfterActivation(URL, TOKEN);
    expect(ac.updateBoardConfig(board('#888888'))).toBe(true);
  });

  it('settling without freezing first is refused', async () => {
    expect(await ac.settleForActivation(URL, TOKEN)).toMatchObject({ ok: false });
  });
});
