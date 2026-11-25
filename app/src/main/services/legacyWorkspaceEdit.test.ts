import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VermilianConfig } from '../../shared/workspace';
import { addLegacyWorkspace, removeLegacyWorkspace, type LegacyWorkspaceEditDeps } from './legacyWorkspaceEdit';

// Synthetic IDs only. `0-hidden` is assigned but absent from anything the tracker returns now.
const CONFIG: VermilianConfig = {
  version: 1,
  activeWorkspaceId: 'ws-a',
  workspaces: [
    { id: 'ws-a', name: 'Inbox', order: 0, folders: [{ id: 'f1', name: 'Projects', order: 0, projectIds: ['0-e1', '0-hidden'] }] },
    { id: 'ws-b', name: 'Reader App', order: 1, folders: [{ id: 'f2', name: 'Projects', order: 0, projectIds: ['0-e2'] }] },
  ],
} as VermilianConfig;

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vermilian-legacy-'));
  file = join(dir, 'workspace-config.json');
  writeFileSync(file, JSON.stringify(CONFIG, null, 2));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const local = () => JSON.parse(readFileSync(file, 'utf8')) as VermilianConfig;

function deps(over: Partial<LegacyWorkspaceEditDeps> = {}) {
  let shared: VermilianConfig = JSON.parse(JSON.stringify(CONFIG));
  const scheduled: number[] = [];
  const d: LegacyWorkspaceEditDeps = {
    read: async () => JSON.parse(JSON.stringify(shared)),
    updateShared: (c) => {
      shared = c;
      return true;
    },
    writeLocal: async (c) => writeFileSync(file, JSON.stringify(c, null, 2)),
    scheduleShared: () => scheduled.push(1),
    refusedMessage: 'Per-workspace storage is being activated.',
    ...over,
  };
  return { d, shared: () => shared, scheduled };
}

const NEW = { id: 'ws-new', name: 'Ship the offline reader', order: 2, folders: [] };

describe('legacy workspace add and remove (VERM-104)', () => {
  it('adds only the new workspace: a project the tracker cannot see keeps its assignment', async () => {
    const { d, shared, scheduled } = deps();
    expect(await addLegacyWorkspace(d, NEW)).toEqual({ ok: true });
    expect(local().workspaces).toEqual([...CONFIG.workspaces, NEW]);
    expect(shared().workspaces[0].folders[0].projectIds).toEqual(['0-e1', '0-hidden']);
    expect(scheduled).toHaveLength(1);
  });

  it('cleanup removes only that workspace, keeping every other assignment and any unrelated edit made meanwhile', async () => {
    const { d, shared } = deps();
    await addLegacyWorkspace(d, NEW);
    // An unrelated edit lands between Apply's create and its cleanup.
    const edited = { ...shared(), workspaces: shared().workspaces.map((w) => (w.id === 'ws-b' ? { ...w, name: 'Reader App (renamed)' } : w)) };
    d.updateShared(edited);
    expect(await removeLegacyWorkspace(d, 'ws-new')).toEqual({ ok: true });
    expect(local().workspaces.map((w) => [w.id, w.name, w.folders.flatMap((f) => f.projectIds)])).toEqual([
      ['ws-a', 'Inbox', ['0-e1', '0-hidden']],
      ['ws-b', 'Reader App (renamed)', ['0-e2']],
    ]);
  });

  it('a refusal by the shared configuration leaves the local file exactly as it was', async () => {
    const before = readFileSync(file, 'utf8');
    const { d, scheduled } = deps({ updateShared: () => false });
    expect(await addLegacyWorkspace(d, NEW)).toEqual({ ok: false, error: 'Per-workspace storage is being activated.' });
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(scheduled).toEqual([]);
  });

  it('a failed local write puts the shared update back', async () => {
    const { d, shared } = deps({
      writeLocal: async () => {
        throw new Error('disk full');
      },
    });
    const r = await addLegacyWorkspace(d, NEW);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/disk full/) });
    expect(shared().workspaces.map((w) => w.id)).toEqual(['ws-a', 'ws-b']);
  });

  it('rollback reverses only this add: a rename of another workspace made while the local write was held survives', async () => {
    let release!: (fail: boolean) => void;
    const held = new Promise<boolean>((r) => (release = r));
    let started!: () => void;
    const writing = new Promise<void>((r) => (started = r));
    const { d, shared } = deps({
      writeLocal: async () => {
        started();
        if (await held) throw new Error('disk full');
      },
    });
    const adding = addLegacyWorkspace(d, NEW);
    await writing;
    // Elsewhere, workspace A is renamed in the shared configuration while the write is held open.
    d.updateShared({ ...shared(), workspaces: shared().workspaces.map((w) => (w.id === 'ws-a' ? { ...w, name: 'Inbox (renamed)' } : w)) });
    release(true);
    expect(await adding).toMatchObject({ ok: false, error: expect.stringMatching(/disk full/) });
    expect(shared().workspaces.map((w) => [w.id, w.name])).toEqual([
      ['ws-a', 'Inbox (renamed)'],
      ['ws-b', 'Reader App'],
    ]);
  });

  it('rollback reverses only this removal: the workspace comes back at its place and a rename made meanwhile survives', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const writing = new Promise<void>((r) => (started = r));
    const { d, shared } = deps({
      writeLocal: async () => {
        started();
        await held;
        throw new Error('disk full');
      },
    });
    const removing = removeLegacyWorkspace(d, 'ws-a');
    await writing;
    d.updateShared({ ...shared(), workspaces: shared().workspaces.map((w) => (w.id === 'ws-b' ? { ...w, name: 'Reader App (renamed)' } : w)) });
    release();
    expect(await removing).toMatchObject({ ok: false });
    expect(shared().workspaces.map((w) => [w.id, w.name, w.folders.flatMap((f) => f.projectIds)])).toEqual([
      ['ws-a', 'Inbox', ['0-e1', '0-hidden']],
      ['ws-b', 'Reader App (renamed)', ['0-e2']],
    ]);
  });

  it('removing a workspace that is already gone is success and writes nothing', async () => {
    const before = readFileSync(file, 'utf8');
    const { d, scheduled } = deps();
    expect(await removeLegacyWorkspace(d, 'ws-gone')).toEqual({ ok: true });
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(scheduled).toEqual([]);
  });
});
