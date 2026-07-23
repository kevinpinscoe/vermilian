// Pure helpers for building YouTrack issue-search queries, scoped to a single
// project. Kept in shared/ (no Electron, no fetch) so both the main-process
// REST client and unit tests can import it.

/**
 * Build a YouTrack search query that restricts results to a single project and
 * applies the user's free-text terms.
 *
 * The user's text is passed through as YouTrack full-text terms (matching
 * summary, description, and comments). Surrounding whitespace is trimmed and
 * internal runs collapsed to single spaces.
 *
 * Returns null when there is no project scope or the query is empty after
 * trimming — the caller should short-circuit and return no results rather than
 * round-trip a `project: ` query YouTrack can't parse (400).
 */
export function buildIssueSearchQuery(
  projectShortName: string | null | undefined,
  rawQuery: string,
): string | null {
  const project = projectShortName?.trim();
  if (!project) return null;
  const terms = rawQuery.trim().replace(/\s+/g, ' ');
  if (!terms) return null;
  return `project: ${project} ${terms}`;
}
