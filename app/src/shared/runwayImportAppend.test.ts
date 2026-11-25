import { describe, expect, it } from 'vitest';
import type { RunwayImportApplyRow } from './runwayImport';
import { planRunwayAppend, sameDestinationRows, type RunwayDestinationRow, type RunwaySavedIdentity } from './runwayImportAppend';

// Synthetic keys only.
const t = (key: string, line: number, tracker = 'yt'): RunwayImportApplyRow => ({ kind: 'ticket', issueId: `${tracker}:${key}`, text: key, line });
const sec = (text: string, line: number, depth = 0): RunwayImportApplyRow => ({ kind: 'section', text, depth, line });
const note = (text: string, line: number, depth = 0): RunwayImportApplyRow => ({ kind: 'note', text, depth, line });
const dIssue = (itemId: string): RunwayDestinationRow => ({ itemId, kind: 'issue', text: null, depth: 0 });
const dSec = (text: string, id: string, depth = 0): RunwayDestinationRow => ({ itemId: `sec:${id}`, kind: 'section', text, depth });
const dNote = (text: string, id: string, depth = 0): RunwayDestinationRow => ({ itemId: `note:${id}`, kind: 'note', text, depth });
const ok = (itemId: string, key: string, aliases: string[] = [itemId]): RunwaySavedIdentity => ({ itemId, state: 'resolved', key, aliases });
const ids = (...list: RunwaySavedIdentity[]) => Object.fromEntries(list.map((i) => [i.itemId, i]));

describe('planRunwayAppend (VERM-105)', () => {
  it('an empty Runway takes every row, tickets numbered from #1', () => {
    const rows = [note('Intro', 1), t('READ-1', 2), sec('Later', 3), t('READ-2', 4)];
    const p = planRunwayAppend(rows, [], [], {});
    expect(p.append).toEqual([0, 1, 2, 3]);
    expect(p.rows.map((r) => r.runwayNumber)).toEqual([null, 1, null, 2]);
    expect(p).toMatchObject({ absent: [], unverified: [], unableToVerify: false });
  });

  it('spec 2: READ-20 moved to #1 and a new key in the file — existing tickets keep their numbers, only the new key is appended', () => {
    const destination = [dIssue('yt:READ-20'), dIssue('yt:READ-12'), dIssue('yt:SYNC-3'), dSec('Later', 'a'), dNote('Look again', 'b')];
    const identities = ids(ok('yt:READ-20', 'READ-20'), ok('yt:READ-12', 'READ-12'), ok('yt:SYNC-3', 'SYNC-3'));
    const rows = [t('READ-12', 1), t('SYNC-3', 2), t('READ-20', 3), t('PLAT-1', 4), sec('Later', 5), note('Look again', 6)];
    const p = planRunwayAppend(rows, [], destination, identities);
    expect(p.append).toEqual([3]);
    expect(p.rows.map((r) => [r.present, r.runwayNumber])).toEqual([
      [true, 2],
      [true, 3],
      [true, 1],
      [false, 4],
      [true, null],
      [true, null],
    ]);
  });

  it('spec 16: the same file again adds nothing', () => {
    const rows = [note('Intro', 1), t('READ-1', 2), sec('Later', 3), note('Later note', 4)];
    const destination = [dNote('Intro', 'n1'), dIssue('yt:READ-1'), dSec('Later', 's1'), dNote('Later note', 'n2')];
    expect(planRunwayAppend(rows, [], destination, ids(ok('yt:READ-1', 'READ-1'))).append).toEqual([]);
  });

  it('spec 18 and occurrences: two Later sections with the same note match two by two; a third Later in the file is the only one appended', () => {
    const destination = [dSec('Later', 's1'), dNote('Same note', 'n1'), dSec('Later', 's2'), dNote('Same note', 'n2')];
    const twice = [sec('Later', 1), note('Same note', 2), sec('Later', 3), note('Same note', 4)];
    expect(planRunwayAppend(twice, [], destination, {}).append).toEqual([]);
    const thrice = [...twice, sec('Later', 5), note('Same note', 6)];
    expect(planRunwayAppend(thrice, [], destination, {}).append).toEqual([4, 5]);
  });

  it('depth is ignored; trailing whitespace is ignored; case, leading whitespace and inner spacing count', () => {
    const destination = [dSec('Later', 's1', 2), dNote('A  note', 'n1')];
    const rows = [sec('Later  ', 1, 0), note('A  note\t', 2), note('a  note', 3), note(' A  note', 4), note('A note', 5)];
    expect(planRunwayAppend(rows, [], destination, {}).append).toEqual([2, 3, 4]);
  });

  it('the harder direction: the Runway stores jira:DEMO-101, the file has only DEMO-150, and reading the old key answers the new one', () => {
    const destination = [dIssue('jira:DEMO-101')];
    const identities = ids(ok('jira:DEMO-101', 'DEMO-150', ['jira:DEMO-150', 'jira:DEMO-101']));
    const p = planRunwayAppend([t('DEMO-150', 1, 'jira')], [['jira:DEMO-150']], destination, identities);
    expect(p.append).toEqual([]);
    expect(p.rows[0]).toEqual({ present: true, runwayNumber: 1 });
    expect(p.absent).toEqual([]);
  });

  it('the other direction: the file’s ticket answered to the saved ID (an old key) and its stored ID is the new one', () => {
    const p = planRunwayAppend([t('DEMO-150', 1, 'jira')], [['jira:DEMO-150', 'jira:DEMO-101']], [dIssue('jira:DEMO-101')], ids(ok('jira:DEMO-101', 'DEMO-101')));
    expect(p.append).toEqual([]);
  });

  it('aliases are tracker-qualified: yt:OPS-7 never matches jira:OPS-7', () => {
    const p = planRunwayAppend([t('OPS-7', 1, 'jira')], [['jira:OPS-7']], [dIssue('yt:OPS-7')], ids(ok('yt:OPS-7', 'OPS-7')));
    expect(p.append).toEqual([0]);
    expect(p.absent).toEqual(['OPS-7']);
  });

  it('an unreadable saved ticket makes a new ticket uncertain: Unable to verify, listed by key', () => {
    const destination = [dIssue('jira:DEMO-101'), dIssue('jira:DEMO-7')];
    const identities = ids({ itemId: 'jira:DEMO-101', state: 'unverified', key: 'DEMO-101', reason: 'not readable' }, ok('jira:DEMO-7', 'DEMO-7'));
    const p = planRunwayAppend([t('DEMO-7', 1, 'jira'), t('DEMO-150', 2, 'jira')], [], destination, identities);
    expect(p).toMatchObject({ unverified: ['DEMO-101'], unableToVerify: true });
  });

  it('saved DEMO-101 returns 404 and the file has DEMO-150: no proposed number for DEMO-150, and DEMO-101 is not "not in this file"', () => {
    const destination = [dIssue('jira:DEMO-7'), dIssue('jira:DEMO-101')];
    const identities = ids(ok('jira:DEMO-7', 'DEMO-7'), { itemId: 'jira:DEMO-101', state: 'unverified', key: 'DEMO-101', reason: 'the tracker says it is gone' });
    const p = planRunwayAppend([t('DEMO-7', 1, 'jira'), t('DEMO-150', 2, 'jira')], [], destination, identities);
    expect(p.unableToVerify).toBe(true);
    expect(p.rows[1]).toEqual({ present: false, runwayNumber: null, uncertain: true });
    expect(p.absent).toEqual([]);
    expect(p.unverified).toEqual(['DEMO-101']);
    // Once the lookup succeeds (the old key answers DEMO-150), DEMO-150 shows its existing number.
    const again = planRunwayAppend([t('DEMO-7', 1, 'jira'), t('DEMO-150', 2, 'jira')], [], destination, ids(ok('jira:DEMO-7', 'DEMO-7'), ok('jira:DEMO-101', 'DEMO-150', ['jira:DEMO-101', 'jira:DEMO-150'])));
    expect(again.rows[1]).toEqual({ present: true, runwayNumber: 2 });
    expect(again).toMatchObject({ unableToVerify: false, append: [] });
  });

  it('an unreadable saved ticket does not block sections and notes alone, nor a file whose tickets all match', () => {
    const destination = [dIssue('jira:DEMO-101'), dIssue('jira:DEMO-7')];
    const identities = ids({ itemId: 'jira:DEMO-101', state: 'unverified', key: 'DEMO-101', reason: 'not readable' }, ok('jira:DEMO-7', 'DEMO-7'));
    const p = planRunwayAppend([t('DEMO-7', 1, 'jira'), note('New note', 2)], [], destination, identities);
    expect(p).toMatchObject({ append: [1], unableToVerify: false, unverified: ['DEMO-101'] });
  });

  it('a saved row with no identity read at all is uncertain too', () => {
    expect(planRunwayAppend([t('READ-2', 1)], [], [dIssue('yt:READ-1')], {}).unableToVerify).toBe(true);
  });

  it('tickets the file does not have are listed by key, never removed', () => {
    const destination = [dIssue('yt:READ-1'), dIssue('yt:READ-2'), dIssue('yt:READ-3')];
    const p = planRunwayAppend([t('READ-2', 1)], [], destination, ids(ok('yt:READ-1', 'READ-1'), ok('yt:READ-2', 'READ-2'), ok('yt:READ-3', 'READ-3')));
    expect(p.absent).toEqual(['READ-1', 'READ-3']);
    expect(p.append).toEqual([]);
  });

  it('new rows are appended in file order, interleaved as the file has them, numbered after the last ticket', () => {
    const destination = [dIssue('yt:READ-1'), dNote('Kept', 'n1')];
    const rows = [sec('New part', 1), t('READ-1', 2), t('READ-5', 3), note('Kept', 4), note('Fresh', 5), t('READ-6', 6)];
    const p = planRunwayAppend(rows, [], destination, ids(ok('yt:READ-1', 'READ-1')));
    expect(p.append).toEqual([0, 2, 4, 5]);
    expect(p.rows.map((r) => r.runwayNumber)).toEqual([null, 1, 2, null, null, 3]);
  });
});

describe('sameDestinationRows', () => {
  const base = [dIssue('yt:READ-1'), dNote('A note', 'n1', 1)];
  it('compares ID, kind, stored text and depth, in order', () => {
    expect(sameDestinationRows(base, base.map((r) => ({ ...r })))).toBe(true);
    expect(sameDestinationRows(base, [base[1], base[0]])).toBe(false);
    expect(sameDestinationRows(base, [base[0], { ...base[1], text: 'A note, edited' }])).toBe(false);
    expect(sameDestinationRows(base, [base[0], { ...base[1], depth: 0 }])).toBe(false);
    expect(sameDestinationRows(base, [base[0]])).toBe(false);
  });
});
