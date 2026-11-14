import { describe, expect, it } from 'vitest';
import { MAX_DEPTH, adfPlainText, adfToMarkdown, escapeMarkdown } from './adf';

// ADF fixtures in the shapes Jira Cloud REST v3 returns, with fictional
// content (ADR-0011 §10).
type N = Record<string, unknown>;
const doc = (...content: N[]): N => ({ type: 'doc', version: 1, content });
const p = (...content: N[]): N => ({ type: 'paragraph', content });
const t = (text: string, ...marks: N[]): N => (marks.length ? { type: 'text', text, marks } : { type: 'text', text });
const li = (...content: N[]): N => ({ type: 'listItem', content });
const ul = (...items: N[]): N => ({ type: 'bulletList', content: items });
const ol = (items: N[], order?: number): N => ({ type: 'orderedList', ...(order ? { attrs: { order } } : {}), content: items });
const strong = { type: 'strong' };
const em = { type: 'em' };
const code = { type: 'code' };
const link = (href: string) => ({ type: 'link', attrs: { href } });

describe('paragraphs and inline text', () => {
  it('renders paragraphs separated by a blank line', () => {
    expect(adfToMarkdown(doc(p(t('First.')), p(t('Second.'))))).toBe('First.\n\nSecond.');
  });

  it('renders strong, em, strike and inline code marks', () => {
    const md = adfToMarkdown(doc(p(t('Rotate '), t('now', strong), t(', '), t('carefully', em), t(' via '), t('bao kv put', code), t(' '), t('old', { type: 'strike' }))));
    expect(md).toBe('Rotate **now**, _carefully_ via `bao kv put` ~~old~~');
  });

  it('keeps spaces outside emphasis so it still parses', () => {
    expect(adfToMarkdown(doc(p(t('a'), t(' bold ', strong), t('b'))))).toBe('a **bold** b');
  });

  it('turns a hard break into a Markdown line break', () => {
    expect(adfToMarkdown(doc(p(t('line one'), { type: 'hardBreak' }, t('line two'))))).toBe('line one\\\nline two');
  });

  it('drops marks Markdown cannot show (colour, underline, subsup)', () => {
    const md = adfToMarkdown(doc(p(t('red', { type: 'textColor', attrs: { color: '#ff0000' } }), t(' and '), t('under', { type: 'underline' }), t('2', { type: 'subsup', attrs: { type: 'sup' } }))));
    expect(md).toBe('red and under2');
  });

  it('renders headings at their level, clamped to 1–6', () => {
    expect(adfToMarkdown(doc({ type: 'heading', attrs: { level: 2 }, content: [t('Plan')] }))).toBe('## Plan');
    expect(adfToMarkdown(doc({ type: 'heading', attrs: { level: 9 }, content: [t('Deep')] }))).toBe('###### Deep');
    expect(adfToMarkdown(doc({ type: 'heading', content: [t('No level')] }))).toBe('# No level');
  });
});

describe('escaping — ADF text never becomes Markdown syntax', () => {
  it('escapes inline syntax characters', () => {
    expect(adfToMarkdown(doc(p(t('*not bold* _x_ `y` [z](u) <b>html</b> a|b ~~s~~'))))).toBe(
      '\\*not bold\\* \\_x\\_ \\`y\\` \\[z\\](u) \\<b\\>html\\</b\\> a\\|b \\~\\~s\\~\\~',
    );
  });

  it('escapes block markers at the start of a line', () => {
    expect(adfToMarkdown(doc(p(t('# not a heading'))))).toBe('\\# not a heading');
    expect(adfToMarkdown(doc(p(t('> not a quote'))))).toBe('\\> not a quote');
    expect(adfToMarkdown(doc(p(t('- not a list'))))).toBe('\\- not a list');
    expect(adfToMarkdown(doc(p(t('1. not a list'))))).toBe('1\\. not a list');
    expect(adfToMarkdown(doc(p(t('mid-line - and 2. are fine'))))).toBe('mid-line - and 2. are fine');
  });

  it('lets inline code hold backticks', () => {
    expect(adfToMarkdown(doc(p(t('a `b` c', code))))).toBe('``a `b` c``');
    expect(adfToMarkdown(doc(p(t('`edge`', code))))).toBe('`` `edge` ``');
  });

  it('escapeMarkdown covers HTML openers', () => {
    expect(escapeMarkdown('<script>alert(1)</script>')).toBe('\\<script\\>alert(1)\\</script\\>');
  });
});

describe('lists', () => {
  it('renders a bullet list', () => {
    expect(adfToMarkdown(doc(ul(li(p(t('alpha'))), li(p(t('beta'))))))).toBe('- alpha\n- beta');
  });

  it('renders an ordered list from its start number', () => {
    expect(adfToMarkdown(doc(ol([li(p(t('one'))), li(p(t('two')))])))).toBe('1. one\n2. two');
    expect(adfToMarkdown(doc(ol([li(p(t('five'))), li(p(t('six')))], 5)))).toBe('5. five\n6. six');
  });

  it('nests lists under their item, indented to the marker', () => {
    const md = adfToMarkdown(doc(ul(li(p(t('parent')), ol([li(p(t('child a'))), li(p(t('child b')))])), li(p(t('sibling'))))));
    expect(md).toBe('- parent\n  1. child a\n  2. child b\n- sibling');
  });

  it('keeps a second paragraph in an item indented and a blank line apart', () => {
    expect(adfToMarkdown(doc(ol([li(p(t('first')), p(t('more')))])))).toBe('1. first\n\n   more');
  });

  it('renders task lists with their state', () => {
    const tasks = {
      type: 'taskList',
      attrs: { localId: 'l1' },
      content: [
        { type: 'taskItem', attrs: { localId: 't1', state: 'DONE' }, content: [t('backup')] },
        { type: 'taskItem', attrs: { localId: 't2', state: 'TODO' }, content: [t('restore test')] },
      ],
    };
    expect(adfToMarkdown(doc(tasks))).toBe('- [x] backup\n- [ ] restore test');
  });
});

describe('code', () => {
  it('renders a code block with its language, unescaped', () => {
    const block = { type: 'codeBlock', attrs: { language: 'bash' }, content: [t('echo "*" > /tmp/x\nls -l')] };
    expect(adfToMarkdown(doc(block))).toBe('```bash\necho "*" > /tmp/x\nls -l\n```');
  });

  it('lengthens the fence past backticks in the code, and sanitises the language', () => {
    const block = { type: 'codeBlock', attrs: { language: 'md`x y' }, content: [t('```\ninner\n```')] };
    expect(adfToMarkdown(doc(block))).toBe('````mdxy\n```\ninner\n```\n````');
  });

  it('renders a code block with no language or content', () => {
    expect(adfToMarkdown(doc({ type: 'codeBlock' }))).toBe('```\n\n```');
  });
});

describe('links', () => {
  it('renders a link mark', () => {
    expect(adfToMarkdown(doc(p(t('See '), t('the runbook', link('https://example.com/run book(1)')))))).toBe(
      'See [the runbook](https://example.com/run%20book%281%29)',
    );
  });

  it('keeps marks inside the link text', () => {
    expect(adfToMarkdown(doc(p(t('docs', strong, link('https://example.com')))))).toBe('[**docs**](https://example.com)');
  });

  it('allows mailto', () => {
    expect(adfToMarkdown(doc(p(t('mail', link('mailto:user@example.com')))))).toBe('[mail](mailto:user@example.com)');
  });

  it('reduces an unsafe scheme to its text', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', '']) {
      expect(adfToMarkdown(doc(p(t('click', link(href)))))).toBe('click');
    }
  });

  it('renders smart links (inline, block and embed cards)', () => {
    expect(adfToMarkdown(doc(p(t('PR: '), { type: 'inlineCard', attrs: { url: 'https://example.com/pr/1' } })))).toBe(
      'PR: [https://example.com/pr/1](https://example.com/pr/1)',
    );
    expect(adfToMarkdown(doc({ type: 'blockCard', attrs: { url: 'https://example.com/d' } }))).toBe('[https://example.com/d](https://example.com/d)');
    // An unsafe URL stays visible as text, never as a link.
    expect(adfToMarkdown(doc({ type: 'embedCard', attrs: { url: 'javascript:x' } }))).toBe('javascript:x');
  });
});

describe('mentions and other inline atoms', () => {
  it('renders a mention as @Name', () => {
    const m = (text?: string) => ({ type: 'mention', attrs: { id: '5b10a2844c20165700ede21g', ...(text !== undefined ? { text } : {}), accessLevel: '' } });
    expect(adfToMarkdown(doc(p(t('cc '), m('@Example User'))))).toBe('cc @Example User');
    expect(adfToMarkdown(doc(p(m('Example User'))))).toBe('@Example User');
    expect(adfToMarkdown(doc(p(m())))).toBe('@user');
  });

  it('escapes a mention name', () => {
    expect(adfToMarkdown(doc(p({ type: 'mention', attrs: { text: '@_x_' } })))).toBe('@\\_x\\_');
  });

  it('renders emoji, dates and status lozenges as text', () => {
    expect(adfToMarkdown(doc(p({ type: 'emoji', attrs: { shortName: ':smile:', text: '😄' } }, t(' '), { type: 'emoji', attrs: { shortName: ':x:' } })))).toBe('😄 :x:');
    expect(adfToMarkdown(doc(p(t('due '), { type: 'date', attrs: { timestamp: String(Date.UTC(2026, 10, 20)) } })))).toBe('due 2026-11-20');
    expect(adfToMarkdown(doc(p({ type: 'status', attrs: { text: 'IN REVIEW', color: 'blue' } })))).toBe('\\[IN REVIEW\\]');
  });
});

describe('quotes, panels, rules, tables, expands', () => {
  it('renders a blockquote, blank lines included', () => {
    expect(adfToMarkdown(doc({ type: 'blockquote', content: [p(t('one')), p(t('two'))] }))).toBe('> one\n>\n> two');
  });

  it('renders a panel as a labelled quote', () => {
    expect(adfToMarkdown(doc({ type: 'panel', attrs: { panelType: 'warning' }, content: [p(t('Mind the gap.'))] }))).toBe('> **Warning:** Mind the gap.');
    expect(adfToMarkdown(doc({ type: 'panel', attrs: { panelType: 'custom' }, content: [p(t('x'))] }))).toBe('> **Note:** x');
  });

  it('renders a rule', () => {
    expect(adfToMarkdown(doc(p(t('a')), { type: 'rule' }, p(t('b'))))).toBe('a\n\n---\n\nb');
  });

  it('renders a table as GFM, escaping pipes and flattening cells', () => {
    const cell = (type: string, ...content: N[]) => ({ type, attrs: {}, content });
    const table = {
      type: 'table',
      attrs: { isNumberColumnEnabled: false, layout: 'default' },
      content: [
        { type: 'tableRow', content: [cell('tableHeader', p(t('Host'))), cell('tableHeader', p(t('Role')))] },
        { type: 'tableRow', content: [cell('tableCell', p(t('web1'))), cell('tableCell', p(t('a|b')), p(t('two lines')))] },
        { type: 'tableRow', content: [cell('tableCell', p(t('short row')))] },
      ],
    };
    expect(adfToMarkdown(doc(table))).toBe('| Host | Role |\n| --- | --- |\n| web1 | a\\|b two lines |\n| short row |  |');
  });

  it('renders an expand as its title then its content', () => {
    expect(adfToMarkdown(doc({ type: 'expand', attrs: { title: 'Details' }, content: [p(t('hidden'))] }))).toBe('**Details**\n\nhidden');
  });

  it('replaces media with an attachment placeholder', () => {
    const media = { type: 'mediaSingle', attrs: { layout: 'center' }, content: [{ type: 'media', attrs: { id: 'abc', type: 'file', collection: '' } }] };
    expect(adfToMarkdown(doc(p(t('Screenshot:')), media))).toBe('Screenshot:\n\n\\[attachment\\]');
  });
});

describe('unsupported nodes degrade to text', () => {
  it('renders an unknown block by its children', () => {
    const ext = { type: 'bodiedExtension', attrs: { extensionKey: 'x' }, content: [p(t('inside'))] };
    expect(adfToMarkdown(doc(ext))).toBe('inside');
  });

  it('renders an unknown inline node by its text', () => {
    expect(adfToMarkdown(doc(p(t('a '), { type: 'inlineExtension', attrs: { text: 'macro *text*' } }, t(' b'))))).toBe('a macro \\*text\\* b');
    expect(adfToMarkdown(doc(p(t('a '), { type: 'futureInline', text: 'raw' })))).toBe('a raw');
  });

  it('renders an unknown leaf with no text as nothing, without throwing', () => {
    expect(adfToMarkdown(doc(p(t('kept')), { type: 'extension', attrs: { extensionKey: 'jira-macro' } }))).toBe('kept');
  });

  it('gathers stray inline nodes under the doc into a paragraph', () => {
    expect(adfToMarkdown(doc(t('loose '), t('text', strong), p(t('next'))))).toBe('loose **text**\n\nnext');
  });

  it('flattens nesting past MAX_DEPTH to text instead of overflowing', () => {
    let node: N = p(t('bottom'));
    for (let i = 0; i < MAX_DEPTH * 5; i++) node = { type: 'blockquote', content: [node] };
    const md = adfToMarkdown(doc(node));
    expect(md).toContain('bottom');
  });

  it('tolerates malformed input', () => {
    expect(adfToMarkdown(null)).toBe('');
    expect(adfToMarkdown(undefined)).toBe('');
    expect(adfToMarkdown(42)).toBe('');
    expect(adfToMarkdown([])).toBe('');
    expect(adfToMarkdown({ type: 'doc' })).toBe('');
    expect(adfToMarkdown({ type: 'doc', content: 'nope' })).toBe('');
    expect(adfToMarkdown(doc(p({ type: 'text' }), p(t('ok')), null as unknown as N, 'x' as unknown as N))).toBe('ok');
    expect(adfToMarkdown(doc({ type: 'heading', attrs: null, content: [t('h')] }))).toBe('# h');
  });

  it('escapes a plain-string field rather than reading it as Markdown', () => {
    expect(adfToMarkdown('# Title\n*x*')).toBe('\\# Title\n\\*x\\*');
  });
});

describe('adfPlainText', () => {
  it('collects the text with lines between blocks', () => {
    expect(adfPlainText(doc(p(t('a'), { type: 'hardBreak' }, t('b')), ul(li(p(t('c'))))))).toBe('a\nb\nc');
  });
});
