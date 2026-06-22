// In-memory fake YouTrack used ONLY under the e2e harness (VERMILIAN_E2E=1).
// Mirrors the surface of api/youtrack.ts so api/client.ts can swap it in. All
// state is process-local, so each app launch (each test) starts from the same
// deterministic fixtures and mutations never leave the process.

import type { BoardIssue, BoardIssueFields, IssueDetail } from '../../shared/workspace';
import type {
  YouTrackProject,
  CreateIssuePayload,
  CreateIssueResult,
  StandupIssues,
  VermilianArticle,
} from './youtrack';

// ─── Fixtures ──────────────────────────────────────────────────────────────────
// Project 0 ("Test Project") is the one e2e navigates into first; it deliberately
// has >=2 status groups and >=3 issues in one group so the reorder / between-group
// tests have enough data and never skip.

const PROJECTS: YouTrackProject[] = [
  { id: '0-e1', shortName: 'TEST', name: 'Test Project' },
  { id: '0-e2', shortName: 'TST2', name: 'Test Project Two' },
  // Name contains "Inbox" so the board header / nav show the Inbox indicator.
  { id: '0-e3', shortName: 'INB', name: 'Team Inbox' },
];

function emptyFields(over: Partial<BoardIssueFields>): BoardIssueFields {
  return {
    status: null, priority: null, category: null, dueDate: null,
    ticket: null, ticketLink: null, trackingLink: null, notes: null,
    dateTimeEntered: null, assignee: null, ...over,
  };
}

interface FakeIssue extends BoardIssue {
  projectId: string;
}

function makeIssues(): FakeIssue[] {
  const mk = (
    n: number, projectId: string, prefix: string, status: string, priority: string,
  ): FakeIssue => ({
    id: `${projectId}-${n}`,
    idReadable: `${prefix}-${n}`,
    summary: `${status} task ${n}`,
    resolved: null,
    projectId,
    fields: emptyFields({ status, priority, category: 'TASK', ticket: `JIRA-${n}` }),
  });
  return [
    // TEST: 4 in "To do", 2 in "In Progress" → >=2 groups, >=3 in one group
    mk(1, '0-e1', 'TEST', 'To do', 'Normal'),
    mk(2, '0-e1', 'TEST', 'To do', 'Critical'),
    mk(3, '0-e1', 'TEST', 'To do', 'Minor'),
    mk(4, '0-e1', 'TEST', 'To do', 'Major'),
    mk(5, '0-e1', 'TEST', 'In Progress', 'Normal'),
    mk(6, '0-e1', 'TEST', 'In Progress', 'Critical'),
    // TST2: a couple so cross-board moves have a destination
    mk(1, '0-e2', 'TST2', 'To do', 'Normal'),
    mk(2, '0-e2', 'TST2', 'In Progress', 'Major'),
    // INB: one issue so the Inbox board renders content
    mk(1, '0-e3', 'INB', 'To do', 'Normal'),
  ];
}

// ─── Mutable state ──────────────────────────────────────────────────────────────

let issues: FakeIssue[] = makeIssues();
let article: { id: string; content: string; updated: number } | null = null;
let seq = 1000;

function projectById(id: string): YouTrackProject | undefined {
  return PROJECTS.find((p) => p.id === id);
}
function projectByShortName(sn: string): YouTrackProject | undefined {
  return PROJECTS.find((p) => p.shortName === sn);
}

// ─── Surface (mirrors api/youtrack.ts) ──────────────────────────────────────────

export async function getCurrentUser(_url: string, _token: string): Promise<string> {
  return 'E2E Tester';
}

export async function getWorklogTypes(_url: string, _token: string): Promise<string[]> {
  return ['Development'];
}

export async function getProjects(_url: string, _token: string): Promise<YouTrackProject[]> {
  return PROJECTS.map((p) => ({ ...p }));
}

function toBoardIssue(i: FakeIssue): BoardIssue {
  return { id: i.id, idReadable: i.idReadable, summary: i.summary, resolved: i.resolved, fields: { ...i.fields } };
}

export async function getIssues(
  _url: string, _token: string, projectShortName: string, includeResolved = false,
): Promise<BoardIssue[]> {
  const proj = projectByShortName(projectShortName);
  if (!proj) return [];
  return issues
    .filter((i) => i.projectId === proj.id && (includeResolved || i.resolved === null))
    .map(toBoardIssue);
}

export async function getIssueDetail(_url: string, _token: string, issueId: string): Promise<IssueDetail> {
  const i = issues.find((x) => x.id === issueId || x.idReadable === issueId);
  if (!i) throw { status: 404, message: 'Issue not found' };
  const proj = projectById(i.projectId) ?? PROJECTS[0];
  return { ...toBoardIssue(i), project: { id: proj.id, name: proj.name, shortName: proj.shortName } };
}

export async function patchIssue(
  _url: string, _token: string, issueId: string, field: string, value: string | number | null,
): Promise<void> {
  const i = issues.find((x) => x.id === issueId || x.idReadable === issueId);
  if (!i) return;
  if (field === 'summary') { i.summary = String(value ?? ''); return; }
  (i.fields as unknown as Record<string, unknown>)[field] = value;
}

export async function moveIssue(
  _url: string, _token: string, issueId: string, targetProjectId: string,
): Promise<void> {
  const i = issues.find((x) => x.id === issueId || x.idReadable === issueId);
  if (i && projectById(targetProjectId)) i.projectId = targetProjectId;
}

export async function createIssue(
  _url: string, _token: string, payload: CreateIssuePayload,
): Promise<CreateIssueResult> {
  const proj = projectById(payload.projectId) ?? PROJECTS[0];
  const n = ++seq;
  const issue: FakeIssue = {
    id: `${proj.id}-${n}`,
    idReadable: `${proj.shortName}-${n}`,
    summary: payload.summary,
    resolved: null,
    projectId: proj.id,
    fields: emptyFields({
      status: payload.status, priority: payload.priority, category: payload.category,
      dueDate: payload.dueDate, ticket: payload.ticket, ticketLink: payload.ticketLink,
      trackingLink: payload.trackingLink, notes: payload.notes,
    }),
  };
  issues.push(issue);
  return { id: issue.id, idReadable: issue.idReadable };
}

export async function deleteIssue(_url: string, _token: string, issueId: string): Promise<void> {
  issues = issues.filter((x) => x.id !== issueId && x.idReadable !== issueId);
}

export async function postWorklog(
  _url: string, _token: string, _issueId: string, _minutes: number, _worklogType: string,
): Promise<void> {
  // no-op in the fake
}

export async function getIssuesForStandup(
  _url: string, _token: string, _projectShortNames: string[], _cutoffMs: number,
): Promise<StandupIssues> {
  return { done: [], inProgress: [], blocked: [] };
}

// ─── _vermilian-config Article (in-memory) ──────────────────────────────────────

export async function findVermilianArticle(_url: string, _token: string): Promise<VermilianArticle | null> {
  return article ? { id: article.id, content: article.content, updated: article.updated } : null;
}

export async function createVermilianArticle(
  _url: string, _token: string, content: string,
): Promise<VermilianArticle | null> {
  article = { id: 'e2e-article', content, updated: Date.now() };
  return { id: article.id, content: article.content, updated: article.updated };
}

export async function updateVermilianArticle(
  _url: string, _token: string, articleId: string, content: string,
): Promise<{ updated: number } | null> {
  article = { id: articleId, content, updated: Date.now() };
  return { updated: article.updated };
}

export async function getVermilianArticle(
  _url: string, _token: string, articleId: string,
): Promise<VermilianArticle | null> {
  if (!article || article.id !== articleId) return null;
  return { id: article.id, content: article.content, updated: article.updated };
}
