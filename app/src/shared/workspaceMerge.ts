// Three-way merge of a workspace edit (VERM-43).
//
// Two machines can edit the same workspace article. YouTrack articles have no
// conditional write, so the main process re-reads the article just before it
// writes and merges the user's edit into whatever is there now:
//
//   base    the document the renderer started editing from
//   edited  the renderer's edited copy of `base`
//   remote  the document in the article right now
//
// A field (or collection item) changed on only one side takes that side's
// value. A field changed on both sides to the same value is fine. A field
// changed on both sides to *different* values is a conflict: the merge is
// refused and the conflicting paths are reported. Nothing is ever silently
// chosen for the user (Kevin, 2026-11-13).
//
// Collections merge per item, not wholesale: folders and board views by their
// `id`, boards, colours and dismissals by their record key. So one machine
// adding a folder while the other renames a board both survive.
//
// Known fields only. Unknown fields never reach a WorkspaceDocument; they are
// carried by the source handle that parsed `remote`, and the caller writes the
// merged result through serialiseUpdatedWorkspaceDocument with that handle.
//
// Pure TypeScript: no Electron, no React.

import { validateWorkspaceDocument, type WorkspaceDocument } from './workspaceSchema';

export interface WorkspaceMergeConflict {
  path: string; // e.g. `name`, `boards["0-12"].activeViewId`, `folders["folder-1"]`
  reason: 'both-changed' | 'changed-and-removed' | 'order-changed' | 'invalid-result';
  message: string;
}

export type WorkspaceMergeResult =
  | { ok: true; document: WorkspaceDocument }
  | { ok: false; conflicts: WorkspaceMergeConflict[] };

// `base` may be null: the caller has no base at all (a create that found the
// workspace already exists). Then every difference from `remote` is a
// conflict, so an existing article is never overwritten by a create.
export function mergeWorkspaceEdit(
  base: WorkspaceDocument | null,
  edited: WorkspaceDocument,
  remote: WorkspaceDocument,
): WorkspaceMergeResult {
  const conflicts: WorkspaceMergeConflict[] = [];
  if (edited.workspaceId !== remote.workspaceId || (base && base.workspaceId !== remote.workspaceId)) {
    return {
      ok: false,
      conflicts: [
        {
          path: 'workspaceId',
          reason: 'both-changed',
          message: 'The edit belongs to a different workspace than the article.',
        },
      ],
    };
  }

  const merged = merge(documentShape(base, edited, remote), '', base ?? MISSING, edited, remote, conflicts);
  if (conflicts.length > 0) return { ok: false, conflicts };

  // Per-item merges can each be fine yet combine into an invalid document —
  // for example both machines putting the same project in different folders.
  // That is a conflict too, never a write.
  const doc = merged as WorkspaceDocument;
  const errors = validateWorkspaceDocument(doc);
  if (errors.length > 0) {
    return {
      ok: false,
      conflicts: errors.map((e) => ({
        path: e.path,
        reason: 'invalid-result',
        message: `The two sets of changes cannot be combined: ${e.message}`,
      })),
    };
  }
  return { ok: true, document: doc };
}

// ─── Shapes: how deep to merge ───────────────────────────────────────────────

type Shape =
  | { t: 'leaf' }
  | { t: 'struct'; fields: Record<string, Shape> }
  | { t: 'record'; of: Shape }
  | { t: 'keyed'; key: string; of: Shape }; // array of objects identified by `key`

const LEAF: Shape = { t: 'leaf' };
const struct = (fields: Record<string, Shape>): Shape => ({ t: 'struct', fields });

const BOARD_SHAPE = struct({
  boardId: LEAF,
  activeViewId: LEAF,
  // A view is merged as a whole: its columns, sort and grouping are one
  // arrangement, and splicing two machines' halves together would produce a
  // view nobody built.
  views: { t: 'keyed', key: 'id', of: LEAF },
  colors: { t: 'record', of: LEAF },
});

const FOLDER_SHAPE = struct({ id: LEAF, name: LEAF, order: LEAF, parentId: LEAF, projectIds: LEAF });

// The backend merges per field while its kind is the same on every side; a
// change of kind replaces the whole connection, so it is one value then.
function documentShape(
  base: WorkspaceDocument | null,
  edited: WorkspaceDocument,
  remote: WorkspaceDocument,
): Shape {
  const kinds = new Set([edited.backend.kind, remote.backend.kind, base?.backend.kind ?? edited.backend.kind]);
  const backend =
    kinds.size === 1
      ? struct(Object.fromEntries(Object.keys({ ...edited.backend, ...remote.backend }).map((k) => [k, LEAF])))
      : LEAF;
  return struct({
    schema: LEAF,
    workspaceId: LEAF,
    name: LEAF,
    order: LEAF,
    backend,
    ai: struct({ credentialRef: LEAF }),
    folders: { t: 'keyed', key: 'id', of: FOLDER_SHAPE },
    boards: { t: 'record', of: BOARD_SHAPE },
    dismissals: { t: 'record', of: LEAF },
  });
}

// ─── Merge ───────────────────────────────────────────────────────────────────

// Absent on that side (a removed item, or no base at all). Distinct from
// `undefined`, which is an optional field that is simply not set.
const MISSING: unique symbol = Symbol('missing');
type Value = unknown;

/**
 * JSON with object keys sorted, so two values that differ only in key order
 * (a renderer that rebuilt an object, say) compare equal. Array order counts.
 */
export function stableStringify(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    typeof x === 'object' && x !== null && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  );
}

function same(a: Value, b: Value): boolean {
  if (a === MISSING || b === MISSING) return a === b;
  return stableStringify(a) === stableStringify(b);
}

const isObject = (v: Value): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function label(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? (path ? `${path}.${key}` : key) : `${path}[${JSON.stringify(key)}]`;
}

function conflict(out: WorkspaceMergeConflict[], path: string, reason: WorkspaceMergeConflict['reason']) {
  const where = path || 'the workspace';
  const message =
    reason === 'changed-and-removed'
      ? `${where} was changed on one side and removed on the other.`
      : reason === 'order-changed'
        ? `${where} was reordered differently on each side.`
        : `${where} was changed differently on each side.`;
  out.push({ path, reason, message });
}

function merge(
  shape: Shape,
  path: string,
  base: Value,
  edited: Value,
  remote: Value,
  out: WorkspaceMergeConflict[],
): Value {
  // The common cases, at any depth.
  if (same(edited, base)) return remote;
  if (same(remote, base) || same(edited, remote)) return edited;

  // Both sides changed it. A removal on one side against a change on the other
  // cannot be reconciled.
  if (edited === MISSING || remote === MISSING) {
    conflict(out, path, base === MISSING ? 'both-changed' : 'changed-and-removed');
    return remote;
  }

  const b = base === MISSING ? undefined : base;
  switch (shape.t) {
    case 'struct':
      if (isObject(edited) && isObject(remote)) return mergeStruct(shape.fields, path, b, edited, remote, out);
      break;
    case 'record':
      if (isObject(edited) && isObject(remote)) return mergeRecord(shape.of, path, b, edited, remote, out);
      break;
    case 'keyed':
      if (Array.isArray(edited) && Array.isArray(remote)) return mergeKeyed(shape, path, b, edited, remote, out);
      break;
  }
  conflict(out, path, 'both-changed');
  return remote;
}

function mergeStruct(
  fields: Record<string, Shape>,
  path: string,
  base: Value,
  edited: Record<string, unknown>,
  remote: Record<string, unknown>,
  out: WorkspaceMergeConflict[],
): Record<string, unknown> {
  const b = isObject(base) ? base : undefined;
  const result: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(fields)) {
    // A struct's own fields are never MISSING: an unset optional field is
    // `undefined` on that side, and comparing it is an ordinary leaf compare.
    const v = merge(s, label(path, k), b ? b[k] : undefined, edited[k], remote[k], out);
    if (v !== undefined) result[k] = v;
  }
  return result;
}

function mergeRecord(
  of: Shape,
  path: string,
  base: Value,
  edited: Record<string, unknown>,
  remote: Record<string, unknown>,
  out: WorkspaceMergeConflict[],
): Record<string, unknown> {
  const b = isObject(base) ? base : {};
  const result: Record<string, unknown> = {};
  // Remote's key order first, then keys only the edit added: an unchanged
  // record keeps its order, so an unchanged document writes back identically.
  const keys = [...new Set([...Object.keys(remote), ...Object.keys(edited), ...Object.keys(b)])];
  for (const k of keys) {
    const at = (o: Record<string, unknown>) => (k in o ? o[k] : MISSING);
    const v = merge(of, `${path}[${JSON.stringify(k)}]`, at(b), at(edited), at(remote), out);
    if (v !== MISSING) result[k] = v;
  }
  return result;
}

function mergeKeyed(
  shape: Extract<Shape, { t: 'keyed' }>,
  path: string,
  base: Value,
  edited: unknown[],
  remote: unknown[],
  out: WorkspaceMergeConflict[],
): unknown[] {
  const idOf = (x: unknown) => (isObject(x) ? String(x[shape.key]) : JSON.stringify(x));
  const index = (xs: unknown[]) => new Map(xs.map((x) => [idOf(x), x] as const));
  const baseList = Array.isArray(base) ? base : [];
  const B = index(baseList);
  const E = index(edited);
  const R = index(remote);

  const items = new Map<string, unknown>();
  for (const id of new Set([...R.keys(), ...E.keys(), ...B.keys()])) {
    const at = (m: Map<string, unknown>) => (m.has(id) ? m.get(id) : MISSING);
    const v = merge(shape.of, `${path}[${JSON.stringify(id)}]`, at(B), at(E), at(R), out);
    if (v !== MISSING) items.set(id, v);
  }

  // Order: whichever side reordered the items both sides still share wins;
  // if both reordered them differently, that is a conflict.
  const shared = (ids: string[]) => ids.filter((id) => B.has(id) && E.has(id) && R.has(id));
  const baseOrder = shared(baseList.map(idOf));
  const editOrder = shared(edited.map(idOf));
  const remoteOrder = shared(remote.map(idOf));
  const editMoved = !same(editOrder, baseOrder);
  const remoteMoved = !same(remoteOrder, baseOrder);
  if (editMoved && remoteMoved && !same(editOrder, remoteOrder)) conflict(out, path, 'order-changed');

  const [primary, secondary] = editMoved && !remoteMoved ? [edited, remote] : [remote, edited];
  const order: string[] = [];
  for (const id of [...primary.map(idOf), ...secondary.map(idOf)]) {
    if (items.has(id) && !order.includes(id)) order.push(id);
  }
  return order.map((id) => items.get(id));
}
