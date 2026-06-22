// Pure helpers for AI task extraction. Extracted from claude.ts so the
// model-independent logic can be unit-tested without the Anthropic SDK.

// Match a model-extracted project name to a known project. Matching is
// case-insensitive and bidirectionally fuzzy (either name contains the other).
// Returns projectMatchError=true only when a non-empty name was given but
// matched nothing — an absent name is not an error.
export function matchProjectByName(
  rawProject: string | null | undefined,
  projects: { id: string; name: string }[],
): { projectId: string | null; projectMatchError: boolean } {
  const trimmed = typeof rawProject === 'string' ? rawProject.trim() : '';
  if (!trimmed) return { projectId: null, projectMatchError: false };

  const lower = trimmed.toLowerCase();
  const matched = projects.find(
    (p) =>
      p.name.toLowerCase() === lower ||
      p.name.toLowerCase().includes(lower) ||
      lower.includes(p.name.toLowerCase()),
  );
  return matched
    ? { projectId: matched.id, projectMatchError: false }
    : { projectId: null, projectMatchError: true };
}
