import { describe, it, expect, vi } from 'vitest';
import { cleanupBlocker, migrateToOpenBao, type OpenBaoMigrationDeps } from './openbaoMigration';

const refs = (...names: string[]) =>
  names.map((credentialRef) => ({ credentialRef, binding: { path: credentialRef, field: 'token' }, active: false }));

function deps(over: Partial<OpenBaoMigrationDeps> = {}) {
  return {
    references: refs('jira-1', 'anthropic-1'),
    readOriginal: vi.fn(async (ref: string) => ({ ok: true as const, value: `value-of-${ref}` })),
    store: vi.fn(async () => ({ ok: true as const, value: 'written' as const })),
    activate: vi.fn(async () => true),
    ...over,
  };
}

describe('migrateToOpenBao', () => {
  it('activates once, after every reference verifies', async () => {
    const d = deps();
    const r = await migrateToOpenBao(d);
    expect(r).toMatchObject({ ok: true, activated: true });
    expect(d.activate).toHaveBeenCalledTimes(1);
    expect(r.references.map((x) => x.step)).toEqual(['verified', 'verified']);
  });

  it('keeps the current backend when a write fails part-way', async () => {
    const store = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: 'written' })
      .mockResolvedValueOnce({ ok: false, reason: 'forbidden' });
    const d = deps({ store });
    const r = await migrateToOpenBao(d);
    expect(r).toMatchObject({ ok: false, activated: false });
    expect(d.activate).not.toHaveBeenCalled();
  });

  it('stops at an unreadable original and does not attempt the rest', async () => {
    const readOriginal = vi.fn(async () => ({ ok: false as const, message: 'unreadable' }));
    const d = deps({ readOriginal });
    const r = await migrateToOpenBao(d);
    expect(r.references.map((x) => x.step)).toEqual(['failed', 'not-attempted']);
    expect(d.store).not.toHaveBeenCalled();
    expect(d.activate).not.toHaveBeenCalled();
  });

  it('reports a different existing value as a failure, not an overwrite', async () => {
    const d = deps({ references: refs('jira-1'), store: vi.fn(async () => ({ ok: false as const, reason: 'conflict' as const })) });
    const r = await migrateToOpenBao(d);
    expect(r.ok).toBe(false);
    expect(r.references[0].message).toContain('nothing was overwritten');
  });

  it('can be retried after the switch itself failed', async () => {
    const d = deps({ references: refs('jira-1'), activate: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true) });
    expect((await migrateToOpenBao(d)).activated).toBe(false);
    expect((await migrateToOpenBao(d)).activated).toBe(true);
  });

  it('leaves references already on OpenBao alone', async () => {
    const d = deps({ references: [{ ...refs('jira-1')[0], active: true }] });
    const r = await migrateToOpenBao(d);
    expect(r).toMatchObject({ ok: true, activated: false });
    expect(d.readOriginal).not.toHaveBeenCalled();
  });

  it('never puts a credential value in its report', async () => {
    const r = await migrateToOpenBao(deps());
    expect(JSON.stringify(r)).not.toContain('value-of-');
  });
});

describe('cleanupBlocker', () => {
  const base = { legacy: false, settingsScope: false, active: true, otherUsers: 0 as number | null };

  it('allows removal only when it is safe', () => {
    expect(cleanupBlocker(base)).toBeNull();
    expect(cleanupBlocker({ ...base, legacy: true, settingsScope: true })).toBeNull();
  });

  it.each([
    ['not active', { active: false }],
    ['a Settings credential outside the Settings scope', { legacy: true }],
    ['used by another workspace', { otherUsers: 1 }],
    ['usage unknown', { otherUsers: null }],
  ])('refuses when %s', (_label, over) => {
    expect(cleanupBlocker({ ...base, ...over })).not.toBeNull();
  });
});
