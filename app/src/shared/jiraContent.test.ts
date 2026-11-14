import { describe, expect, it } from 'vitest';
import { mapJiraComment, mapJiraIssueContent } from './jiraContent';

// Fictional values only (ADR-0011 §10).
const body = (text: string) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

describe('mapJiraComment', () => {
  it('maps author, times and the ADF body as Markdown', () => {
    const c = mapJiraComment({
      id: '30001',
      author: { displayName: 'Example User' },
      body: body('Done *now*'),
      created: '2026-11-10T09:00:00.000+0000',
      updated: '2026-11-10T10:30:00.000+0000',
    });
    expect(c).toEqual({
      id: '30001',
      author: 'Example User',
      created: Date.parse('2026-11-10T09:00:00.000Z'),
      updated: Date.parse('2026-11-10T10:30:00.000Z'),
      markdown: 'Done \\*now\\*',
    });
  });

  it('reports an unedited comment as updated null', () => {
    const at = '2026-11-10T09:00:00.000+0000';
    expect(mapJiraComment({ id: '1', created: at, updated: at, body: body('x') }).updated).toBeNull();
  });

  it('tolerates a hidden author, missing times and a missing body', () => {
    expect(mapJiraComment({ id: 7 })).toEqual({ id: '7', author: '', created: null, updated: null, markdown: '' });
    expect(mapJiraComment({ id: '2', author: null, created: 'not a date' }).created).toBeNull();
  });
});

describe('mapJiraIssueContent', () => {
  it('renders the description and keeps comment order', () => {
    const content = mapJiraIssueContent(body('Rotate the key.'), [
      { id: '1', body: body('first') },
      { id: '2', body: body('second') },
    ]);
    expect(content.description).toBe('Rotate the key.');
    expect(content.comments.map((c) => c.markdown)).toEqual(['first', 'second']);
  });

  it('gives an empty description when there is none', () => {
    expect(mapJiraIssueContent(null, [])).toEqual({ description: '', comments: [] });
  });
});
