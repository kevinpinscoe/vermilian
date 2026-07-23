// Pure helpers for building YouTrack issue-search queries, scoped to a set of
// projects. Kept in shared/ (no Electron, no fetch) so both the main-process
// REST client and unit tests can import it.

/**
 * Build a YouTrack search query that restricts results to the given projects
 * and applies the user's free-text terms.
 *
 * The scope is one or more project short names — a single active project, or
 * every project in the active workspace. Each is wrapped in `{…}` so short
 * names are matched exactly, and joined with commas (YouTrack's OR for the
 * `project:` field, the same shape the stand-up query uses).
 *
 * The user's text is passed through as YouTrack full-text terms (matching
 * summary, description, and comments). Surrounding whitespace is trimmed and
 * internal runs collapsed to single spaces.
 *
 * Returns null when there are no projects in scope or the query is empty after
 * trimming — the caller should short-circuit and return no results rather than
 * round-trip a `project: ` query YouTrack can't parse (400).
 */
export function buildIssueSearchQuery(
  projectShortNames: string[] | null | undefined,
  rawQuery: string,
): string | null {
  const projects = (projectShortNames ?? [])
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s));
  if (!projects.length) return null;
  const terms = rawQuery.trim().replace(/\s+/g, ' ');
  if (!terms) return null;
  const projectPart = projects.map((s) => `{${s}}`).join(',');
  return `project: ${projectPart} ${terms}`;
}
