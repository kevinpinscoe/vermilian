// A Jira issue's description and comments, rendered read-only as Markdown
// (VERM-32). The detail panel shows these (VERM-35); nothing here writes.
//
// Pure TypeScript: no Electron, no React.

import { adfToMarkdown } from './adf';

export interface JiraCommentView {
  id: string;
  author: string; // display name; '' when hidden
  created: number | null; // epoch ms
  updated: number | null; // epoch ms; null when never edited
  markdown: string;
}

export interface JiraIssueContent {
  description: string; // Markdown; '' when there is none
  comments: JiraCommentView[]; // oldest first
}

/** A comment as GET /issue/{key}/comment returns it; every part optional. */
export interface JiraCommentInput {
  id?: unknown;
  author?: { displayName?: unknown } | null;
  body?: unknown;
  created?: unknown;
  updated?: unknown;
}

function epochMs(v: unknown): number | null {
  if (typeof v !== 'string' || v === '') return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

export function mapJiraComment(c: JiraCommentInput): JiraCommentView {
  const created = epochMs(c.created);
  const updated = epochMs(c.updated);
  return {
    id: typeof c.id === 'string' ? c.id : String(c.id ?? ''),
    author: typeof c.author?.displayName === 'string' ? c.author.displayName : '',
    created,
    updated: updated !== null && updated !== created ? updated : null,
    markdown: adfToMarkdown(c.body),
  };
}

export function mapJiraIssueContent(description: unknown, comments: readonly JiraCommentInput[]): JiraIssueContent {
  return { description: adfToMarkdown(description), comments: comments.map(mapJiraComment) };
}
