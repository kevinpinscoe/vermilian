// Markdown schedule parser for the Workspace Runway import (VERM-100,
// spec/features/workspace-runway.md → "Markdown import"). Pure — no I/O, no
// Electron, no React — so it runs in either process and in unit tests.
//
// It turns a written schedule into an outline and decides nothing about
// trackers or credentials. A ticket is recorded exactly as written: its key,
// and the original link when it was given as a URL. Matching it to the target
// workspace's tracker and host is VERM-101's job (parseRunwayReference), so a
// key that appears under two different hosts stays two candidates here.
//
// The rules, as approved on VERM-100:
//   - Each `##` heading starts a group (a proposed workspace). Content before
//     the first `##` goes in an unnamed group, created only when it has
//     content. `#` headings are document titles: recorded, never rows.
//   - `###` and deeper headings are section rows (depth = level - 3).
//   - A top-level list item is a scheduled ticket when it leads with a key or
//     ticket URL, after an optional `[ ]`, `[x]`, `[X]` or `[-]` box. The rest
//     of its first line is a preview-only title hint.
//   - Everything else is a note row, kept verbatim and in file order: each
//     paragraph, each non-ticket list item, each nested bullet (indented, one
//     row per bullet), each table and each code block.
//   - Every other key is a reference: in prose, headings, nested bullets
//     (even when it leads the bullet), tables, code (even a line that looks
//     exactly like a scheduled item), or later on a scheduled item's line.
//     A reference after "see", "moved to" or "replaced by" records that cue.
//   - Within one group a ticket is scheduled once. A later scheduled
//     occurrence is kept as a note and listed as a duplicate reference. An
//     earlier incidental mention does not take the ticket's place, and each
//     group starts fresh.
//   - List nesting survives wrapped text and headings: a line indented into
//     an item (a heading included) is that item's content, and text under a
//     ticket becomes an indented note without opening a list level.
//   - A fence closes only on a fence indented at most 3 columns into its
//     container; a fence straight after a list marker makes that item code.

export interface ScheduleTicket {
  /** The key as written, or as it appears in the link's path. Not normalised. */
  key: string;
  /** The original link text when the ticket was given as a URL, else null. */
  url: string | null;
  /** The link's host, lowercased, when given as a URL, else null. */
  host: string | null;
}

export type ScheduleCheckbox = ' ' | 'x' | 'X' | '-';

export type ScheduleNoteSource = 'paragraph' | 'item' | 'nested' | 'table' | 'code';

export type ScheduleRow =
  | {
      kind: 'ticket';
      ticket: ScheduleTicket;
      /** The item's task box, or null for a plain bullet. */
      checkbox: ScheduleCheckbox | null;
      /** Text after the leading ticket, for the preview only; null when none. */
      titleHint: string | null;
      line: number;
    }
  | { kind: 'section'; text: string; depth: number; line: number }
  | { kind: 'note'; text: string; depth: number; source: ScheduleNoteSource; line: number };

export type ScheduleReferenceReason =
  | 'prose' // a paragraph or a non-ticket list item
  | 'heading'
  | 'nested'
  | 'table'
  | 'code'
  | 'trailing' // later on a scheduled item's line
  | 'duplicate'; // a second scheduled occurrence in the same group

export type ScheduleReferenceCue = 'see' | 'moved to' | 'replaced by';

export interface ScheduleReference {
  ticket: ScheduleTicket;
  reason: ScheduleReferenceReason;
  cue: ScheduleReferenceCue | null;
  line: number;
}

export interface ScheduleGroup {
  /** The `##` heading text; null for the unnamed group before the first `##`. */
  name: string | null;
  /** The heading's line; for the unnamed group, its first content line. */
  line: number;
  rows: ScheduleRow[];
  references: ScheduleReference[];
}

export interface ParsedSchedule {
  /** `#` heading texts, in file order. */
  titles: string[];
  groups: ScheduleGroup[];
}

// ---------------------------------------------------------------------------
// Ticket recognition

const KEY_RE = /^[A-Za-z][A-Za-z0-9_]*-[0-9]+$/;
// A key standing alone in text: not part of a longer word, path or number.
const BARE_KEY_RE = /(?<![\w/.-])[A-Za-z][A-Za-z0-9_]*-[0-9]+(?![\w-]|\.\d)/g;
const CUE_RE = /\b(see|moved to|replaced by)\b[\s:([]*$/i;

/** The ticket key a link points at (YouTrack or Jira URL shapes), on any host. */
function keyFromUrl(text: string): { key: string; host: string } | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const path = url.pathname;
  const candidate =
    /\/issue\/([^/]+)\/?(?:[^/]*\/?)?$/.exec(path)?.[1] ??
    /\/projects\/[^/]+\/issues\/([^/]+)\/?(?:[^/]*\/?)?$/.exec(path)?.[1] ??
    /\/browse\/([^/]+)\/?$/.exec(path)?.[1] ??
    url.searchParams.get('selectedIssue');
  if (!candidate) return null;
  let key: string;
  try {
    key = decodeURIComponent(candidate);
  } catch {
    return null;
  }
  return KEY_RE.test(key) ? { key, host: url.host.toLowerCase() } : null;
}

interface Mention {
  start: number;
  end: number;
  /** null for a link that is not a ticket link: masked, but not a mention. */
  ticket: ScheduleTicket | null;
  inCode: boolean;
}

// Trailing characters that end a bare URL in prose rather than belong to it.
const trimUrl = (u: string) => u.replace(/[.,;:!?'")\]]+$/, '');

/**
 * Every ticket mention in one line of inline text, in order. Links are found
 * first and masked, so a key inside a URL is never counted twice; inline code
 * spans are found too, and keys in them are code references.
 */
function mentionsIn(text: string): Mention[] {
  const found: Mention[] = [];
  const masked = text.split('');
  const mask = (s: number, e: number) => {
    for (let i = s; i < e; i++) masked[i] = ' ';
  };
  const add = (start: number, end: number, ticket: ScheduleTicket | null, inCode: boolean) => {
    if (ticket) found.push({ start, end, ticket, inCode });
    mask(start, end);
  };

  // Inline code spans: keys and links inside them are code.
  const codeSpans: [number, number][] = [];
  for (const m of text.matchAll(/(`+)(.+?)\1/g)) {
    codeSpans.push([m.index, m.index + m[0].length]);
  }
  const inCode = (i: number) => codeSpans.some(([s, e]) => i >= s && i < e);

  // Markdown links [label](url) and autolinks <url>.
  for (const m of text.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)|<(https?:\/\/[^>\s]+)>/gi)) {
    const urlText = m[2] ?? m[3];
    const hit = keyFromUrl(urlText);
    if (hit) {
      add(m.index, m.index + m[0].length, { key: hit.key, url: urlText, host: hit.host }, inCode(m.index));
    } else {
      // Not a ticket link: hide only the URL, so a key in the label still counts.
      const urlStart = m.index + m[0].lastIndexOf(urlText);
      add(urlStart, urlStart + urlText.length, null, false);
    }
  }
  // Bare URLs.
  const afterLinks = masked.join('');
  for (const m of afterLinks.matchAll(/https?:\/\/[^\s<>]+/gi)) {
    const urlText = trimUrl(m[0]);
    const hit = keyFromUrl(urlText);
    add(m.index, m.index + urlText.length, hit ? { key: hit.key, url: urlText, host: hit.host } : null, inCode(m.index));
  }
  // Bare keys in what is left.
  const rest = masked.join('');
  for (const m of rest.matchAll(BARE_KEY_RE)) {
    found.push({ start: m.index, end: m.index + m[0].length, ticket: { key: m[0], url: null, host: null }, inCode: inCode(m.index) });
  }
  return found.sort((a, b) => a.start - b.start);
}

function cueBefore(text: string, index: number): ScheduleReferenceCue | null {
  const m = CUE_RE.exec(text.slice(0, index));
  return m ? (m[1].toLowerCase().replace(/\s+/g, ' ') as ScheduleReferenceCue) : null;
}

/** A ticket's identity for the per-group duplicate check: key and host. */
const identity = (t: ScheduleTicket) => `${t.host ?? ''} ${t.key.toUpperCase()}`;

// ---------------------------------------------------------------------------
// Block structure

const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const FENCE_RE = /^( *)(`{3,}|~{3,})(.*)$/;

/**
 * The fence marker `text` opens with, or null. A backtick fence's info
 * string may not contain a backtick, so ```READ-1``` on one line is an
 * inline code span, not a fence (CommonMark); a tilde fence's may.
 */
function fenceMarker(text: string): string | null {
  const m = /^(`{3,}|~{3,})(.*)$/.exec(text);
  if (!m || (m[1][0] === '`' && m[2].includes('`'))) return null;
  return m[1];
}
const ITEM_RE = /^( *)([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/;
const THEMATIC_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const TABLE_RE = /^ {0,3}\|/;
const BOX_RE = /^\[([ xX-])\](?:[ \t]+|$)/;

const expandTabs = (line: string) => line.replace(/^[ \t]+/, (ws) => ws.replace(/\t/g, '    '));
const indentOf = (line: string) => /^ */.exec(line)![0].length;
const isBlank = (line: string) => line.trim() === '';

/** Removes the common leading indentation from a block's lines. */
function dedent(lines: string[]): string {
  const min = Math.min(...lines.filter((l) => !isBlank(l)).map(indentOf));
  return lines
    .map((l) => l.slice(Math.min(min, indentOf(l))).replace(/[ \t]+$/, ''))
    .join('\n')
    .trim();
}

type NoteRow = Extract<ScheduleRow, { kind: 'note' }>;

interface OpenItem {
  /** Column where this item's content starts; deeper lines belong to it. */
  contentCol: number;
  /** Nesting depth: 0 for a top-level item. */
  depth: number;
  /**
   * The note row this item's text is currently going into, or null when
   * there is none open: a scheduled ticket's own line, a fenced item that
   * has closed, or a parent whose child item has started. The next
   * continuation line then opens a new indented note, so rows stay in file
   * order and no list level is invented.
   */
  textRow: NoteRow | null;
  textLines: string[];
}

/** Parses a Markdown schedule. Never throws; any text produces an outline. */
export function parseRunwaySchedule(markdown: string): ParsedSchedule {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n').map(expandTabs);
  const titles: string[] = [];
  const groups: ScheduleGroup[] = [];
  let current: ScheduleGroup | null = null;
  let scheduled = new Set<string>();

  const group = (lineNo: number): ScheduleGroup => {
    if (!current) {
      current = { name: null, line: lineNo, rows: [], references: [] };
      groups.push(current);
      // `scheduled` is not reset here: the unnamed group is the first, and
      // this runs lazily, after its first ticket may already be recorded.
    }
    return current;
  };
  const reference = (lineNo: number, ticket: ScheduleTicket, reason: ScheduleReferenceReason, cue: ScheduleReferenceCue | null) => {
    group(lineNo).references.push({ ticket, reason, cue, line: lineNo });
  };
  /** Records every mention in `text` as a reference with `reason` (code spans as code). */
  const referencesIn = (lineNo: number, text: string, reason: ScheduleReferenceReason) => {
    for (const m of mentionsIn(text)) {
      if (m.ticket) reference(lineNo, m.ticket, m.inCode ? 'code' : reason, cueBefore(text, m.start));
    }
  };
  const note = (lineNo: number, text: string, depth: number, source: ScheduleNoteSource) => {
    const row: NoteRow = { kind: 'note', text, depth, source, line: lineNo };
    group(lineNo).rows.push(row);
    return row;
  };

  // Open blocks.
  let items: OpenItem[] = [];
  let paragraph: { start: number; lines: string[] } | null = null;
  let table: { start: number; lines: string[] } | null = null;
  let indentedCode: { start: number; lines: string[] } | null = null;
  let lastWasBlank = true;

  /** Pops items the column is not inside, and ends the parent's open text. */
  const nestAt = (col: number): number => {
    while (items.length && col < items[items.length - 1].contentCol) items.pop();
    const parent = items[items.length - 1];
    if (parent) {
      parent.textRow = null;
      parent.textLines = [];
    }
    return items.length;
  };
  /** Opens a list item whose text goes into `row` (null when none is open). */
  const openItem = (contentCol: number, depth: number, row: NoteRow | null, first: string | null) => {
    const it: OpenItem = { contentCol, depth, textRow: row, textLines: [] };
    items.push(it);
    if (first !== null) appendItemLine(it, first);
  };
  // The note's text is kept current on every line, so an item closed by
  // any route (popped, ended by a heading, end of file) is never empty.
  const appendItemLine = (it: OpenItem, line: string) => {
    it.textLines.push(line);
    if (it.textRow) it.textRow.text = dedent(it.textLines);
  };
  /** A continuation line of `it`: into its open note, or a new note under it. */
  const continueItem = (it: OpenItem, lineNo: number, line: string) => {
    it.textRow ??= note(lineNo, '', it.depth + 1, 'nested');
    appendItemLine(it, line);
    referencesIn(lineNo, line, it.textRow.source === 'item' ? 'prose' : 'nested');
  };
  /**
   * Consumes a fenced block opened on line `start` with `marker`, inside a
   * container whose content starts at `containerCol` (0 at the top level).
   * A closing fence may be indented at most 3 columns into its container;
   * a deeper one is code. Inside a list item the block also ends with the
   * item, at the first non-blank line indented less than the item's content;
   * an unclosed top-level fence runs to the end of the file. Returns the
   * index of the block's last line.
   */
  const fenceEnd = (start: number, marker: string, containerCol: number): number => {
    const close = new RegExp(`^ *${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`);
    let lastContent = start;
    for (let j = start + 1; j < lines.length; j++) {
      if (containerCol > 0 && !isBlank(lines[j]) && indentOf(lines[j]) < containerCol) return lastContent;
      if (close.test(lines[j]) && indentOf(lines[j]) <= containerCol + 3) return j;
      if (!isBlank(lines[j])) lastContent = j;
    }
    return containerCol > 0 ? lastContent : lines.length - 1;
  };
  const codeReferences = (start: number, end: number) => {
    for (let k = start; k <= end; k++) referencesIn(k + 1, lines[k], 'code');
  };
  const closeItems = () => {
    items = [];
  };
  const closeParagraph = () => {
    if (!paragraph) return;
    note(paragraph.start, dedent(paragraph.lines), 0, 'paragraph');
    paragraph.lines.forEach((l, i) => referencesIn(paragraph!.start + i, l, 'prose'));
    paragraph = null;
  };
  const closeTable = () => {
    if (!table) return;
    note(table.start, dedent(table.lines), 0, 'table');
    table.lines.forEach((l, i) => referencesIn(table!.start + i, l, 'table'));
    table = null;
  };
  const closeIndentedCode = () => {
    if (!indentedCode) return;
    note(indentedCode.start, dedent(indentedCode.lines), 0, 'code');
    indentedCode.lines.forEach((l, i) => referencesIn(indentedCode!.start + i, l, 'code'));
    indentedCode = null;
  };
  const closeLeaf = () => {
    closeParagraph();
    closeTable();
    closeIndentedCode();
  };
  const closeAll = () => {
    closeLeaf();
    closeItems();
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;
    const indent = indentOf(raw);
    const deepest = items[items.length - 1];

    if (isBlank(raw)) {
      closeLeaf();
      if (deepest?.textRow) deepest.textLines.push(''); // kept for spacing; trimmed at the end
      lastWasBlank = true;
      continue;
    }

    // Fenced code: one note, every key a code reference. Inside a list item
    // when indented to its content; otherwise it ends the list.
    const fence = FENCE_RE.exec(raw);
    const marker = fence ? fenceMarker(raw.trimStart()) : null;
    if (fence && marker && fence[1].length <= (deepest ? deepest.contentCol + 3 : 3)) {
      closeLeaf();
      const depth = nestAt(indent);
      const end = fenceEnd(i, marker, depth ? items[depth - 1].contentCol : 0);
      note(lineNo, dedent(lines.slice(i, end + 1)), depth, 'code');
      codeReferences(i, end);
      i = end;
      lastWasBlank = false;
      continue;
    }

    // Indented code at the top level (not a paragraph continuation).
    if (!items.length && indent >= 4 && (indentedCode || (lastWasBlank && !paragraph))) {
      closeParagraph();
      closeTable();
      indentedCode ??= { start: lineNo, lines: [] };
      indentedCode.lines.push(raw);
      lastWasBlank = false;
      continue;
    }

    // A line indented into an open list item is that item's content, so a
    // heading or rule there is text and never ends the list (VERM-100 review).
    const insideItem = items.length > 0 && indent >= items[0].contentCol;

    const heading = indent <= 3 && !insideItem ? HEADING_RE.exec(raw) : null;
    if (heading) {
      closeAll();
      const level = heading[1].length;
      const text = (heading[2] ?? '').trim();
      if (level === 1) {
        titles.push(text);
        referencesIn(lineNo, text, 'heading');
      } else if (level === 2) {
        current = { name: text, line: lineNo, rows: [], references: [] };
        groups.push(current);
        scheduled = new Set();
        referencesIn(lineNo, text, 'heading');
      } else {
        group(lineNo).rows.push({ kind: 'section', text, depth: level - 3, line: lineNo });
        referencesIn(lineNo, text, 'heading');
      }
      lastWasBlank = false;
      continue;
    }

    if (!insideItem && THEMATIC_RE.test(raw)) {
      closeAll();
      lastWasBlank = false;
      continue;
    }

    const item = ITEM_RE.exec(raw);
    if (item && !(item[4] === undefined && paragraph)) {
      closeLeaf();
      const markerIndent = item[1].length;
      const depth = nestAt(markerIndent);
      const spacing = item[3]?.length ?? 1;
      const contentCol = markerIndent + item[2].length + (spacing > 4 ? 1 : spacing);
      const content = (item[4] ?? '').trim();

      // A fence opened right after the marker: the item is a code note, and
      // nothing in the fence is scheduled.
      const itemFence = fenceMarker(content);
      if (itemFence) {
        const end = fenceEnd(i, itemFence, contentCol);
        note(lineNo, dedent(lines.slice(i, end + 1)), depth, 'code');
        codeReferences(i, end);
        openItem(contentCol, depth, null, null);
        i = end;
        lastWasBlank = false;
        continue;
      }

      if (depth === 0) {
        const box = BOX_RE.exec(content);
        const body = box ? content.slice(box[0].length) : content;
        const mentions = mentionsIn(body);
        const lead = mentions[0];
        if (lead?.ticket && lead.start === 0 && !lead.inCode) {
          const id = identity(lead.ticket);
          if (!scheduled.has(id)) {
            scheduled.add(id);
            const hint = body.slice(lead.end).replace(/^[\s\-–—:|]+/, '').trim();
            group(lineNo).rows.push({
              kind: 'ticket',
              ticket: lead.ticket,
              checkbox: box ? (box[1] as ScheduleCheckbox) : null,
              titleHint: hint || null,
              line: lineNo,
            });
            for (const m of mentions.slice(1)) {
              if (m.ticket) reference(lineNo, m.ticket, m.inCode ? 'code' : 'trailing', cueBefore(body, m.start));
            }
            openItem(contentCol, depth, null, null);
            lastWasBlank = false;
            continue;
          }
          // A second scheduled occurrence in this group: kept as a note.
          const row = note(lineNo, '', depth, 'item');
          reference(lineNo, lead.ticket, 'duplicate', null);
          for (const m of mentions.slice(1)) {
            if (m.ticket) reference(lineNo, m.ticket, m.inCode ? 'code' : 'trailing', cueBefore(body, m.start));
          }
          openItem(contentCol, depth, row, raw);
          lastWasBlank = false;
          continue;
        }
        const row = note(lineNo, '', depth, 'item');
        referencesIn(lineNo, content, 'prose');
        openItem(contentCol, depth, row, raw);
      } else {
        // A nested bullet: always a note, every key a reference.
        const row = note(lineNo, '', depth, 'nested');
        referencesIn(lineNo, content, 'nested');
        openItem(contentCol, depth, row, raw);
      }
      lastWasBlank = false;
      continue;
    }

    // Continuation of an open list item: indented into an item's content
    // (it belongs to the deepest item it reaches), or a lazy continuation
    // line straight after the deepest item. It never opens a list level.
    if (insideItem || (deepest && !lastWasBlank && !TABLE_RE.test(raw))) {
      if (insideItem) while (items.length > 1 && indent < items[items.length - 1].contentCol) items.pop();
      continueItem(items[items.length - 1], lineNo, raw);
      lastWasBlank = false;
      continue;
    }

    // Anything else ends the list.
    if (items.length) closeItems();

    if (TABLE_RE.test(raw) && !paragraph) {
      closeIndentedCode();
      table ??= { start: lineNo, lines: [] };
      table.lines.push(raw);
    } else if (table) {
      // A line without a leading pipe ends the table and starts a paragraph.
      closeTable();
      paragraph = { start: lineNo, lines: [raw] };
    } else {
      closeIndentedCode();
      paragraph ??= { start: lineNo, lines: [] };
      paragraph.lines.push(raw);
    }
    lastWasBlank = false;
  }
  closeAll();
  return { titles, groups };
}

/** The group's scheduled tickets in file order: Runway #1..N for a new Runway. */
export function scheduledTickets(group: ScheduleGroup): Extract<ScheduleRow, { kind: 'ticket' }>[] {
  return group.rows.filter((r): r is Extract<ScheduleRow, { kind: 'ticket' }> => r.kind === 'ticket');
}
