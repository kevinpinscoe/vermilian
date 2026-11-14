// Atlassian Document Format → Markdown, for reading only (VERM-32).
//
// Jira Cloud REST v3 returns descriptions and comment bodies as ADF, a JSON
// tree of block nodes (paragraph, heading, lists, code block, quote, panel,
// table, …) holding inline nodes (text with marks, mention, emoji, date,
// status, card links, hard breaks). This turns that tree into CommonMark
// with GFM tables and task lists, so the detail panel can show it (VERM-35).
//
// Read-only by design: the conversion is one-way and lossy. Colours,
// underline, sub/superscript and alignment are dropped; media becomes an
// "[attachment]" placeholder (attachments are never fetched); a mention
// becomes "@Name". Any node this does not know degrades to its text — its
// `text`, its `attrs.text`, or its children's text — and is never dropped
// silently nor allowed to throw.
//
// Safety, since the input is remote content:
//   - all text is Markdown-escaped, so ADF text can never become Markdown
//     syntax, raw HTML included (< and > are escaped);
//   - a link is emitted only for http(s) and mailto URLs; any other scheme
//     (javascript:, data:, file:) is reduced to its text;
//   - nesting deeper than MAX_DEPTH is flattened to text, so a hostile
//     document cannot exhaust the stack.
// The renderer that displays the result must still treat it as untrusted
// and must not enable raw HTML.
//
// Pure TypeScript: no Electron, no React.

export interface AdfNode {
  type?: unknown;
  text?: unknown;
  attrs?: Record<string, unknown> | null;
  marks?: Array<{ type?: unknown; attrs?: Record<string, unknown> | null } | null> | null;
  content?: unknown;
}

export const MAX_DEPTH = 40;
const MAX_PLAIN_DEPTH = 1000;

const PANEL_LABELS: Record<string, string> = {
  info: 'Info',
  note: 'Note',
  tip: 'Tip',
  success: 'Success',
  warning: 'Warning',
  error: 'Error',
};

function isNode(v: unknown): v is AdfNode {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function children(node: AdfNode): AdfNode[] {
  return Array.isArray(node.content) ? node.content.filter(isNode) : [];
}

function attr(node: AdfNode, name: string): unknown {
  return node.attrs && typeof node.attrs === 'object' ? node.attrs[name] : undefined;
}

function attrString(node: AdfNode, name: string): string {
  const v = attr(node, name);
  return typeof v === 'string' ? v : '';
}

// ─── Escaping ────────────────────────────────────────────────────────────────

/** Escapes every character that could start Markdown syntax inside a line. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]{}<>|~!#&]/g, (c) => `\\${c}`);
}

// Block markers only mean something at the start of a line: "1. ", "- ", "+ ",
// "= " / "- " underlines. # and > are already escaped everywhere.
function escapeLineStart(line: string): string {
  return line.replace(/^(\s*)(\d+)([.)])(?=\s|$)/, '$1$2\\$3').replace(/^(\s*)([-+=])(?=\s|$)/, '$1\\$2');
}

function escapeText(text: string): string {
  return escapeMarkdown(text.replace(/\r\n?/g, '\n'));
}

function isSafeUrl(url: string): boolean {
  return /^(?:https?:|mailto:)/i.test(url.trim());
}

function linkTarget(url: string): string {
  return url.trim().replace(/[\s()<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

function markdownLink(label: string, url: string): string {
  if (!isSafeUrl(url)) return label;
  return `[${label || escapeText(url)}](${linkTarget(url)})`;
}

// A code span or fence longer than any backtick run inside it.
function backtickFence(text: string, min: number): string {
  let longest = 0;
  for (const m of text.match(/`+/g) ?? []) longest = Math.max(longest, m.length);
  return '`'.repeat(Math.max(min, longest + 1));
}

function codeSpan(text: string): string {
  if (text === '') return '';
  const fence = backtickFence(text, 1);
  const pad = text.startsWith('`') || text.endsWith('`') || /^ .* $/.test(text) ? ' ' : '';
  return `${fence}${pad}${text.replace(/\n/g, ' ')}${pad}${fence}`;
}

// ─── Plain text (degradation, code, tables) ──────────────────────────────────

/** All the text a node holds, without formatting. */
export function adfPlainText(node: unknown, depth = 0): string {
  // Far deeper than rendering goes, so flattened content keeps its text; still
  // bounded, so no document can exhaust the stack.
  if (!isNode(node) || depth > MAX_PLAIN_DEPTH) return '';
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : '';
  if (node.type === 'hardBreak') return '\n';
  const own = inlineAtomText(node);
  if (own !== null) return own;
  const kids = children(node);
  const sep = kids.some((k) => isBlockType(k.type)) ? '\n' : '';
  return kids.map((k) => adfPlainText(k, depth + 1)).join(sep);
}

// ─── Inline ──────────────────────────────────────────────────────────────────

const INLINE_TYPES = new Set(['text', 'hardBreak', 'mention', 'emoji', 'date', 'status', 'inlineCard', 'placeholder', 'mediaInline']);

function isBlockType(type: unknown): boolean {
  return typeof type === 'string' && !INLINE_TYPES.has(type);
}

// The text an inline atom stands for, or null when the node is not an atom.
function inlineAtomText(node: AdfNode): string | null {
  switch (node.type) {
    case 'mention': {
      const t = attrString(node, 'text').trim();
      return t ? (t.startsWith('@') ? t : `@${t}`) : '@user';
    }
    case 'emoji':
      return attrString(node, 'text') || attrString(node, 'shortName');
    case 'date': {
      const ts = Number(attr(node, 'timestamp'));
      return Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : '';
    }
    case 'status':
      return attrString(node, 'text') ? `[${attrString(node, 'text')}]` : '';
    case 'inlineCard':
      return attrString(node, 'url');
    case 'placeholder':
      return '';
    case 'mediaInline':
    case 'media':
      return '[attachment]';
    default:
      return null;
  }
}

function renderText(node: AdfNode): string {
  const raw = typeof node.text === 'string' ? node.text : '';
  if (!raw) return '';
  const marks = (Array.isArray(node.marks) ? node.marks : []).filter(isNode) as AdfNode[];
  const has = (t: string) => marks.some((m) => m.type === t);
  const link = marks.find((m) => m.type === 'link');

  let out: string;
  if (has('code')) {
    out = codeSpan(raw);
  } else {
    out = escapeText(raw).replace(/\n/g, '\\\n');
    // Emphasis cannot open or close on whitespace, so it wraps the trimmed
    // text and the spaces stay outside.
    const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(out) ?? ['', '', out, ''];
    let inner = core;
    if (inner) {
      if (has('strike')) inner = `~~${inner}~~`;
      if (has('em')) inner = `_${inner}_`;
      if (has('strong')) inner = `**${inner}**`;
    }
    out = `${lead}${inner}${trail}`;
  }
  if (link) {
    const href = typeof link.attrs?.href === 'string' ? link.attrs.href : '';
    out = markdownLink(out, href);
  }
  return out;
}

function renderInline(nodes: AdfNode[], depth: number): string {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text') out += renderText(n);
    else if (n.type === 'hardBreak') out += '\\\n';
    else if (n.type === 'inlineCard') {
      const url = attrString(n, 'url');
      out += url ? markdownLink(escapeText(url), url) : '';
    } else {
      const atom = inlineAtomText(n);
      if (atom !== null) out += escapeText(atom);
      else if (depth > MAX_DEPTH) out += escapeText(adfPlainText(n).replace(/\n/g, ' '));
      // An unknown node in inline position: its own text, else its children's.
      else if (typeof n.text === 'string' || attrString(n, 'text')) out += escapeText(typeof n.text === 'string' ? n.text : attrString(n, 'text'));
      else out += renderInline(children(n), depth + 1).replace(/\\\n/g, ' ');
    }
  }
  return out.replace(/\\\n$/, '');
}

// ─── Blocks ──────────────────────────────────────────────────────────────────

function indent(text: string, first: string, rest: string): string {
  return text
    .split('\n')
    .map((line, i) => (i === 0 ? first + line : line ? rest + line : line))
    .join('\n');
}

function renderListItem(item: AdfNode, marker: string, depth: number): string {
  // Items in a list are tight: their own blocks are joined by single newlines
  // except where a paragraph follows a paragraph.
  const body = renderBlocks(children(item), depth + 1, true);
  return indent(body, marker, ' '.repeat(marker.length));
}

function renderTable(node: AdfNode, depth: number): string {
  const rows = children(node).filter((r) => r.type === 'tableRow');
  if (rows.length === 0) return '';
  const cellText = (cell: AdfNode) =>
    renderBlocks(children(cell), depth + 1)
      .replace(/\\\n/g, ' ')
      .replace(/\n+/g, ' ')
      .trim();
  const grid = rows.map((r) => children(r).map(cellText));
  const width = Math.max(...grid.map((r) => r.length), 1);
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
  return [line(grid[0]), line(Array.from({ length: width }, () => '---')), ...grid.slice(1).map(line)].join('\n');
}

function renderBlock(node: AdfNode, depth: number): string {
  if (depth > MAX_DEPTH) return escapeText(adfPlainText(node));
  const kids = children(node);
  switch (node.type) {
    case 'doc':
      return renderBlocks(kids, depth + 1);
    case 'paragraph':
      return renderInline(kids, depth + 1)
        .split('\n')
        .map(escapeLineStart)
        .join('\n');
    case 'heading': {
      const level = Math.min(6, Math.max(1, Math.trunc(Number(attr(node, 'level'))) || 1));
      const text = renderInline(kids, depth + 1).replace(/\\\n/g, ' ');
      return text ? `${'#'.repeat(level)} ${text}` : '';
    }
    case 'bulletList':
      return kids.map((li) => renderListItem(li, '- ', depth)).join('\n');
    case 'orderedList': {
      const start = Math.max(0, Math.trunc(Number(attr(node, 'order'))) || 1);
      return kids.map((li, i) => renderListItem(li, `${start + i}. `, depth)).join('\n');
    }
    case 'taskList':
    case 'decisionList':
      return kids
        .map((item) => {
          if (item.type === 'taskList' || item.type === 'decisionList') return indent(renderBlock(item, depth + 1), '  ', '  ');
          const done = attrString(item, 'state') === 'DONE' || attrString(item, 'state') === 'DECIDED';
          const marker = node.type === 'taskList' ? (done ? '- [x] ' : '- [ ] ') : '- ';
          const text = renderInline(children(item), depth + 1);
          return indent(text, marker, ' '.repeat(marker.length));
        })
        .join('\n');
    case 'listItem':
      return renderListItem(node, '- ', depth);
    case 'codeBlock': {
      const text = kids.map((k) => (typeof k.text === 'string' ? k.text : adfPlainText(k))).join('');
      const fence = backtickFence(text, 3);
      const lang = attrString(node, 'language').replace(/[^\w+#.-]/g, '');
      return `${fence}${lang}\n${text}\n${fence}`;
    }
    case 'blockquote':
      return indent(renderBlocks(kids, depth + 1), '> ', '> ').replace(/\n\n/g, '\n>\n');
    case 'panel': {
      const label = PANEL_LABELS[attrString(node, 'panelType')] ?? 'Note';
      const body = renderBlocks(kids, depth + 1);
      return indent(`**${label}:** ${body}`, '> ', '> ').replace(/\n\n/g, '\n>\n');
    }
    case 'rule':
      return '---';
    case 'table':
      return renderTable(node, depth);
    case 'expand':
    case 'nestedExpand': {
      const title = attrString(node, 'title');
      const body = renderBlocks(kids, depth + 1);
      return [title ? `**${escapeText(title)}**` : '', body].filter(Boolean).join('\n\n');
    }
    case 'mediaSingle':
    case 'mediaGroup':
    case 'media':
      return escapeText('[attachment]');
    case 'blockCard':
    case 'embedCard': {
      const url = attrString(node, 'url');
      return url ? markdownLink(escapeText(url), url) : '';
    }
    default: {
      // Unknown block: its children as blocks if it has block children, its
      // inline content otherwise, else whatever text it carries.
      if (kids.length) {
        return kids.some((k) => isBlockType(k.type)) ? renderBlocks(kids, depth + 1) : renderBlock({ type: 'paragraph', content: kids }, depth + 1);
      }
      if (INLINE_TYPES.has(String(node.type))) return renderBlock({ type: 'paragraph', content: [node] }, depth + 1);
      const text = typeof node.text === 'string' ? node.text : attrString(node, 'text');
      return text ? escapeLineStart(escapeText(text)) : '';
    }
  }
}

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList', 'decisionList']);

// Block children rendered and joined. Inline nodes sitting directly under a
// container are gathered into one paragraph. In a tight list item a nested
// list follows its text on the next line; everything else is a blank line apart.
function renderBlocks(nodes: AdfNode[], depth: number, tight = false): string {
  const blocks: AdfNode[] = [];
  let run: AdfNode[] | null = null;
  for (const n of nodes) {
    if (isBlockType(n.type)) {
      run = null;
      blocks.push(n);
    } else if (run) {
      run.push(n);
    } else {
      run = [n];
      blocks.push({ type: 'paragraph', content: run });
    }
  }
  let out = '';
  let first = true;
  for (const b of blocks) {
    const md = renderBlock(b, depth);
    if (md === '') continue;
    if (!first) out += tight && LIST_TYPES.has(String(b.type)) ? '\n' : '\n\n';
    out += md;
    first = false;
  }
  return out;
}

/**
 * Markdown for an ADF document (a description or a comment body). A plain
 * string — some fields hold text rather than ADF — is escaped and returned;
 * anything else that is not an ADF node yields ''.
 */
export function adfToMarkdown(doc: unknown): string {
  if (typeof doc === 'string') return doc.split(/\r\n?|\n/).map((l) => escapeLineStart(escapeMarkdown(l))).join('\n');
  if (!isNode(doc)) return '';
  try {
    return renderBlock(doc, 0).replace(/\n{3,}/g, '\n\n').trim();
  } catch {
    // Never throw on remote content: fall back to its text.
    return escapeText(adfPlainText(doc)).trim();
  }
}
