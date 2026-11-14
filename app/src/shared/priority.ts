// Priority values and their sort order, per project (VERM-30).
//
// YouTrack has one shared Priority bundle (FIELD_DEFS.priority.options). A
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
