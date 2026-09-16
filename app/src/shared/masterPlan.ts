// Pure parsing and Epic→outcome association for the _vermilian-master-plan
// Knowledge Base article (docs/adr/0008-master-plan-storage.md). No
// Electron, no YouTrack client — safe to import in either process or in
// unit tests.
//
// The article is human-maintained Markdown, read-only from Vermilian's
// side: Vermilian finds, reads, parses, and displays it, but never creates,
// overwrites, or auto-repairs it. Malformed or incomplete content degrades
// to structured diagnostics rather than throwing, so a bad edit in YouTrack
// never breaks Priority Desk or ordinary task display.

export interface Outcome {
  name: string;
  // Epic idReadable references exactly as written in the article (display
  // form). Matching against a task's own BoardIssue.parentEpic.idReadable
  // goes through normalizeEpicRef, never against this raw text — see
  // resolveEpicOutcome below.
  activeEpics: string[];
  successMeasure: string | null;
  targetWindow: string | null;
  risks: string | null;
}

export type ParseDiagnosticKind =
  | 'no-outcome-sections'      // content has no `## <Outcome>` heading at all
  | 'missing-field'            // an outcome section is missing one of the four fields
  | 'unparseable-section'      // a `##` heading with no recognizable field lines under it
  | 'duplicate-epic-outcome';  // the same Epic idReadable appears under >1 outcome

export interface ParseDiagnostic {
  kind: ParseDiagnosticKind;
  // The outcome section a diagnostic is about, for missing-field and
  // unparseable-section — absent for no-outcome-sections (about the whole
  // document) and duplicate-epic-outcome (about an Epic spanning several).
  outcome?: string;
  // The Epic idReadable (as written in the article) a duplicate-epic-outcome
  // diagnostic is about, and every outcome name it appears under.
  epicRef?: string;
  outcomes?: string[];
  message: string;
}

export type ParseStatus = 'valid' | 'partial' | 'unusable';

export interface ParseResult {
  status: ParseStatus;
  outcomes: Outcome[];
  diagnostics: ParseDiagnostic[];
}

const OUTCOME_HEADING_RE = /^##\s+(.+?)\s*$/;
const FIELD_RE = /^-\s*([A-Za-z /]+?)\s*:\s*(.*)$/;

function normalizeFieldLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Splits raw content into `##`-headed sections. Content before the first
// `##` — a `# Vermilian Master Plan` title line, or any other prose — is
// deliberately ignored rather than treated as a malformed section.
function splitSections(content: string): { name: string; lines: string[] }[] {
  const lines = content.split(/\r\n|\n/);
  const sections: { name: string; lines: string[] }[] = [];
  let current: { name: string; lines: string[] } | null = null;
  for (const line of lines) {
    const heading = OUTCOME_HEADING_RE.exec(line);
    if (heading) {
      current = { name: heading[1], lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections;
}

function parseSection(section: { name: string; lines: string[] }): {
  outcome: Outcome;
  diagnostics: ParseDiagnostic[];
} {
  const fields: Record<string, string> = {};
  for (const line of section.lines) {
    const m = FIELD_RE.exec(line);
    if (!m) continue;
    fields[normalizeFieldLabel(m[1])] = m[2].trim();
  }

  const activeEpicsRaw = fields['active epics'] ?? null;
  const successMeasure = fields['success measure'] ?? null;
  const targetWindow = fields['target window'] ?? null;
  // Tolerate both the documented spacing ("Risks / dependencies") and the
  // unspaced variant ("Risks/dependencies") — normalizeFieldLabel collapses
  // internal whitespace but does not remove the slash's surrounding spaces
  // on its own, since "active epics" vs "activeepics" should not collide.
  const risks = fields['risks / dependencies'] ?? fields['risks/dependencies'] ?? null;

  const activeEpics = (activeEpicsRaw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const diagnostics: ParseDiagnostic[] = [];
  const hasAnyField = Object.keys(fields).length > 0;
  if (!hasAnyField) {
    diagnostics.push({
      kind: 'unparseable-section',
      outcome: section.name,
      message:
        `"${section.name}" has no recognizable Active epics / Success measure / ` +
        'Target window / Risks fields.',
    });
  } else {
    const missing: string[] = [];
    if (activeEpicsRaw === null) missing.push('Active epics');
    if (successMeasure === null) missing.push('Success measure');
    if (targetWindow === null) missing.push('Target window');
    if (risks === null) missing.push('Risks / dependencies');
    if (missing.length > 0) {
      diagnostics.push({
        kind: 'missing-field',
        outcome: section.name,
        message: `"${section.name}" is missing: ${missing.join(', ')}.`,
      });
    }
  }

  return {
    outcome: { name: section.name, activeEpics, successMeasure, targetWindow, risks },
    diagnostics,
  };
}

// The same Epic idReadable listed under more than one outcome is ambiguous
// — never resolved by picking the first outcome that mentions it (VERM-7
// review correction, 2026-09-16). Comparison is case-insensitive/trimmed
// (normalizeEpicRef); the diagnostic still reports the epic exactly as
// first written, for readability.
function findDuplicateEpicOutcomes(outcomes: Outcome[]): ParseDiagnostic[] {
  const seen = new Map<string, { display: string; outcomes: string[] }>();
  for (const outcome of outcomes) {
    for (const epicRef of outcome.activeEpics) {
      const key = normalizeEpicRef(epicRef);
      const entry = seen.get(key);
      if (entry) {
        if (!entry.outcomes.includes(outcome.name)) entry.outcomes.push(outcome.name);
      } else {
        seen.set(key, { display: epicRef, outcomes: [outcome.name] });
      }
    }
  }
  const diagnostics: ParseDiagnostic[] = [];
  for (const { display, outcomes: names } of seen.values()) {
    if (names.length > 1) {
      diagnostics.push({
        kind: 'duplicate-epic-outcome',
        epicRef: display,
        outcomes: names,
        message:
          `${display} is listed as an active epic under more than one outcome ` +
          `(${names.join(', ')}); its outcome association is ambiguous.`,
      });
    }
  }
  return diagnostics;
}

export function parseMasterPlan(content: string): ParseResult {
  const sections = splitSections(content);
  if (sections.length === 0) {
    return {
      status: 'unusable',
      outcomes: [],
      diagnostics: [
        { kind: 'no-outcome-sections', message: 'No "## <Outcome>" sections found in the article.' },
      ],
    };
  }

  const outcomes: Outcome[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  let anyUsableSection = false;
  for (const section of sections) {
    const { outcome, diagnostics: sectionDiagnostics } = parseSection(section);
    outcomes.push(outcome);
    diagnostics.push(...sectionDiagnostics);
    if (!sectionDiagnostics.some((d) => d.kind === 'unparseable-section')) anyUsableSection = true;
  }

  diagnostics.push(...findDuplicateEpicOutcomes(outcomes));

  const status: ParseStatus = !anyUsableSection ? 'unusable' : diagnostics.length > 0 ? 'partial' : 'valid';
  return { status, outcomes, diagnostics };
}

// Matching key for an Epic reference — trimmed and case-folded, so
// "verm-3" in the article matches BoardIssue.parentEpic.idReadable "VERM-3"
// without either side needing to agree on case. Never used for display:
// the article's own text and YouTrack's own idReadable casing are always
// shown verbatim (VERM-7 review correction, 2026-09-16).
export function normalizeEpicRef(raw: string): string {
  return raw.trim().toLowerCase();
}

export type EpicOutcomeResolution =
  | { kind: 'none' }
  | { kind: 'found'; outcome: Outcome }
  | { kind: 'conflict'; outcomes: Outcome[] };

// Resolves which Master Plan outcome (if any) a task's parent Epic belongs
// to. `epicIdReadable` must be the native YouTrack idReadable — the same
// value already shown on the card — never a value read from the article
// itself.
export function resolveEpicOutcome(outcomes: Outcome[], epicIdReadable: string): EpicOutcomeResolution {
  const key = normalizeEpicRef(epicIdReadable);
  const matches = outcomes.filter((o) => o.activeEpics.some((e) => normalizeEpicRef(e) === key));
  if (matches.length === 0) return { kind: 'none' };
  if (matches.length > 1) return { kind: 'conflict', outcomes: matches };
  return { kind: 'found', outcome: matches[0] };
}

// ─── Discovery + parse, composed for the renderer ──────────────────────────

export type MasterPlanState =
  | { kind: 'none' }
  // Every matching article's internal id, so the signature below changes if
  // the *set* of duplicates changes, not just its count.
  | { kind: 'ambiguous-articles'; articleIds: string[] }
  // A request failed outright — never collapsed into 'none'.
  | { kind: 'discovery-error' }
  // Every request succeeded, but completeness could not be established
  // within the pagination safety cap — distinct from both 'none' and
  // 'discovery-error' so a bounded search is never read as proof of
  // absence or uniqueness.
  | { kind: 'discovery-incomplete' }
  | {
      kind: 'loaded';
      articleId: string;
      updated: number;
      outcomes: Outcome[];
      diagnostics: ParseDiagnostic[];
      parseStatus: ParseStatus;
    };

// A stable string that changes whenever the underlying problem changes —
// a different diagnostic kind, a different malformed section, a different
// set of ambiguous articles, or (for a loaded article) a new revision via
// `updated` — and is null whenever there is nothing to warn about. Used to
// scope the Priority Desk banner's dismissal to "this exact problem", so a
// dismissed banner reappears on a new problem or a changed article even if
// the previous one was dismissed (VERM-7 review correction, 2026-09-16).
export function masterPlanDiagnosticSignature(state: MasterPlanState): string | null {
  switch (state.kind) {
    case 'none':
      return null;
    case 'ambiguous-articles':
      return `ambiguous:${[...state.articleIds].sort().join(',')}`;
    case 'discovery-error':
      return 'discovery-error';
    case 'discovery-incomplete':
      return 'discovery-incomplete';
    case 'loaded': {
      if (state.parseStatus === 'valid' && state.diagnostics.length === 0) return null;
      const diagKey = state.diagnostics
        .map((d) => `${d.kind}:${d.outcome ?? d.epicRef ?? ''}`)
        .sort()
        .join('|');
      return `loaded:${state.articleId}:${state.updated}:${state.parseStatus}:${diagKey}`;
    }
    default:
      return null;
  }
}
