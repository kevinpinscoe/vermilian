import { describe, it, expect } from 'vitest';
import { masterPlanBannerCopy } from './masterPlanBanner';

describe('masterPlanBannerCopy', () => {
  it('returns null for none — a missing article is a supported empty state, not an error', () => {
    expect(masterPlanBannerCopy({ kind: 'none' })).toBeNull();
  });

  it('returns null for a cleanly loaded article with no diagnostics', () => {
    expect(
      masterPlanBannerCopy({
        kind: 'loaded', articleId: '1', updated: 1, outcomes: [], diagnostics: [], parseStatus: 'valid',
      }),
    ).toBeNull();
  });

  it('warns about duplicate articles without guessing which is current', () => {
    const copy = masterPlanBannerCopy({ kind: 'ambiguous-articles', articleIds: ['a1', 'a2'] });
    expect(copy).not.toBeNull();
    expect(copy?.text).toContain('2 articles');
    expect(copy?.text).toContain('still work');
  });

  it('warns on a discovery-error', () => {
    const copy = masterPlanBannerCopy({ kind: 'discovery-error' });
    expect(copy).not.toBeNull();
    expect(copy?.title.toLowerCase()).toContain("couldn't load");
  });

  it('warns on discovery-incomplete, distinctly from discovery-error', () => {
    const errorCopy = masterPlanBannerCopy({ kind: 'discovery-error' });
    const incompleteCopy = masterPlanBannerCopy({ kind: 'discovery-incomplete' });
    expect(incompleteCopy).not.toBeNull();
    expect(incompleteCopy?.title).not.toBe(errorCopy?.title);
  });

  it('warns on a partial parse and includes the diagnostic message', () => {
    const copy = masterPlanBannerCopy({
      kind: 'loaded',
      articleId: '1',
      updated: 1,
      outcomes: [],
      diagnostics: [{ kind: 'missing-field', outcome: 'X', message: '"X" is missing: Risks / dependencies.' }],
      parseStatus: 'partial',
    });
    expect(copy).not.toBeNull();
    expect(copy?.text).toContain('"X" is missing: Risks / dependencies.');
  });

  it('uses a distinct title for an unusable article versus a partial one', () => {
    const partial = masterPlanBannerCopy({
      kind: 'loaded', articleId: '1', updated: 1, outcomes: [],
      diagnostics: [{ kind: 'missing-field', outcome: 'X', message: 'x' }], parseStatus: 'partial',
    });
    const unusable = masterPlanBannerCopy({
      kind: 'loaded', articleId: '1', updated: 1, outcomes: [],
      diagnostics: [{ kind: 'no-outcome-sections', message: 'x' }], parseStatus: 'unusable',
    });
    expect(partial?.title).not.toBe(unusable?.title);
  });

  it('explains each workspace-reference failure, naming the article but never guessing another (VERM-48)', () => {
    expect(masterPlanBannerCopy({ kind: 'reference-not-found', articleId: 'VERM-A-9' })?.text).toMatch(/VERM-A-9.*no such article/);
    expect(masterPlanBannerCopy({ kind: 'reference-inaccessible', articleId: 'VERM-A-9' })?.text).toMatch(/not allowed to read VERM-A-9/);
    expect(masterPlanBannerCopy({ kind: 'reference-error', articleId: 'VERM-A-9' })?.text).toMatch(/Reading VERM-A-9/);
    expect(masterPlanBannerCopy({ kind: 'reference-error', articleId: '' })?.text).toMatch(/not a valid article ID/);
    expect(masterPlanBannerCopy({ kind: 'reference-unsupported' })?.title).toMatch(/Jira/);
  });
});
