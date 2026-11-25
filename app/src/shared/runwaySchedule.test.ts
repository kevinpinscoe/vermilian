import { describe, expect, it } from 'vitest';
import { parseRunwaySchedule, scheduledTickets, type ScheduleGroup, type ScheduleRow } from './runwaySchedule';

// Synthetic keys, names and *.example.test hosts only.

const md = (...lines: string[]) => lines.join('\n');

/** A compact view of a group's rows, for whole-outline assertions. */
function outline(group: ScheduleGroup): string[] {
  return group.rows.map((r: ScheduleRow) => {
    switch (r.kind) {
      case 'ticket':
        return `ticket ${r.ticket.key}${r.ticket.url ? ` <${r.ticket.url}>` : ''} [${r.checkbox ?? 'bullet'}] ${r.titleHint ?? ''}`.trimEnd();
      case 'section':
        return `section ${r.depth} ${r.text}`;
      case 'note':
        return `note ${r.depth} ${r.source}: ${r.text}`;
    }
  });
}

const refs = (group: ScheduleGroup) =>
  group.references.map((r) => `${r.ticket.key}${r.ticket.host ? `@${r.ticket.host}` : ''} ${r.reason}${r.cue ? ` (${r.cue})` : ''} L${r.line}`);

describe('parseRunwaySchedule — the spec section 5 example', () => {
  const example = md(
    '## Ship the offline reader',
    '',
    'Readers lose their place on the train. Target: before the spring release.',
    '',
    '- [ ] https://yt.example.test/issue/READ-12 - Cache articles locally',
    '- [ ] SYNC-3 - Conflict-free merge library',
    '- [ ] READ-14 - Sync read state between devices',
    '- [ ] SYNC-7 - Background sync worker',
    '- [ ] READ-20 - Offline indicator in the toolbar',
    '',
    '### Later',
    '',
    '- Look at READ-9 again; it was the first attempt and is mostly obsolete.',
  );
  const parsed = parseRunwaySchedule(example);

  it('makes one group from the ## heading, with no unnamed group', () => {
    expect(parsed.groups.map((g) => g.name)).toEqual(['Ship the offline reader']);
    expect(parsed.titles).toEqual([]);
  });

  it('keeps the note, five scheduled tickets in file order, the section and its note', () => {
    expect(outline(parsed.groups[0])).toEqual([
      'note 0 paragraph: Readers lose their place on the train. Target: before the spring release.',
      'ticket READ-12 <https://yt.example.test/issue/READ-12> [ ] Cache articles locally',
      'ticket SYNC-3 [ ] Conflict-free merge library',
      'ticket READ-14 [ ] Sync read state between devices',
      'ticket SYNC-7 [ ] Background sync worker',
      'ticket READ-20 [ ] Offline indicator in the toolbar',
      'section 0 Later',
      'note 0 item: - Look at READ-9 again; it was the first attempt and is mostly obsolete.',
    ]);
    expect(scheduledTickets(parsed.groups[0]).map((t) => t.ticket.key)).toEqual(['READ-12', 'SYNC-3', 'READ-14', 'SYNC-7', 'READ-20']);
  });

  it('lists READ-9 as an unticked reference, not a ticket', () => {
    expect(refs(parsed.groups[0])).toEqual(['READ-9 prose L13']);
  });

  it('keeps the original URL and its host for VERM-101', () => {
    const first = scheduledTickets(parsed.groups[0])[0].ticket;
    expect(first).toEqual({ key: 'READ-12', url: 'https://yt.example.test/issue/READ-12', host: 'yt.example.test' });
  });
});

describe('groups and headings', () => {
  it('puts meaningful content before the first ## in an unnamed group', () => {
    const p = parseRunwaySchedule(md('Intro about READ-1.', '', '- [ ] READ-2 First', '', '## Alpha', '- READ-3'));
    expect(p.groups.map((g) => g.name)).toEqual([null, 'Alpha']);
    expect(p.groups[0].line).toBe(1);
    expect(outline(p.groups[0])).toEqual(['note 0 paragraph: Intro about READ-1.', 'ticket READ-2 [ ] First']);
    expect(refs(p.groups[0])).toEqual(['READ-1 prose L1']);
    expect(outline(p.groups[1])).toEqual(['ticket READ-3 [bullet]']);
  });

  it('creates no unnamed group when nothing meaningful precedes the first ##', () => {
    const p = parseRunwaySchedule(md('', '# Schedule', '', '---', '', '## Alpha', '- READ-3'));
    expect(p.titles).toEqual(['Schedule']);
    expect(p.groups.map((g) => g.name)).toEqual(['Alpha']);
  });

  it('makes ### and deeper headings sections, with depth from their level', () => {
    const p = parseRunwaySchedule(md('## A', '### Now', '#### Detail', '##### Fine print ##'));
    expect(outline(p.groups[0])).toEqual(['section 0 Now', 'section 1 Detail', 'section 2 Fine print']);
  });

  it('records a key in a heading as a heading reference', () => {
    const p = parseRunwaySchedule(md('## Follow-up for READ-4', '### Waiting on SYNC-1'));
    expect(p.groups[0].name).toBe('Follow-up for READ-4');
    expect(refs(p.groups[0])).toEqual(['READ-4 heading L1', 'SYNC-1 heading L2']);
  });

  it('never throws, and an empty file has no groups', () => {
    expect(parseRunwaySchedule('')).toEqual({ titles: [], groups: [] });
    expect(() => parseRunwaySchedule('```\nunclosed\n- [ ] READ-1')).not.toThrow();
  });
});

describe('scheduled tickets', () => {
  it.each([
    ['- [ ] READ-1 Title', ' '],
    ['- [x] READ-1 Title', 'x'],
    ['- [X] READ-1 Title', 'X'],
    ['- [-] READ-1 Title', '-'],
    ['* READ-1 Title', null],
    ['+ READ-1 Title', null],
    ['1. READ-1 Title', null],
  ])('%s is scheduled', (line, box) => {
    const [row] = parseRunwaySchedule(md('## A', line)).groups[0].rows;
    expect(row).toMatchObject({ kind: 'ticket', ticket: { key: 'READ-1' }, checkbox: box, titleHint: 'Title' });
  });

  it('keeps [X] items in their place in the order', () => {
    const p = parseRunwaySchedule(md('## A', '- [X] READ-1', '- [ ] READ-2', '- [x] READ-3'));
    expect(scheduledTickets(p.groups[0]).map((t) => t.ticket.key)).toEqual(['READ-1', 'READ-2', 'READ-3']);
  });

  it.each([
    ['https://yt.example.test/issue/READ-5/cache-articles', 'yt.example.test'],
    ['https://yt.example.test/projects/READ/issues/READ-5', 'yt.example.test'],
    ['https://tools.example.test/youtrack/issue/READ-5', 'tools.example.test'],
    ['https://site.example.test/browse/READ-5', 'site.example.test'],
    ['https://site.example.test/jira/software/projects/READ/boards/1?selectedIssue=READ-5', 'site.example.test'],
  ])('a leading ticket link %s', (url, host) => {
    const [row] = parseRunwaySchedule(md('## A', `- [ ] ${url} — Title`)).groups[0].rows;
    expect(row).toMatchObject({ kind: 'ticket', ticket: { key: 'READ-5', url, host }, titleHint: 'Title' });
  });

  it('accepts a Markdown link or autolink as the leading ticket, keeping the URL', () => {
    const p = parseRunwaySchedule(md('## A', '- [ ] [READ-5](https://yt.example.test/issue/READ-5): Title', '- <https://yt.example.test/issue/READ-6>'));
    expect(outline(p.groups[0])).toEqual([
      'ticket READ-5 <https://yt.example.test/issue/READ-5> [ ] Title',
      'ticket READ-6 <https://yt.example.test/issue/READ-6> [bullet]',
    ]);
    expect(p.groups[0].references).toEqual([]);
  });

  it('a URL that is not a ticket link does not schedule the item', () => {
    const p = parseRunwaySchedule(md('## A', '- [ ] https://wiki.example.test/page Read the notes'));
    expect(outline(p.groups[0])).toEqual(['note 0 item: - [ ] https://wiki.example.test/page Read the notes']);
  });

  it('a key inside a longer token does not lead the item', () => {
    const p = parseRunwaySchedule(md('## A', '- READ-1x is not a key', '- v2/READ-1 is a path'));
    expect(scheduledTickets(p.groups[0])).toEqual([]);
    expect(p.groups[0].references).toEqual([]);
  });

  it('records later keys on a scheduled line as trailing references, with their cue', () => {
    const p = parseRunwaySchedule(
      md('## A', '- [ ] READ-1 Cache, see READ-2; moved to SYNC-4, replaced by: https://yt.example.test/issue/SYNC-5 and READ-6'),
    );
    expect(outline(p.groups[0])).toEqual(['ticket READ-1 [ ] Cache, see READ-2; moved to SYNC-4, replaced by: https://yt.example.test/issue/SYNC-5 and READ-6']);
    expect(refs(p.groups[0])).toEqual([
      'READ-2 trailing (see) L2',
      'SYNC-4 trailing (moved to) L2',
      'SYNC-5@yt.example.test trailing (replaced by) L2',
      'READ-6 trailing L2',
    ]);
  });

  it('a title hint is null when nothing follows the ticket', () => {
    const [row] = parseRunwaySchedule(md('## A', '- [ ] READ-1')).groups[0].rows;
    expect(row).toMatchObject({ kind: 'ticket', titleHint: null });
  });
});

describe('notes', () => {
  it('keeps one note per non-ticket item and checklist item, verbatim', () => {
    const p = parseRunwaySchedule(md('## A', '- [ ] Talk to the design group', '- Plain bullet', '- [x] Done thing'));
    expect(outline(p.groups[0])).toEqual([
      'note 0 item: - [ ] Talk to the design group',
      'note 0 item: - Plain bullet',
      'note 0 item: - [x] Done thing',
    ]);
  });

  it('keeps each paragraph as one note, joined lines included', () => {
    const p = parseRunwaySchedule(md('## A', 'First line', 'second line.', '', '> A quote about SYNC-2'));
    expect(outline(p.groups[0])).toEqual(['note 0 paragraph: First line\nsecond line.', 'note 0 paragraph: > A quote about SYNC-2']);
    expect(refs(p.groups[0])).toEqual(['SYNC-2 prose L5']);
  });

  it('records a cue before a reference in prose', () => {
    const p = parseRunwaySchedule(md('## A', 'This was replaced by READ-30 (see READ-31).'));
    expect(refs(p.groups[0])).toEqual(['READ-30 prose (replaced by) L2', 'READ-31 prose (see) L2']);
  });

  it('keeps a key in a non-ticket Markdown link label as a reference', () => {
    const p = parseRunwaySchedule(md('## A', 'Notes: [READ-7 design](https://wiki.example.test/design).'));
    expect(refs(p.groups[0])).toEqual(['READ-7 prose L2']);
  });

  it('keeps continuation lines with their item', () => {
    const p = parseRunwaySchedule(md('## A', '- Ask about', '  the budget for READ-8', 'and the lazy line too'));
    expect(outline(p.groups[0])).toEqual(['note 0 item: - Ask about\n  the budget for READ-8\nand the lazy line too']);
    expect(refs(p.groups[0])).toEqual(['READ-8 prose L3']);
  });
});

describe('nested bullets', () => {
  it('keeps nested bullets under a ticket as indented notes in file order; every key is a reference', () => {
    const p = parseRunwaySchedule(
      md('## A', '- [ ] READ-1 Parent', '  - READ-2 leads this nested bullet', '    - [ ] READ-3 deeper still', '  - plain detail', '- [ ] READ-4 Next'),
    );
    expect(outline(p.groups[0])).toEqual([
      'ticket READ-1 [ ] Parent',
      'note 1 nested: - READ-2 leads this nested bullet',
      'note 2 nested: - [ ] READ-3 deeper still',
      'note 1 nested: - plain detail',
      'ticket READ-4 [ ] Next',
    ]);
    expect(refs(p.groups[0])).toEqual(['READ-2 nested L3', 'READ-3 nested L4']);
  });

  it('a key leading a nested bullet under an ordinary note is still a reference', () => {
    const p = parseRunwaySchedule(md('## A', '- Ideas', '  - SYNC-9 maybe', '- More', '\t- SYNC-10 tab-indented'));
    expect(outline(p.groups[0])).toEqual([
      'note 0 item: - Ideas',
      'note 1 nested: - SYNC-9 maybe',
      'note 0 item: - More',
      'note 1 nested: - SYNC-10 tab-indented',
    ]);
    expect(scheduledTickets(p.groups[0])).toEqual([]);
    expect(refs(p.groups[0])).toEqual(['SYNC-9 nested L3', 'SYNC-10 nested L5']);
  });

  it('keeps indented prose under a ticket as an indented note', () => {
    const p = parseRunwaySchedule(md('## A', '- [ ] READ-1 Parent', '', '  Context for READ-1, see READ-5.', '- [ ] READ-2'));
    expect(outline(p.groups[0])).toEqual(['ticket READ-1 [ ] Parent', 'note 1 nested: Context for READ-1, see READ-5.', 'ticket READ-2 [ ]']);
    expect(refs(p.groups[0])).toEqual(['READ-1 nested L4', 'READ-5 nested (see) L4']);
  });
});

describe('code and tables', () => {
  it('a fenced block is one note and a scheduled-looking line in it is a code reference', () => {
    const p = parseRunwaySchedule(md('## A', '```markdown', '- [ ] READ-1 looks scheduled', '```', '- [ ] READ-2 Real'));
    expect(outline(p.groups[0])).toEqual(['note 0 code: ```markdown\n- [ ] READ-1 looks scheduled\n```', 'ticket READ-2 [ ] Real']);
    expect(refs(p.groups[0])).toEqual(['READ-1 code L3']);
  });

  it('a tilde fence closes only on a matching fence', () => {
    const p = parseRunwaySchedule(md('## A', '~~~~', '```', '- READ-1', '~~~~', '- READ-2'));
    expect(scheduledTickets(p.groups[0]).map((t) => t.ticket.key)).toEqual(['READ-2']);
    expect(refs(p.groups[0])).toEqual(['READ-1 code L4']);
  });

  it('a fence inside a list item is a nested code note', () => {
    const p = parseRunwaySchedule(md('## A', '- [ ] READ-1 Parent', '  ```', '  - [ ] READ-9', '  ```', '- [ ] READ-2'));
    expect(outline(p.groups[0])).toEqual(['ticket READ-1 [ ] Parent', 'note 1 code: ```\n- [ ] READ-9\n```', 'ticket READ-2 [ ]']);
    expect(refs(p.groups[0])).toEqual(['READ-9 code L4']);
  });

  it('an indented code block is a code note', () => {
    const p = parseRunwaySchedule(md('## A', '', '    - [ ] READ-1 in code', '', '- READ-2'));
    expect(outline(p.groups[0])).toEqual(['note 0 code: - [ ] READ-1 in code', 'ticket READ-2 [bullet]']);
    expect(refs(p.groups[0])).toEqual(['READ-1 code L3']);
  });

  it('inline code is a code reference and never leads an item', () => {
    const p = parseRunwaySchedule(md('## A', '- `READ-1` in code', 'Prose with `SYNC-2` inline.'));
    expect(scheduledTickets(p.groups[0])).toEqual([]);
    expect(refs(p.groups[0])).toEqual(['READ-1 code L2', 'SYNC-2 code L3']);
  });

  it('a table is one note, with its keys as table references', () => {
    const p = parseRunwaySchedule(md('## A', '| Key | Why |', '| --- | --- |', '| READ-1 | first |', '| https://yt.example.test/issue/READ-2 | second |', '', '- READ-3'));
    expect(outline(p.groups[0])).toEqual([
      'note 0 table: | Key | Why |\n| --- | --- |\n| READ-1 | first |\n| https://yt.example.test/issue/READ-2 | second |',
      'ticket READ-3 [bullet]',
    ]);
    expect(refs(p.groups[0])).toEqual(['READ-1 table L4', 'READ-2@yt.example.test table L5']);
  });
});

describe('duplicates', () => {
  it('keeps the first scheduled occurrence in a group; a later one is a note and a duplicate reference', () => {
    const p = parseRunwaySchedule(md('## A', '- [ ] READ-1 First', '- [ ] READ-2', '- [x] READ-1 Again'));
    expect(outline(p.groups[0])).toEqual(['ticket READ-1 [ ] First', 'ticket READ-2 [ ]', 'note 0 item: - [x] READ-1 Again']);
    expect(refs(p.groups[0])).toEqual(['READ-1 duplicate L4']);
  });

  it('compares keys without regard to case', () => {
    const p = parseRunwaySchedule(md('## A', '- ops-7', '- OPS-7'));
    expect(scheduledTickets(p.groups[0]).map((t) => t.ticket.key)).toEqual(['ops-7']);
    expect(refs(p.groups[0])).toEqual(['OPS-7 duplicate L3']);
  });

  it('an earlier incidental mention does not take the ticket’s place', () => {
    const p = parseRunwaySchedule(md('## A', 'We discussed READ-1 already.', '- [ ] READ-1 Scheduled here'));
    expect(scheduledTickets(p.groups[0]).map((t) => t.line)).toEqual([3]);
    expect(refs(p.groups[0])).toEqual(['READ-1 prose L2']);
  });

  it('starts fresh in each ## group', () => {
    const p = parseRunwaySchedule(md('## A', '- READ-1', '## B', '- READ-1'));
    expect(p.groups.map((g) => scheduledTickets(g).length)).toEqual([1, 1]);
    expect(p.groups.flatMap((g) => g.references)).toEqual([]);
  });

  it('keeps the same key on two different hosts as two candidates for host validation', () => {
    const p = parseRunwaySchedule(md('## A', '- https://yt.example.test/issue/READ-1', '- https://other.example.test/issue/READ-1', '- READ-1'));
    expect(scheduledTickets(p.groups[0]).map((t) => t.ticket)).toEqual([
      { key: 'READ-1', url: 'https://yt.example.test/issue/READ-1', host: 'yt.example.test' },
      { key: 'READ-1', url: 'https://other.example.test/issue/READ-1', host: 'other.example.test' },
      { key: 'READ-1', url: null, host: null },
    ]);
  });

  it('the same link twice on one host is a duplicate', () => {
    const p = parseRunwaySchedule(md('## A', '- https://yt.example.test/issue/READ-1', '- https://YT.example.test/issue/READ-1/slug'));
    expect(scheduledTickets(p.groups[0])).toHaveLength(1);
    expect(refs(p.groups[0])).toEqual(['READ-1@yt.example.test duplicate L3']);
  });
});

describe('repeated headings and notes', () => {
  it('keeps one row per occurrence, each at its original location', () => {
    const p = parseRunwaySchedule(md('## A', '### Later', '- Revisit', '- [ ] READ-1', '### Later', '- Revisit'));
    expect(outline(p.groups[0])).toEqual(['section 0 Later', 'note 0 item: - Revisit', 'ticket READ-1 [ ]', 'section 0 Later', 'note 0 item: - Revisit']);
    expect(p.groups[0].rows.map((r) => r.line)).toEqual([2, 3, 4, 5, 6]);
  });

  it('keeps repeated ## headings as separate groups', () => {
    const p = parseRunwaySchedule(md('## A', '- READ-1', '## A', '- READ-2'));
    expect(p.groups.map((g) => [g.name, g.line])).toEqual([
      ['A', 1],
      ['A', 3],
    ]);
  });
});

it('accepts CRLF line endings', () => {
  const p = parseRunwaySchedule('## A\r\n- [ ] READ-1 One\r\n- [ ] READ-2 Two\r\n');
  expect(outline(p.groups[0])).toEqual(['ticket READ-1 [ ] One', 'ticket READ-2 [ ] Two']);
});

// Review of PR 228: each case below failed on 65755b6.
describe('review fixes', () => {
  const keys = (g: ScheduleGroup) => scheduledTickets(g).map((t) => `${t.ticket.key} L${t.line}`);

  it('finds a duplicate before the first ##', () => {
    const p = parseRunwaySchedule(md('- READ-1', '- READ-1'));
    expect(p.groups.map((g) => g.name)).toEqual([null]);
    expect(keys(p.groups[0])).toEqual(['READ-1 L1']);
    expect(refs(p.groups[0])).toEqual(['READ-1 duplicate L2']);
  });

  it('after a ticket’s lazily wrapped description, the next left-margin bullet is scheduled', () => {
    const p = parseRunwaySchedule(md('## A', '- [ ] READ-1 Title that', 'wraps onto the margin, see READ-7', '- [ ] READ-2 Next', '- [ ] READ-3 Last'));
    expect(keys(p.groups[0])).toEqual(['READ-1 L2', 'READ-2 L4', 'READ-3 L5']);
    expect(outline(p.groups[0])).toEqual([
      'ticket READ-1 [ ] Title that',
      'note 1 nested: wraps onto the margin, see READ-7',
      'ticket READ-2 [ ] Next',
      'ticket READ-3 [ ] Last',
    ]);
    expect(refs(p.groups[0])).toEqual(['READ-7 nested (see) L3']);
  });

  it('keeps a ticket’s wrapped lines in one note, with a nested bullet still one level down', () => {
    const p = parseRunwaySchedule(md('## A', '- [ ] READ-1 Title', '  line a', '  line b', '  - READ-8 detail', '- [ ] READ-2 Next'));
    expect(keys(p.groups[0])).toEqual(['READ-1 L2', 'READ-2 L6']);
    expect(outline(p.groups[0])).toEqual(['ticket READ-1 [ ] Title', 'note 1 nested: line a\nline b', 'note 1 nested: - READ-8 detail', 'ticket READ-2 [ ] Next']);
    expect(refs(p.groups[0])).toEqual(['READ-8 nested L5']);
  });

  it('a ticket bullet under an indented heading inside a note item stays incidental', () => {
    const p = parseRunwaySchedule(md('## A', '- Parent note', '  ### Inside the item', '  - [ ] READ-5 under the heading', '- [ ] READ-6 Real'));
    expect(keys(p.groups[0])).toEqual(['READ-6 L5']);
    expect(outline(p.groups[0])).toEqual([
      'note 0 item: - Parent note\n  ### Inside the item',
      'note 1 nested: - [ ] READ-5 under the heading',
      'ticket READ-6 [ ] Real',
    ]);
    expect(refs(p.groups[0])).toEqual(['READ-5 nested L4']);
  });

  it('a ticket bullet under an indented heading inside a ticket item stays incidental', () => {
    const p = parseRunwaySchedule(md('## A', '- [ ] READ-1 Parent', '  ### Details', '  - [ ] READ-5 under the heading', '- [ ] READ-6 Real'));
    expect(keys(p.groups[0])).toEqual(['READ-1 L2', 'READ-6 L5']);
    expect(refs(p.groups[0])).toEqual(['READ-5 nested L4']);
  });

  it('a four-space-indented fence line does not close a top-level fence', () => {
    const p = parseRunwaySchedule(md('## A', '```text', '- [ ] READ-1 example', '    ```', '- [ ] READ-2 still example', '```', '- [ ] READ-3 Real'));
    expect(keys(p.groups[0])).toEqual(['READ-3 L7']);
    expect(outline(p.groups[0])).toEqual([
      'note 0 code: ```text\n- [ ] READ-1 example\n    ```\n- [ ] READ-2 still example\n```',
      'ticket READ-3 [ ] Real',
    ]);
    expect(refs(p.groups[0])).toEqual(['READ-1 code L3', 'READ-2 code L5']);
  });

  it('a fence opened directly after a list marker is code, and the next ticket is scheduled', () => {
    const p = parseRunwaySchedule(md('## A', '- ```', '  - [ ] READ-1 example', '  ```', '- [ ] READ-2 Real'));
    expect(keys(p.groups[0])).toEqual(['READ-2 L5']);
    expect(outline(p.groups[0])).toEqual(['note 0 code: - ```\n  - [ ] READ-1 example\n  ```', 'ticket READ-2 [ ] Real']);
    expect(refs(p.groups[0])).toEqual(['READ-1 code L3']);
  });
});
