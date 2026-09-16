import { describe, it, expect } from 'vitest';
import {
  parseMasterPlan,
  resolveEpicOutcome,
  masterPlanDiagnosticSignature,
  normalizeEpicRef,
  type MasterPlanState,
} from './masterPlan';

// The exact content the VERM-7 Master Plan article was created with.
const WELL_FORMED = `# Vermilian Master Plan

## Build the Priority Desk

- Active epics: VERM-3
- Success measure: Vermilian provides a trusted, human-controlled workflow for selecting current work.
- Target window: 2026 Q3–Q4
- Risks / dependencies: Manual Desk behavior must be trusted before enabling AI recommendations.
`;

describe('parseMasterPlan — well-formed content', () => {
  it('parses a single outcome with all four fields as valid', () => {
    const result = parseMasterPlan(WELL_FORMED);
    expect(result.status).toBe('valid');
    expect(result.diagnostics).toEqual([]);
    expect(result.outcomes).toEqual([
      {
        name: 'Build the Priority Desk',
        activeEpics: ['VERM-3'],
        successMeasure: 'Vermilian provides a trusted, human-controlled workflow for selecting current work.',
        targetWindow: '2026 Q3–Q4',
        risks: 'Manual Desk behavior must be trusted before enabling AI recommendations.',
      },
    ]);
  });

  it('ignores prose before the first ## heading, such as a # title line', () => {
    const result = parseMasterPlan(WELL_FORMED);
    expect(result.outcomes).toHaveLength(1);
  });

  it('parses multiple outcome sections independently', () => {
    const content =
      '## Outcome A\n' +
      '- Active epics: VERM-1, VERM-2\n' +
      '- Success measure: A measure\n' +
      '- Target window: 2026 Q1\n' +
      '- Risks / dependencies: none noted\n' +
      '\n' +
      '## Outcome B\n' +
      '- Active epics: VERM-9\n' +
      '- Success measure: B measure\n' +
      '- Target window: 2026 Q2\n' +
      '- Risks / dependencies: none noted\n';
    const result = parseMasterPlan(content);
    expect(result.status).toBe('valid');
    expect(result.outcomes.map((o) => o.name)).toEqual(['Outcome A', 'Outcome B']);
    expect(result.outcomes[0].activeEpics).toEqual(['VERM-1', 'VERM-2']);
  });

  it('trims whitespace and drops blank entries in a comma-separated Active epics list', () => {
    const content = '## Outcome\n- Active epics:  VERM-1 ,, VERM-2 ,\n- Success measure: x\n- Target window: x\n- Risks / dependencies: x\n';
    const result = parseMasterPlan(content);
    expect(result.outcomes[0].activeEpics).toEqual(['VERM-1', 'VERM-2']);
  });

  it('does not infer an Epic identifier from arbitrary prose outside Active epics', () => {
    const content =
      '## Outcome\n' +
      '- Active epics: VERM-1\n' +
      '- Success measure: mentions VERM-99 in passing, which is not a reference\n' +
      '- Target window: x\n' +
      '- Risks / dependencies: x\n';
    const result = parseMasterPlan(content);
    expect(result.outcomes[0].activeEpics).toEqual(['VERM-1']);
  });
});

describe('parseMasterPlan — malformed and partial content', () => {
  it('reports no-outcome-sections and status unusable for content with no ## heading', () => {
    const result = parseMasterPlan('Just some prose, no headings at all.');
    expect(result.status).toBe('unusable');
    expect(result.outcomes).toEqual([]);
    expect(result.diagnostics).toEqual([
      { kind: 'no-outcome-sections', message: expect.any(String) },
    ]);
  });

  it('reports missing-field and status partial when one field is absent, but still returns the outcome', () => {
    const content = '## Outcome\n- Active epics: VERM-1\n- Success measure: x\n- Target window: x\n';
    const result = parseMasterPlan(content);
    expect(result.status).toBe('partial');
    expect(result.outcomes).toEqual([
      { name: 'Outcome', activeEpics: ['VERM-1'], successMeasure: 'x', targetWindow: 'x', risks: null },
    ]);
    expect(result.diagnostics).toEqual([
      { kind: 'missing-field', outcome: 'Outcome', message: expect.stringContaining('Risks / dependencies') },
    ]);
  });

  it('reports unparseable-section and status unusable for a heading with no recognizable fields at all', () => {
    const content = '## Outcome\nJust some unrelated prose under the heading.\n';
    const result = parseMasterPlan(content);
    expect(result.status).toBe('unusable');
    expect(result.diagnostics).toEqual([
      { kind: 'unparseable-section', outcome: 'Outcome', message: expect.any(String) },
    ]);
  });

  it('a malformed section does not prevent a well-formed sibling section from still displaying (status partial, not unusable)', () => {
    const content =
      '## Good Outcome\n' +
      '- Active epics: VERM-1\n' +
      '- Success measure: x\n' +
      '- Target window: x\n' +
      '- Risks / dependencies: x\n' +
      '\n' +
      '## Bad Outcome\n' +
      'unrelated prose, no fields\n';
    const result = parseMasterPlan(content);
    expect(result.status).toBe('partial');
    expect(result.outcomes.map((o) => o.name)).toEqual(['Good Outcome', 'Bad Outcome']);
    expect(result.outcomes[0]).toEqual({
      name: 'Good Outcome', activeEpics: ['VERM-1'], successMeasure: 'x', targetWindow: 'x', risks: 'x',
    });
    expect(result.diagnostics.some((d) => d.kind === 'unparseable-section' && d.outcome === 'Bad Outcome')).toBe(true);
  });
});

describe('parseMasterPlan — duplicate Epic-to-outcome association', () => {
  it('flags an Epic listed under more than one outcome as a conflict, case-insensitively', () => {
    const content =
      '## Outcome A\n' +
      '- Active epics: VERM-3\n' +
      '- Success measure: x\n- Target window: x\n- Risks / dependencies: x\n' +
      '\n' +
      '## Outcome B\n' +
      '- Active epics: verm-3\n' +
      '- Success measure: y\n- Target window: y\n- Risks / dependencies: y\n';
    const result = parseMasterPlan(content);
    expect(result.status).toBe('partial');
    const dup = result.diagnostics.find((d) => d.kind === 'duplicate-epic-outcome');
    expect(dup).toBeDefined();
    expect(dup?.outcomes).toEqual(['Outcome A', 'Outcome B']);
  });

  it('does not flag the same Epic appearing twice within one outcome as a cross-outcome conflict', () => {
    const content = '## Outcome\n- Active epics: VERM-1, VERM-1\n- Success measure: x\n- Target window: x\n- Risks / dependencies: x\n';
    const result = parseMasterPlan(content);
    expect(result.diagnostics.some((d) => d.kind === 'duplicate-epic-outcome')).toBe(false);
  });
});

describe('normalizeEpicRef', () => {
  it('trims and lowercases for matching, without altering the caller-visible original', () => {
    expect(normalizeEpicRef('  VERM-3  ')).toBe('verm-3');
  });
});

describe('resolveEpicOutcome', () => {
  const outcomes = [
    { name: 'A', activeEpics: ['VERM-3'], successMeasure: null, targetWindow: null, risks: null },
    { name: 'B', activeEpics: ['VERM-9'], successMeasure: null, targetWindow: null, risks: null },
  ];

  it('returns none when the Epic is not referenced by any outcome', () => {
    expect(resolveEpicOutcome(outcomes, 'VERM-1')).toEqual({ kind: 'none' });
  });

  it('returns found, preserving the outcome exactly as parsed (idReadable casing untouched)', () => {
    expect(resolveEpicOutcome(outcomes, 'verm-3')).toEqual({ kind: 'found', outcome: outcomes[0] });
  });

  it('returns conflict — never the first match — when the Epic is listed under more than one outcome', () => {
    const conflicting = [
      { name: 'A', activeEpics: ['VERM-3'], successMeasure: null, targetWindow: null, risks: null },
      { name: 'B', activeEpics: ['verm-3'], successMeasure: null, targetWindow: null, risks: null },
    ];
    const result = resolveEpicOutcome(conflicting, 'VERM-3');
    expect(result.kind).toBe('conflict');
    if (result.kind === 'conflict') {
      expect(result.outcomes.map((o) => o.name)).toEqual(['A', 'B']);
    }
  });
});

describe('masterPlanDiagnosticSignature', () => {
  it('is null for none and for a cleanly loaded article', () => {
    expect(masterPlanDiagnosticSignature({ kind: 'none' })).toBeNull();
    expect(
      masterPlanDiagnosticSignature({
        kind: 'loaded', articleId: '1', updated: 1, outcomes: [], diagnostics: [], parseStatus: 'valid',
      }),
    ).toBeNull();
  });

  it('is non-null and stable for discovery-error and discovery-incomplete', () => {
    expect(masterPlanDiagnosticSignature({ kind: 'discovery-error' })).toBe('discovery-error');
    expect(masterPlanDiagnosticSignature({ kind: 'discovery-incomplete' })).toBe('discovery-incomplete');
  });

  it('changes when the set of ambiguous article ids changes', () => {
    const a: MasterPlanState = { kind: 'ambiguous-articles', articleIds: ['a1', 'a2'] };
    const b: MasterPlanState = { kind: 'ambiguous-articles', articleIds: ['a1', 'a3'] };
    expect(masterPlanDiagnosticSignature(a)).not.toBe(masterPlanDiagnosticSignature(b));
  });

  it('changes when a loaded article with diagnostics gets a new revision (updated timestamp)', () => {
    const diag = [{ kind: 'missing-field' as const, outcome: 'X', message: 'x' }];
    const a: MasterPlanState = {
      kind: 'loaded', articleId: '1', updated: 100, outcomes: [], diagnostics: diag, parseStatus: 'partial',
    };
    const b: MasterPlanState = { ...a, updated: 200 };
    expect(masterPlanDiagnosticSignature(a)).not.toBe(masterPlanDiagnosticSignature(b));
  });
});

describe('parseMasterPlan — refresh replaces stale outcomes (no internal caching)', () => {
  it('two calls with different content produce independent, non-stale results', () => {
    const first = parseMasterPlan(
      '## Old Outcome\n- Active epics: VERM-1\n- Success measure: x\n- Target window: x\n- Risks / dependencies: x\n',
    );
    const second = parseMasterPlan(
      '## New Outcome\n- Active epics: VERM-2\n- Success measure: y\n- Target window: y\n- Risks / dependencies: y\n',
    );
    expect(first.outcomes.map((o) => o.name)).toEqual(['Old Outcome']);
    expect(second.outcomes.map((o) => o.name)).toEqual(['New Outcome']);
  });
});
