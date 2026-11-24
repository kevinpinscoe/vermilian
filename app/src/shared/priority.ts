// Priority values and their sort order, per project (VERM-30).
//
// A YouTrack project's Priority values come from its own field (VERM-92,
// VERM-117), most urgent first. A
// Jira project's values come from its priority scheme, which only a site
// admin controls and which differs by project (proposal §3, "Ticket
// priority"): the order is the scheme's own, most urgent first, as editmeta's
// allowedValues lists it. Sorting reads that order and never the YouTrack
// list for a Jira project.
//
// Pure TypeScript: no Electron, no React.

/** A project's priority values, most urgent first. */
export type PriorityOrder = readonly string[];

/**
 * The position of `priority` in `order`. A value the order does not list (a
 * scheme changed since it was read) sorts after every listed value, and no
 * priority at all sorts last of everything.
 */
export function priorityOrdinal(priority: string | null | undefined, order: PriorityOrder): number {
  if (!priority) return order.length + 1;
  const idx = order.indexOf(priority);
  return idx === -1 ? order.length : idx;
}

/** Most urgent first; unlisted values after listed ones, by name; none last. */
export function comparePriority(a: string | null | undefined, b: string | null | undefined, order: PriorityOrder): number {
  const d = priorityOrdinal(a, order) - priorityOrdinal(b, order);
  if (d !== 0) return d;
  return a && b && a !== b ? a.localeCompare(b) : 0;
}

/** One field in editmeta / createmeta, as far as priority reads it. */
export interface JiraAllowedValuesField {
  allowedValues?: Array<{ id?: unknown; name?: unknown } | null> | null;
}

/**
 * The project's priority values from editmeta (or createmeta) field metadata:
 * `fields.priority.allowedValues` names in scheme order, de-duplicated. null
 * when priority is not on the screen — the project has no priority field, or
 * the user cannot edit the issue the metadata came from.
 */
export function jiraPriorityOrder(fields: Record<string, JiraAllowedValuesField | null | undefined> | null | undefined): string[] | null {
  const allowed = fields?.priority?.allowedValues;
  if (!Array.isArray(allowed)) return null;
  const names: string[] = [];
  for (const v of allowed) {
    const name = v && typeof v.name === 'string' ? v.name : '';
    if (name && !names.includes(name)) names.push(name);
  }
  return names.length ? names : null;
}

/** One project custom field, as far as the YouTrack Priority order reads it. */
export interface YouTrackProjectCustomField {
  field?: { name?: unknown } | null;
  bundle?: { values?: Array<{ name?: unknown; ordinal?: unknown } | null> | null } | null;
}

/**
 * A YouTrack project's Priority values in its own bundle's order (VERM-92),
 * from `/api/admin/projects/{id}/customFields?fields=field(name),bundle(values(name,ordinal))`:
 * by `ordinal`, most urgent first, de-duplicated. Archived values stay in
 * place, since issues can still carry them. null when the project has no
 * Priority field or its bundle lists no values.
 */
export function youtrackPriorityOrder(fields: readonly (YouTrackProjectCustomField | null)[] | null | undefined): string[] | null {
  const priority = (fields ?? []).find((f) => f?.field?.name === 'Priority');
  const values = priority?.bundle?.values;
  if (!Array.isArray(values)) return null;
  const ranked = values
    .map((v, i) => ({
      name: v && typeof v.name === 'string' ? v.name : '',
      ordinal: v && typeof v.ordinal === 'number' ? v.ordinal : Number.MAX_SAFE_INTEGER,
      i,
    }))
    .filter((v) => v.name)
    .sort((a, b) => a.ordinal - b.ordinal || a.i - b.i);
  const names: string[] = [];
  for (const v of ranked) if (!names.includes(v.name)) names.push(v.name);
  return names.length ? names : null;
}

/** A YouTrack project short name safe to put in a request path. */
export function isYouTrackShortName(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value);
}
