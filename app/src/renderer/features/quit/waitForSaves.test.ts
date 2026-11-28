import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { waitForSaves } from './waitForSaves';

function client() {
  return new QueryClient({ defaultOptions: { mutations: { retry: false } } });
}

function run(qc: QueryClient, fn: () => Promise<unknown>) {
  void qc.getMutationCache().build(qc, { mutationFn: fn }).execute(undefined).catch(() => undefined);
}

describe('waitForSaves (VERM-123)', () => {
  it('is settled at once with nothing in flight', async () => {
    expect(await waitForSaves(client(), 1_000)).toEqual({ ok: true });
  });

  it('waits for an in-flight save to succeed', async () => {
    const qc = client();
    run(qc, () => new Promise((r) => setTimeout(r, 150)));
    expect(qc.isMutating()).toBe(1);
    expect(await waitForSaves(qc, 2_000)).toEqual({ ok: true });
    expect(qc.isMutating()).toBe(0);
  });

  it('reports a save that fails while it waits', async () => {
    const qc = client();
    run(qc, () => new Promise((_r, reject) => setTimeout(() => reject(new Error('YouTrack said no')), 100)));
    expect(await waitForSaves(qc, 2_000)).toEqual({ ok: false, message: 'A change could not be saved.' });
  });

  it('gives up on a save that does not finish in time', async () => {
    const qc = client();
    run(qc, () => new Promise((r) => setTimeout(r, 2_000)));
    expect(await waitForSaves(qc, 200)).toEqual({ ok: false, message: 'Some changes are still being saved.' });
  });
});
