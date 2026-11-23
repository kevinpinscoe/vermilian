import { describe, expect, it } from 'vitest';
import { comparePriority, isYouTrackShortName, jiraPriorityOrder, priorityOrdinal, youtrackPriorityOrder } from './priority';
import { PRIORITY_OPTIONS } from './workspace';

// Fictional values only. A scheme shaped like a site's seven-value one, which
// differs from the YouTrack list both in its values and in its order.
const SCHEME = ['Critical', 'Highest', 'High', 'Medium', 'Low', 'Lowest', 'None'];

const allowed = (...names: unknown[]) => ({ priority: { allowedValues: names.map((name, i) => ({ id: String(i + 1), name })) } });

describe('jiraPriorityOrder — values and order from allowedValues', () => {
  it("takes the values in the scheme's own order", () => {
    expect(jiraPriorityOrder(allowed(...SCHEME))).toEqual(SCHEME);
    expect(jiraPriorityOrder(allowed('Lowest', 'Highest'))).toEqual(['Lowest', 'Highest']);
  });

  it('is not the YouTrack list', () => {
    const order = jiraPriorityOrder(allowed(...SCHEME))!;
    expect(order).not.toEqual([...PRIORITY_OPTIONS]);
    expect(order.filter((v) => (PRIORITY_OPTIONS as readonly string[]).includes(v))).toEqual(['Critical']);
  });

  it('drops nameless and repeated values', () => {
    expect(jiraPriorityOrder(allowed('High', '', null, 7, 'High', 'Low'))).toEqual(['High', 'Low']);
  });

  it('is null when priority is not on the screen', () => {
    expect(jiraPriorityOrder({})).toBeNull();
    expect(jiraPriorityOrder({ summary: {} })).toBeNull();
    expect(jiraPriorityOrder({ priority: {} })).toBeNull();
    expect(jiraPriorityOrder({ priority: { allowedValues: [] } })).toBeNull();
    expect(jiraPriorityOrder(null)).toBeNull();
    expect(jiraPriorityOrder(undefined)).toBeNull();
  });
});

describe('priorityOrdinal / comparePriority — sorting by a project order', () => {
  it("sorts by the project's order, most urgent first", () => {
    const values = ['Low', 'None', 'Critical', 'Medium', 'Highest'];
    expect([...values].sort((a, b) => comparePriority(a, b, SCHEME))).toEqual(['Critical', 'Highest', 'Medium', 'Low', 'None']);
  });

  it('gives different orders for different projects', () => {
    const reversed = [...SCHEME].reverse();
    expect(comparePriority('Highest', 'Low', SCHEME)).toBeLessThan(0);
    expect(comparePriority('Highest', 'Low', reversed)).toBeGreaterThan(0);
  });

  it('puts an unlisted value after listed ones, by name, and no priority last', () => {
    const values = [null, 'Zeta', 'Low', undefined, 'Alpha', 'Critical'];
    expect([...values].sort((a, b) => comparePriority(a, b, SCHEME))).toEqual(['Critical', 'Low', 'Alpha', 'Zeta', null, undefined]);
    expect(priorityOrdinal('Zeta', SCHEME)).toBe(SCHEME.length);
    expect(priorityOrdinal(null, SCHEME)).toBe(SCHEME.length + 1);
  });

  it('with an empty order (scheme unknown), sorts by name with no priority last', () => {
    const values = ['Medium', null, 'High', 'Low'];
    expect([...values].sort((a, b) => comparePriority(a, b, []))).toEqual(['High', 'Low', 'Medium', null]);
  });

  it('reproduces the YouTrack order when given the YouTrack list', () => {
    const shuffled = ['Minor', 'Show-stopper', 'Normal', 'Major', 'Critical'];
    expect(shuffled.sort((a, b) => comparePriority(a, b, PRIORITY_OPTIONS))).toEqual([...PRIORITY_OPTIONS]);
  });
});

describe('youtrackPriorityOrder (VERM-92)', () => {
  const field = (name: string, values: Array<{ name?: unknown; ordinal?: unknown } | null>) => ({ field: { name }, bundle: { values } });

  it("returns the Priority bundle's values by ordinal, most urgent first", () => {
    expect(youtrackPriorityOrder([
      field('Type', [{ name: 'Bug', ordinal: 0 }]),
      field('Priority', [{ name: 'Normal', ordinal: 2 }, { name: 'Minor', ordinal: 0 }, { name: 'Critical', ordinal: 1 }]),
    ])).toEqual(['Minor', 'Critical', 'Normal']);
  });

  it('keeps the listed order for equal or missing ordinals and drops blanks and duplicates', () => {
    expect(youtrackPriorityOrder([
      field('Priority', [{ name: 'B' }, null, { name: '' }, { name: 'A' }, { name: 'B' }, { name: 'C', ordinal: 0 }]),
    ])).toEqual(['C', 'B', 'A']);
  });

  it('is null with no Priority field or no values', () => {
    expect(youtrackPriorityOrder([field('Type', [{ name: 'Bug' }])])).toBeNull();
    expect(youtrackPriorityOrder([field('Priority', [])])).toBeNull();
    expect(youtrackPriorityOrder(null)).toBeNull();
  });

  it('accepts only path-safe project short names', () => {
    expect(isYouTrackShortName('READ')).toBe(true);
    expect(isYouTrackShortName('TST2')).toBe(true);
    for (const bad of ['', '../x', 'a/b', 'A B', 'A?b', 7, null]) expect(isYouTrackShortName(bad)).toBe(false);
  });
});
