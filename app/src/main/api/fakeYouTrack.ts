// In-memory fake YouTrack used ONLY under the e2e harness (VERMILIAN_E2E=1).
// Mirrors the surface of api/youtrack.ts so api/client.ts can swap it in. All
// state is process-local, so each app launch (each test) starts from the same
// deterministic fixtures and mutations never leave the process.

import { mapYouTrackLinkTypes, type TrackerLinkType } from '../../shared/workspacePrerequisites';
import { refFromE2eFakeYouTrackToken } from '../../shared/e2eFakeCredentials';
import type { ArticleFetch } from '../services/masterPlan';
import type { BoardIssue, BoardIssueFields, IssueDetail, ParentEpic } from '../../shared/workspace';
import type { IssueLink } from '../../shared/issueLink';
import { FIELD_KEYS, type FieldKey } from '../../shared/fields';
import { parseYouTrackProjectFields, type YouTrackProjectMetadata } from '../../shared/youtrackProjectFields';
import { buildStandupQuery, standupGroupFor, type StandupPlan } from '../../shared/youtrackStandup';
import type {
  YouTrackProject,
  CreateIssuePayload,
  CreateIssueResult,
  StandupIssues,
  VermilianArticle,
  ArticleLookupResult,
  MasterPlanDiscovery,
  RecommendationIssue,
  WorkspaceArticleListing,
} from './youtrack';
// Same paging bounds as the real client (the fake reads one in-memory page).
export { STANDUP_PAGE_SIZE } from './youtrack';
import { WORKSPACE_ARTICLE_PREFIX, workspaceArticleTitle } from '../../shared/workspaceArticle';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { STORAGE_MARKER_TITLE, serialiseStorageMarker } from '../../shared/storageActivation';

// ─── Fixtures ──────────────────────────────────────────────────────────────────
// Project 0 ("Test Project") is the one e2e navigates into first; it deliberately
// has >=2 status groups and >=3 issues in one group so the reorder / between-group
// tests have enough data and never skip.

// VERMILIAN_E2E_YT_RUNWAY_FIXTURES=1 adds the Workspace Runway projects READ,
// SYNC and PLAT and their links (VERM-94), for the blocker tests. Off, the
// fake is exactly as it was, so no other e2e test sees extra projects.
const RUNWAY_FIXTURES = process.env.VERMILIAN_E2E_YT_RUNWAY_FIXTURES === '1';
const RUNWAY_PROJECTS: YouTrackProject[] = [
  { id: '0-e5', shortName: 'READ', name: 'Reader App' },
  { id: '0-e6', shortName: 'SYNC', name: 'Sync Engine' },
  { id: '0-e7', shortName: 'PLAT', name: 'Platform' },
];

// VERMILIAN_E2E_YT_PREFIX_FIXTURES=1 adds projects whose long names look alike
// and where one is a prefix of the others, as on the real instance ("Kevin"
// beside "Kevin - PIM") — for the picker's short-name display and ranking
// (VERM-120). KEVIN is listed last so ranking, not input order, must lift it.
const PREFIX_FIXTURES = process.env.VERMILIAN_E2E_YT_PREFIX_FIXTURES === '1';
const PREFIX_PROJECTS: YouTrackProject[] = [
  { id: '0-e8', shortName: 'KPD', name: 'Kevin - Personal data' },
  { id: '0-e9', shortName: 'PIM', name: 'Kevin - PIM' },
  { id: '0-e10', shortName: 'KEVIN', name: 'Kevin' },
];

const PROJECTS: YouTrackProject[] = [
  { id: '0-e1', shortName: 'TEST', name: 'Test Project' },
  { id: '0-e2', shortName: 'TST2', name: 'Test Project Two' },
  // Name contains "Inbox" so the board header / nav show the Inbox indicator.
  { id: '0-e3', shortName: 'INB', name: 'Team Inbox' },
  // Deliberately has zero issues so the "No tasks in this project yet" empty
  // state can be exercised. Kept last so existing .first()/.nth() nav selectors
  // stay stable.
  { id: '0-e4', shortName: 'EMP', name: 'Empty Project' },
  ...(RUNWAY_FIXTURES ? RUNWAY_PROJECTS : []),
  ...(PREFIX_FIXTURES ? PREFIX_PROJECTS : []),
];

function emptyFields(over: Partial<BoardIssueFields>): BoardIssueFields {
  // The tuple needs an explicit type: with strictNullChecks off, `null` infers
  // as `any`, so the callback's return type contains an implicit any.
  const base = Object.fromEntries(
    FIELD_KEYS.map((k): [FieldKey, null] => [k, null]),
  ) as BoardIssueFields;
  return { ...base, ...over };
}

interface FakeIssue extends BoardIssue {
  projectId: string;
}

function makeIssues(): FakeIssue[] {
  const mk = (
    n: number, projectId: string, prefix: string, status: string, priority: string,
    dueDate: number | null = null,
    parentEpic: ParentEpic | null = null,
    isEpic = false,
  ): FakeIssue => ({
    id: `${projectId}-${n}`,
    idReadable: `${prefix}-${n}`,
    summary: `${status} task ${n}`,
    resolved: null,
    projectId,
    fields: emptyFields({ status, priority, category: 'TASK', ticket: `JIRA-${n}`, dueDate }),
    parentEpic,
    isEpic,
  });
  // Two TEST issues carry fixed due dates so the Due Date filter is testable:
  // TEST-1 is before 2026-06-15, TEST-2 is after it; the rest are undated.
  const DUE_EARLY = new Date('2026-06-10T00:00:00').getTime();
  const DUE_LATE = new Date('2026-06-20T00:00:00').getTime();
  // VERM-7: TEST-3 and TEST-4 double as Epics for a couple of their siblings,
  // reusing existing fixture issues rather than adding new rows — this keeps
  // every pre-existing .first()/.nth()-based e2e selector stable. TEST-3 has
  // two subtasks (TEST-1, TEST-2); TEST-4 has one (TEST-5); TEST-6 and every
  // TST2/INB issue carry no parent Epic at all. Only TEST-3 is itself flagged
  // isEpic: true — TEST-4 stays an ordinary (non-Epic) fixture so the
  // existing deterministic-ordering assertions, which expect TEST-4 to
  // appear as a displayed candidate, are unaffected; TEST-3 was already
  // excluded from the displayed seven by the cap either way, so flagging it
  // isEpic changes *why* it's absent (never eligible, not just capped out)
  // without changing any existing visible-candidate assertion.
  const EPIC_TEST_3: ParentEpic = { id: '0-e1-3', idReadable: 'TEST-3', summary: 'To do task 3' };
  const EPIC_TEST_4: ParentEpic = { id: '0-e1-4', idReadable: 'TEST-4', summary: 'To do task 4' };
  // VERM-62: assignees for the Assignee filter, applied after construction so
  // every row above keeps its position. 'e2e-user' is the login the
  // assignee-filter spec configures as "Me"; every other issue is unassigned.
  const ASSIGNEES: Record<string, string> = {
    'TEST-1': 'e2e-user', 'TEST-5': 'e2e-user', 'TEST-2': 'alice', 'TST2-2': 'bob',
  };
  const withAssignee = (i: FakeIssue): FakeIssue =>
    ({ ...i, fields: { ...i.fields, assignee: ASSIGNEES[i.idReadable] ?? null } });
  return [
    // TEST: 4 in "To do", 2 in "In Progress" → >=2 groups, >=3 in one group
    mk(1, '0-e1', 'TEST', 'To do', 'Normal', DUE_EARLY, EPIC_TEST_3),
    mk(2, '0-e1', 'TEST', 'To do', 'Critical', DUE_LATE, EPIC_TEST_3),
    mk(3, '0-e1', 'TEST', 'To do', 'Minor', null, null, true),
    mk(4, '0-e1', 'TEST', 'To do', 'Major'),
    mk(5, '0-e1', 'TEST', 'In Progress', 'Normal', null, EPIC_TEST_4),
    mk(6, '0-e1', 'TEST', 'In Progress', 'Critical'),
    // TST2: a couple so cross-board moves have a destination
    mk(1, '0-e2', 'TST2', 'To do', 'Normal'),
    mk(2, '0-e2', 'TST2', 'In Progress', 'Major'),
    // INB: one issue so the Inbox board renders content
    mk(1, '0-e3', 'INB', 'To do', 'Normal'),
    // The spec's synthetic schedule (VERM-94), behind RUNWAY_FIXTURES.
    ...(RUNWAY_FIXTURES ? runwayFixtureIssues(mk) : []),
  ].map(withAssignee);
}

type MkIssue = (n: number, projectId: string, prefix: string, status: string, priority: string) => FakeIssue;

function runwayFixtureIssues(mk: MkIssue): FakeIssue[] {
  const named = (issue: FakeIssue, summary: string): FakeIssue => ({ ...issue, summary });
  return [
    named(mk(9, '0-e5', 'READ', 'To do', 'Minor'), 'First attempt at offline reading'),
    named(mk(12, '0-e5', 'READ', 'To do', 'Major'), 'Cache articles locally'),
    named(mk(14, '0-e5', 'READ', 'To do', 'Normal'), 'Sync read state between devices'),
    named(mk(20, '0-e5', 'READ', 'To do', 'Normal'), 'Offline indicator in the toolbar'),
    named(mk(3, '0-e6', 'SYNC', 'In Progress', 'Critical'), 'Conflict-free merge library'),
    named(mk(7, '0-e6', 'SYNC', 'To do', 'Major'), 'Background sync worker'),
    named(mk(40, '0-e7', 'PLAT', 'In Progress', 'Major'), 'Device token service'),
  ];
}

// ─── Links (VERM-94) ──────────────────────────────────────────────────────────
// Link types worded as the live server's /api/issueLinkTypes words them.
const FAKE_LINK_TYPES = {
  Depend: { directed: true, sourceToTarget: 'is required for', targetToSource: 'depends on' },
  Relates: { directed: false, sourceToTarget: 'relates to', targetToSource: '' },
  Subtask: { directed: true, sourceToTarget: 'parent for', targetToSource: 'subtask of' },
} as const;

/** `source` <type's sourceToTarget> `target`: SYNC-3 "is required for" READ-14. */
interface FakeLink {
  type: keyof typeof FAKE_LINK_TYPES;
  source: string;
  target: string;
}

const FAKE_LINKS: FakeLink[] = RUNWAY_FIXTURES
  ? [
      { type: 'Depend', source: 'SYNC-3', target: 'READ-14' }, // READ-14 depends on SYNC-3
      { type: 'Depend', source: 'PLAT-40', target: 'SYNC-7' }, // SYNC-7 depends on PLAT-40 (outside the Runway)
      { type: 'Relates', source: 'READ-12', target: 'READ-9' }, // never a blocker
      { type: 'Subtask', source: 'READ-12', target: 'READ-20' }, // parent and child: never a blocker
    ]
  : [];

/**
 * An issue's links as the real client maps them: direction from this issue's
 * side, and the linked issue's resolved state read now, so resolving a
 * prerequisite shows on the next read.
 */
function fakeLinksOf(idReadable: string): IssueLink[] {
  const out: IssueLink[] = [];
  for (const l of FAKE_LINKS) {
    const t = FAKE_LINK_TYPES[l.type];
    const side = l.source === idReadable ? 'source' : l.target === idReadable ? 'target' : null;
    if (!side) continue;
    const other = issues.find((i) => i.idReadable === (side === 'source' ? l.target : l.source));
    if (!other) continue;
    const direction = !t.directed ? 'both' : side === 'source' ? 'outward' : 'inward';
    out.push({
      type: l.type,
      directed: t.directed,
      direction,
      verb: direction === 'inward' ? t.targetToSource : t.sourceToTarget,
      issue: { id: other.id, key: other.idReadable, summary: other.summary, resolved: other.resolved !== null, status: other.fields.status ?? null },
    });
  }
  return out;
}

// ─── Mutable state ──────────────────────────────────────────────────────────────

let issues: FakeIssue[] = makeIssues();
// VERMILIAN_E2E_ARTICLE_CONTENT seeds the fake _vermilian-config Article's
// initial body, simulating a machine whose shared server-side config already
// differs from whatever this launch's local workspace-config.json holds.
let article: { id: string; content: string; updated: number } | null =
  process.env.VERMILIAN_E2E_ARTICLE_CONTENT
    ? { id: 'e2e-article', content: process.env.VERMILIAN_E2E_ARTICLE_CONTENT, updated: Date.now() }
    : null;
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
  // Set VERMILIAN_E2E_YT_401=1 to simulate a revoked/expired token, so the
  // connection banner and its escape hatch can be tested. Mirrors the shape
  // api/youtrack.ts throws: a plain { status, message } object, not an Error.
  if (process.env.VERMILIAN_E2E_YT_401 === '1') {
    throw { status: 401, message: 'Unauthorized' };
  }
  return PROJECTS.map((p) => ({ ...p }));
}

// e2e-only (VERM-120): rename a project as an edit in YouTrack's project
// settings would, while the app runs. The id and short name are unchanged.
export function renameProjectForTests(shortName: string, name: string): boolean {
  const project = PROJECTS.find((p) => p.shortName === shortName);
  if (!project || typeof name !== 'string' || !name) return false;
  project.name = name;
  return true;
}

// Each project's Priority bundle order (VERM-92). The built-in list unless
// VERMILIAN_E2E_YT_PRIORITY_BUNDLES seeds a project's own order, as JSON
// { "<shortName>": ["most urgent", …] }, so a test can prove the board reads
// the project's bundle rather than the built-in list.
export async function getPriorityOrder(_url: string, _token: string, projectShortName: string): Promise<string[]> {
  let seeded: Record<string, unknown> = {};
  try {
    seeded = JSON.parse(process.env.VERMILIAN_E2E_YT_PRIORITY_BUNDLES ?? '{}') as Record<string, unknown>;
  } catch { /* unseeded */ }
  const own = seeded[projectShortName];
  if (Array.isArray(own)) return own.filter((v): v is string => typeof v === 'string');
  return [...FAKE_PRIORITY_VALUES];
}

// The live server's four link types (checked 2026-11-23), plus a custom type
// worded the other way round, for the prerequisite picker (VERM-96).
// VERMILIAN_E2E_LINK_TYPES_FAIL=1 makes the read fail, as an unreachable
// server would.
const FAKE_LINK_TYPE_LIST = [
  { name: 'Relates', directed: false, sourceToTarget: 'relates to', targetToSource: '' },
  { name: 'Depend', directed: true, sourceToTarget: 'is required for', targetToSource: 'depends on' },
  { name: 'Duplicate', directed: true, sourceToTarget: 'is duplicated by', targetToSource: 'duplicates' },
  { name: 'Subtask', directed: true, sourceToTarget: 'parent for', targetToSource: 'subtask of' },
  { name: 'Required by', directed: true, sourceToTarget: 'needs', targetToSource: 'is needed by' },
];

export async function getLinkTypes(_url: string, _token: string): Promise<TrackerLinkType[]> {
  if (process.env.VERMILIAN_E2E_LINK_TYPES_FAIL === '1') throw new Error('YouTrack could not be reached.');
  return mapYouTrackLinkTypes(FAKE_LINK_TYPE_LIST);
}

function toBoardIssue(i: FakeIssue): BoardIssue {
  return {
    id: i.id,
    idReadable: i.idReadable,
    summary: i.summary,
    resolved: i.resolved,
    fields: { ...i.fields },
    parentEpic: i.parentEpic,
    isEpic: i.isEpic,
    links: fakeLinksOf(i.idReadable),
  };
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

export async function searchIssues(
  _url: string, _token: string, projectShortNames: string[], userQuery: string,
): Promise<BoardIssue[]> {
  const terms = userQuery.trim().toLowerCase();
  const projectIds = new Set(
    projectShortNames
      .map((sn) => projectByShortName(sn)?.id)
      .filter((id): id is string => Boolean(id)),
  );
  if (!projectIds.size || !terms) return [];
  return issues
    .filter((i) => projectIds.has(i.projectId))
    .filter(
      (i) =>
        i.summary.toLowerCase().includes(terms) ||
        i.idReadable.toLowerCase().includes(terms),
    )
    .map(toBoardIssue);
}

// Runway tickets by ID (VERM-84). Like the real server, one unknown ID fails
// the whole batch query with 400.
// e2e-only (VERM-105): VERMILIAN_E2E_YT_MOVED_KEYS maps an old key to the key
// its issue has now ({"READ-101":"READ-12"}): a single read of the old key
// answers with the moved issue, as YouTrack does. VERMILIAN_E2E_YT_UNREADABLE
// lists keys whose reads fail with 404 until setUnreadableIssuesForTests
// changes the list.
const MOVED_KEYS: Record<string, string> = process.env.VERMILIAN_E2E_YT_MOVED_KEYS ? (JSON.parse(process.env.VERMILIAN_E2E_YT_MOVED_KEYS) as Record<string, string>) : {};
let unreadable = new Set((process.env.VERMILIAN_E2E_YT_UNREADABLE ?? '').split(',').filter(Boolean));
export function setUnreadableIssuesForTests(keys: readonly string[]): void {
  unreadable = new Set(keys.filter((k) => typeof k === 'string'));
}

// e2e only (VERM-106): VERMILIAN_E2E_YT_REQUIRE_TOKEN makes ticket reads accept
// only that token — the one a workspace's shell-command credential returns —
// and counts the reads accepted with it, so a test can prove the command's
// token was what the tracker accepted. Any other token is a 401.
const REQUIRED_TOKEN = process.env.VERMILIAN_E2E_YT_REQUIRE_TOKEN ?? '';
let requiredTokenReads = 0;
export function requiredTokenReadsForTests(): number {
  return requiredTokenReads;
}
function checkToken(token: string): void {
  if (!REQUIRED_TOKEN) return;
  if (token !== REQUIRED_TOKEN) throw { status: 401, message: 'Unauthorized' };
  requiredTokenReads++;
}

export async function getIssuesByIds(_url: string, _token: string, issueIds: readonly string[]): Promise<BoardIssue[]> {
  checkToken(_token);
  // An old or unreadable key fails the batch, as an unknown one does; single reads follow.
  if (issueIds.some((id) => unreadable.has(id) || id in MOVED_KEYS)) throw { status: 400, message: "Can't parse search query, please check and update query syntax" };
  const found = issueIds.map((id) => issues.find((x) => x.idReadable === id || x.id === id));
  if (found.some((i) => !i)) throw { status: 400, message: "Can't parse search query, please check and update query syntax" };
  return (found as FakeIssue[]).map(toBoardIssue);
}

export async function getBoardIssue(_url: string, _token: string, issueId: string): Promise<BoardIssue> {
  checkToken(_token);
  if (unreadable.has(issueId)) throw { status: 404, message: `Entity with id ${issueId} not found` };
  const key = MOVED_KEYS[issueId] ?? issueId;
  const i = issues.find((x) => x.id === key || x.idReadable === key);
  if (!i) throw { status: 404, message: `Entity with id ${issueId} not found` };
  return toBoardIssue(i);
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
  patchRequests.push({ issueId, field, value });
  const i = issues.find((x) => x.id === issueId || x.idReadable === issueId);
  if (!i) return;
  if (field === 'summary') { i.summary = String(value ?? ''); return; }
  (i.fields as unknown as Record<string, unknown>)[field] = value;
  // With the Runway fixtures on, a Done status resolves the issue as the real
  // server's resolved state does, and any other reopens it, so the blocker
  // tests (VERM-98) can resolve a prerequisite. Off, nothing else changes.
  if (RUNWAY_FIXTURES && field === 'status') i.resolved = value === 'Done' ? Date.now() : null;
}

export async function moveIssue(
  _url: string, _token: string, issueId: string, targetProjectId: string,
): Promise<void> {
  const i = issues.find((x) => x.id === issueId || x.idReadable === issueId);
  if (i && projectById(targetProjectId)) i.projectId = targetProjectId;
}

// e2e observation (VERM-115): every create request that reached the fake,
// and an optional one-shot server refusal to exercise the explained error.
const createRequests: CreateIssuePayload[] = [];
let nextCreateError: string | null = null;

export function getCreateRequestsForTests(): CreateIssuePayload[] {
  return createRequests.map((p) => ({ ...p }));
}
export function setNextCreateErrorForTests(message: string | null): void {
  nextCreateError = typeof message === 'string' && message ? message : null;
}

/** YouTrack's refusal of an unknown enum/state value, as recorded 2026-11-24 (VERM-111). */
export const RECORDED_ENTITY_NOT_FOUND = 'An Open-type entity with the specified name ({1}) was not found';

export async function createIssue(
  url: string, token: string, payload: CreateIssuePayload,
): Promise<CreateIssueResult> {
  createRequests.push({ ...payload });
  if (nextCreateError) {
    const message = nextCreateError;
    nextCreateError = null;
    throw { status: 400, message };
  }
  const proj = projectById(payload.projectId) ?? PROJECTS[0];
  // The server's own rule: a value outside the project's field is refused
  // with the recorded, unfilled template.
  const meta = await readFakeFieldMetadata(url, token, proj.id);
  for (const [name, value] of [['Status', payload.status], ['Priority', payload.priority], ['Category', payload.category]] as const) {
    if (!value) continue;
    const field = meta.fields.find((f) => f.name === name);
    if (!field || !field.values.some((v) => v.name === value)) throw { status: 400, message: RECORDED_ENTITY_NOT_FOUND };
  }
  const fieldDefault = (name: string) => meta.fields.find((f) => f.name === name)?.defaults[0] ?? null;
  const n = ++seq;
  const issue: FakeIssue = {
    id: `${proj.id}-${n}`,
    idReadable: `${proj.shortName}-${n}`,
    summary: payload.summary,
    resolved: null,
    projectId: proj.id,
    fields: emptyFields({
      // An omitted field takes the project's configured default, as on the server.
      status: payload.status ?? fieldDefault('Status'),
      priority: payload.priority ?? fieldDefault('Priority'),
      category: payload.category ?? fieldDefault('Category'),
      dueDate: payload.dueDate, ticket: payload.ticket, ticketLink: payload.ticketLink,
      relatedLink: payload.relatedLink, notes: payload.notes, repoUrl: payload.repoUrl,
    }),
    parentEpic: null,
    isEpic: false,
  };
  issues.push(issue);
  return { id: issue.id, idReadable: issue.idReadable };
}

export async function deleteIssue(_url: string, _token: string, issueId: string): Promise<void> {
  issues = issues.filter((x) => x.id !== issueId && x.idReadable !== issueId);
}

// ─── Recommendation fetch + comments (VERM-8) ────────────────────────────────
// Mirrors api/youtrack.ts's surface exactly (client.ts's `typeof real`
// annotation enforces this at compile time). Descriptions are synthesized
// (no `description` field exists on FakeIssue — the real client always
// fetches it fresh, so the fake never needed to store one either); links
// reuse the same parentEpic fixtures priority-desk-choose-next.spec.ts and
// priority-desk-master-plan.spec.ts already rely on.

export async function getIssuesForRecommendation(
  _url: string, _token: string, issueIds: string[],
): Promise<RecommendationIssue[]> {
  return issueIds
    .map((id) => issues.find((x) => x.id === id || x.idReadable === id))
    .filter((i): i is FakeIssue => Boolean(i))
    .map((i) => ({
      id: i.id,
      idReadable: i.idReadable,
      summary: i.summary,
      description: `Fake description for ${i.idReadable} — deterministic e2e fixture text.`,
      status: i.fields.status,
      priority: i.fields.priority,
      links: i.parentEpic
        ? [{
            linkType: 'Subtask',
            direction: 'INWARD' as const,
            issues: [{ idReadable: i.parentEpic.idReadable, summary: i.parentEpic.summary, status: 'To do' }],
          }]
        : [],
    }));
}

// In-memory, process-local — reset per launch like every other fake-module
// mutable state. No IPC channel reads this in production; main/ipc.ts wires
// a dedicated e2e-only channel directly to this module (never through
// api/client.ts) purely so e2e specs can assert what was actually posted and
// when, per CHECKPOINT.md Workflow 6's audit-comment-only-after-a-choice
// coverage.
let postedComments: Array<{ issueId: string; text: string }> = [];

export async function postComment(_url: string, _token: string, issueId: string, text: string): Promise<void> {
  postedComments.push({ issueId, text });
}

export function getPostedComments(): Array<{ issueId: string; text: string }> {
  return postedComments;
}

// Test-only reset, not part of api/youtrack.ts's surface — not used by
// production code or client.ts. Comments only need resetting between tests
// within a single e2e run if a spec depends on an empty starting list;
// nothing currently does, but this keeps parity with `issues`/`article`'s
// module-local mutable-state pattern above.
export function resetPostedCommentsForTests(): void {
  postedComments = [];
}

// VERMILIAN_E2E_WORKLOG_REJECT=<n> makes the first n worklog posts fail the
// way YouTrack does when time tracking is disabled on the project (finding K2),
// so the refused-worklog path is testable without a server. Later posts succeed.
let worklogRejectionsLeft = Number(process.env.VERMILIAN_E2E_WORKLOG_REJECT ?? 0) || 0;

export async function postWorklog(
  _url: string, _token: string, _issueId: string, _minutes: number, _worklogType: string,
): Promise<void> {
  if (worklogRejectionsLeft > 0) {
    worklogRejectionsLeft -= 1;
    throw new Error('Time tracking is disabled for this project');
  }
  // otherwise a no-op in the fake
}

// Each fake project's Status field (VERM-114). The built-in values below
// unless VERMILIAN_E2E_YT_STATUS_BUNDLES seeds a project's own, as JSON
// { "<shortName>": [{ "name": "Fixed", "isResolved": true }, …] }, so a test
// can give two projects different workflows.
export const FAKE_DEFAULT_STATUS_VALUES: ReadonlyArray<{ name: string; isResolved: boolean }> = [
  { name: 'To do', isResolved: false },
  { name: 'In Progress', isResolved: false },
  { name: 'Waiting for IT', isResolved: false },
  { name: 'BLOCKED', isResolved: false },
  { name: 'Done', isResolved: true },
  { name: 'Wont do', isResolved: true },
];

export function fakeStatusValues(projectShortName: string): Array<{ name: string; isResolved: boolean }> {
  const created = fakeCreateFields(projectShortName).Status;
  if (created) return created.values.map((name) => ({ name, isResolved: ['Done', 'Wont do', 'Fixed'].includes(name) }));
  let seeded: Record<string, unknown> = {};
  try {
    seeded = JSON.parse(process.env.VERMILIAN_E2E_YT_STATUS_BUNDLES ?? '{}') as Record<string, unknown>;
  } catch { /* unseeded */ }
  const own = seeded[projectShortName];
  if (!Array.isArray(own)) return FAKE_DEFAULT_STATUS_VALUES.map((v) => ({ ...v }));
  return own
    .filter((v): v is { name: string; isResolved?: unknown } => typeof v === 'object' && v !== null && typeof (v as { name?: unknown }).name === 'string')
    .map((v) => ({ name: v.name, isResolved: v.isResolved === true }));
}

// Each fake project's select fields (VERM-115 create form, VERM-117 boards,
// Priority Desk and detail dropdowns). Seeded per project by
// VERMILIAN_E2E_YT_CREATE_FIELDS as JSON
//   { "<shortName>": { "Status": { "values": [...], "default": "Triage" },
//                      "Category": null, "Affected host": { "values": [...],
//                      "archived": ["old-host"] } } }
// where null removes the field from that project and `archived` adds
// archived bundle values (shown when an issue holds one, never offered).
// Unseeded fields keep the built-in values below — fixture data for the fake
// only; the app itself reads every value from the project (VERM-117).
const FAKE_CATEGORY_VALUES = [
  'PROJECT', 'OPS', 'COMPANY', 'SERVICE', 'PRODUCTIVITY', 'INBOX', 'ADMIN',
  'RELEASE', 'FINOPS', 'SECURITY', 'INGEST', 'HACKATHON', 'Playbook',
];

// The other select fields' built-in fixture values (VERM-117), mirroring the
// live shared bundles as they stood on 2026-11-24.
const FAKE_OTHER_SELECT_FIELDS: Record<string, { $type: string; values: string[] }> = {
  'Project health': { $type: 'EnumProjectCustomField', values: ['Green', 'Amber', 'Red'] },
  'Reporting cadence': { $type: 'EnumProjectCustomField', values: ['Daily', 'Sprint', 'Monthly', 'Annual', 'On demand'] },
  'Issue domain': { $type: 'EnumProjectCustomField', values: ['Personal', 'Employer work', 'Client work'] },
  'Edit host': { $type: 'EnumProjectCustomField', values: ['FLDW', 'core', 'mac', 'mac-container'] },
  'Affected host': {
    $type: 'EnumProjectCustomField',
    values: [
      'FLDW', 'core', 'mac', 'mac-container', 'web1', 'mail1', 'john', 'obs',
      'postgres', 'wazuh', 'aws-agent-1', 'home-k3s-dev', 'home-k3s-lab',
      'home-k3s-prod', 'dev-agents-1', 'dev-servers-1', 'lab-agents-1',
      'lab-agents-2', 'lab-servers-1', 'prod-agents-1', 'prod-servers-1',
    ],
  },
  Focus: { $type: 'EnumProjectCustomField', values: ['Yes'] },
};

// The fake's built-in Priority values, most urgent first.
export const FAKE_PRIORITY_VALUES = ['Show-stopper', 'Critical', 'Major', 'Normal', 'Minor'];

const SEEDABLE_SELECT_FIELDS = ['Status', 'Priority', 'Category', ...Object.keys(FAKE_OTHER_SELECT_FIELDS)];

interface FakeCreateField { values: string[]; default: string | null; archived?: string[]; canBeEmpty?: boolean }
type FakeCreateFields = Partial<Record<string, FakeCreateField | null>> & {
  // `Date time entered`'s field type ("date and time" unless seeded); null removes it.
  dateTimeEntered?: string | null;
};

// e2e hook (VERM-117 review): change a project's field while the app runs, so
// a spec can read values, fail a refresh, then retry into a changed list.
// null removes the field; an override wins over VERMILIAN_E2E_YT_CREATE_FIELDS.
const fieldOverrides = new Map<string, Map<string, FakeCreateField | null>>();
export function setFakeProjectFieldForTests(project: string, field: string, values: string[] | null): void {
  if (typeof project !== 'string' || typeof field !== 'string') return;
  const own = fieldOverrides.get(project) ?? new Map<string, FakeCreateField | null>();
  own.set(field, Array.isArray(values) ? { values: values.filter((v) => typeof v === 'string'), default: null } : null);
  fieldOverrides.set(project, own);
}

function fakeCreateFields(projectShortName: string): FakeCreateFields {
  const out = seededCreateFields(projectShortName);
  for (const [name, f] of fieldOverrides.get(projectShortName) ?? []) out[name] = f;
  return out;
}

function seededCreateFields(projectShortName: string): FakeCreateFields {
  let seeded: Record<string, unknown> = {};
  try {
    seeded = JSON.parse(process.env.VERMILIAN_E2E_YT_CREATE_FIELDS ?? '{}') as Record<string, unknown>;
  } catch { /* unseeded */ }
  const own = seeded[projectShortName];
  if (typeof own !== 'object' || own === null) return {};
  const out: FakeCreateFields = {};
  if ('Date time entered' in own) {
    const t = (own as Record<string, unknown>)['Date time entered'];
    out.dateTimeEntered = typeof t === 'string' ? t : null;
  }
  const strings = (v: unknown) => (Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : []);
  for (const name of SEEDABLE_SELECT_FIELDS) {
    if (!(name in own)) continue;
    const f = (own as Record<string, unknown>)[name];
    if (f === null) { out[name] = null; continue; }
    const d = (f as { default?: unknown })?.default;
    const empty = (f as { canBeEmpty?: unknown })?.canBeEmpty;
    out[name] = {
      values: strings((f as { values?: unknown })?.values),
      default: typeof d === 'string' ? d : null,
      archived: strings((f as { archived?: unknown })?.archived),
      ...(typeof empty === 'boolean' ? { canBeEmpty: empty } : {}),
    };
  }
  return out;
}

// e2e hooks (VERM-115): hold or fail a project's field read, to test a
// project switch while options load and the Retry path.
let metadataDelay: { ms: number; project: string } = { ms: 0, project: '' };
let metadataFailures: { n: number; project: string } = { n: 0, project: '' };

export function setFieldMetadataDelayForTests(ms: number, project?: string): void {
  metadataDelay = { ms: Number.isFinite(ms) && ms > 0 ? Math.min(ms, 30_000) : 0, project: typeof project === 'string' ? project : '' };
}
// e2e hook (VERM-117 review): hold a project's metadata reads until released,
// so a spec can act while a refresh is pending. Only reads for that project
// wait; every other project answers at once.
let metadataHold: { project: string; released: Promise<void>; release: () => void } | null = null;
export function holdFieldMetadataForTests(project: string): void {
  metadataHold?.release();
  let release = () => {};
  const released = new Promise<void>((r) => { release = r; });
  metadataHold = { project: typeof project === 'string' ? project : '', released, release };
}
export function releaseFieldMetadataForTests(): void {
  metadataHold?.release();
  metadataHold = null;
}

// e2e observation (VERM-117 review): every patch request that reached the fake.
const patchRequests: Array<{ issueId: string; field: string; value: string | number | null }> = [];
export function getPatchRequestsForTests(): Array<{ issueId: string; field: string; value: string | number | null }> {
  return patchRequests.map((r) => ({ ...r }));
}

export function failFieldMetadataForTests(n: number, project?: string): void {
  metadataFailures = { n: Number.isFinite(n) && n > 0 ? n : 0, project: typeof project === 'string' ? project : '' };
}

// Every project field read: the project asked for and which credential
// reference the token came from (never the token), so a spec can check a
// read went to the right workspace's connection — or was never made.
const fieldMetadataRequests: Array<{ project: string; credentialRef: string }> = [];
export function getFieldMetadataRequestsForTests(): Array<{ project: string; credentialRef: string }> {
  return fieldMetadataRequests.map((r) => ({ ...r }));
}

export async function getProjectFieldMetadata(url: string, token: string, projectIdOrShortName: string): Promise<YouTrackProjectMetadata> {
  fieldMetadataRequests.push({ project: projectIdOrShortName, credentialRef: refFromE2eFakeYouTrackToken(token) ?? 'legacy' });
  return readFakeFieldMetadata(url, token, projectIdOrShortName);
}

async function readFakeFieldMetadata(url: string, token: string, projectIdOrShortName: string): Promise<YouTrackProjectMetadata> {
  // The real endpoint accepts a project's id or its short name.
  const projectShortName = (projectById(projectIdOrShortName) ?? projectByShortName(projectIdOrShortName))?.shortName;
  if (!projectShortName) throw { status: 404, message: `Entity with id ${projectIdOrShortName} not found` };
  if (metadataHold && metadataHold.project === projectShortName) await metadataHold.released;
  if (metadataDelay.ms > 0 && (!metadataDelay.project || metadataDelay.project === projectShortName)) {
    await new Promise((r) => setTimeout(r, metadataDelay.ms));
  }
  if (metadataFailures.n > 0 && (!metadataFailures.project || metadataFailures.project === projectShortName)) {
    metadataFailures.n--;
    throw { status: 503, message: 'Simulated field read failure' };
  }
  const seeded = fakeCreateFields(projectShortName);
  const priority = await getPriorityOrder(url, token, projectShortName);
  const raw: unknown[] = [];
  const add = (name: string, $type: string, f: FakeCreateField, extra: (v: string) => Record<string, unknown> = () => ({})) =>
    raw.push({
      field: { name },
      $type,
      canBeEmpty: f.canBeEmpty ?? name !== 'Status',
      defaultValues: f.default ? [{ name: f.default }] : [],
      bundle: {
        values: [
          ...f.values.map((v, ordinal) => ({ name: v, ordinal, ...extra(v) })),
          ...(f.archived ?? []).map((v, i) => ({ name: v, ordinal: f.values.length + i, archived: true, ...extra(v) })),
        ],
      },
    });
  if (seeded.Priority !== null) add('Priority', 'EnumProjectCustomField', seeded.Priority ?? { values: priority, default: null });
  if (seeded.Status !== null) {
    const status = fakeStatusValues(projectShortName);
    const resolved = new Set(status.filter((v) => v.isResolved).map((v) => v.name));
    add('Status', 'StateProjectCustomField', seeded.Status ?? { values: status.map((v) => v.name), default: 'To do' }, (v) => ({ isResolved: resolved.has(v) }));
  }
  if (seeded.Category !== null) add('Category', 'StateProjectCustomField', seeded.Category ?? { values: FAKE_CATEGORY_VALUES, default: null });
  for (const [name, f] of Object.entries(FAKE_OTHER_SELECT_FIELDS)) {
    if (seeded[name] !== null) add(name, f.$type, seeded[name] ?? { values: f.values, default: null });
  }
  if (seeded.dateTimeEntered !== null) {
    raw.push({ field: { name: 'Date time entered', fieldType: { id: seeded.dateTimeEntered ?? 'date and time' } }, $type: 'SimpleProjectCustomField', canBeEmpty: true });
  }
  return parseYouTrackProjectFields(raw);
}

/**
 * The live server's rule for a stand-up query, applied to the exact text the
 * client emits (VERM-114): every clause's values must be values of that
 * project's own Status field, or the whole query is rejected — as YouTrack
 * rejects `{Status}: {Working on it}` once that value is gone. `values` maps a
 * project short name to its Status value names.
 */
export function rejectInvalidStandupQuery(query: string, values: (shortName: string) => readonly string[]): void {
  const clause = /\(project: \{([^}]+)\} and \{([^}]+)\}: ((?:\{[^}]*\},?)+)\)/g;
  let rest = query;
  for (const m of query.matchAll(clause)) {
    const known = new Set(values(m[1]));
    for (const v of m[3].split(',').map((x) => x.replace(/^\{|\}$/g, ''))) {
      if (!known.has(v)) {
        throw {
          status: 400,
          message: `Can't parse search query, please check and update query syntax: The value "${v}" isn't used for the ${m[2]} field.`,
        };
      }
    }
    rest = rest.replace(m[0], '');
  }
  if (rest.replace(/\bor\b/g, '').trim()) throw { status: 400, message: "Can't parse search query, please check and update query syntax" };
}

export async function getIssuesForStandup(
  _url: string, token: string, plan: Pick<StandupPlan, 'projects'>, _cutoffMs: number,
): Promise<StandupIssues> {
  // Set VERMILIAN_E2E_DAILY_REVIEW_ERROR=1 to simulate this fetch failing —
  // used by Daily Review's (VERM-9) e2e error-state coverage. Shared with
  // Stand-up's own fetch (both call this function), which is fine: the flag
  // is opt-in per launch and no existing Stand-up spec sets it.
  if (process.env.VERMILIAN_E2E_DAILY_REVIEW_ERROR === '1') {
    throw { status: 500, message: 'Simulated Daily Review fetch failure' };
  }
  const projectShortNames = plan.projects.map((p) => p.shortName);
  // e2e observation (VERM-48): which projects each stand-up asked for, and
  // an optional hold to put a stand-up "in flight" while its issues load.
  standupQueries.push([...projectShortNames]);
  // Which credential reference the read used, from the fictional e2e token;
  // 'legacy' for the Settings token's stand-in. Never the token itself.
  standupCredentialRefs.push(refFromE2eFakeYouTrackToken(token) ?? 'legacy');
  if (standupDelayMs > 0 && (!standupDelayProject || projectShortNames.includes(standupDelayProject))) {
    await new Promise((r) => setTimeout(r, standupDelayMs));
  }
  const query = buildStandupQuery(plan);
  if (!query) return { done: [], inProgress: [], blocked: [] };
  rejectInvalidStandupQuery(query, (shortName) => fakeStatusValues(shortName).map((v) => v.name));
  // Deterministic fixtures (window/cutoff ignored) so the stand-up flow has
  // data, grouped by the plan exactly as the real client groups them.
  const fixtures: StandupIssues['done'] = [
    { idReadable: 'TEST-1', summary: 'Finished the login flow', status: 'Done', priority: 'Normal', notes: null, updatedMs: 0, loggedMinutesToday: 85 },
    { idReadable: 'TEST-5', summary: 'Refactoring the API client', status: 'In Progress', priority: 'Critical', notes: null, updatedMs: 0, loggedMinutesToday: 0 },
    { idReadable: 'TST2-2', summary: 'Waiting on a vendor response', status: 'BLOCKED', priority: 'Major', notes: null, updatedMs: 0, loggedMinutesToday: 0 },
    // Opt-in extra fixtures (VERM-114 review), e.g. a completed ticket in a
    // second workspace's project: [{ idReadable, summary, status }].
    ...extraStandupFixtures(),
  ];
  const out: StandupIssues = { done: [], inProgress: [], blocked: [] };
  for (const t of fixtures) {
    const group = standupGroupFor(plan, t.idReadable.replace(/-\d+$/, ''), t.status);
    if (group) out[group].push({ ...t });
  }
  return out;
}

const standupQueries: string[][] = [];
const standupCredentialRefs: string[] = [];

export function getStandupCredentialRefsForTests(): string[] {
  return [...standupCredentialRefs];
}
let standupDelayMs = 0;
let standupDelayProject = '';

function extraStandupFixtures(): StandupIssues['done'] {
  const raw = process.env.VERMILIAN_E2E_STANDUP_EXTRA_FIXTURES;
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as Array<{ idReadable?: unknown; summary?: unknown; status?: unknown }>;
    return list.flatMap((f) =>
      typeof f.idReadable === 'string' && typeof f.summary === 'string' && typeof f.status === 'string'
        ? [{ idReadable: f.idReadable, summary: f.summary, status: f.status, priority: null, notes: null, updatedMs: 0, loggedMinutesToday: 0 }]
        : []);
  } catch {
    return [];
  }
}

export function getStandupQueriesForTests(): string[][] {
  return standupQueries.map((q) => [...q]);
}

/** Hold stand-up reads for `ms`; only reads that include `project`, when one is named. */
export function setStandupDelayForTests(ms: number, project?: string): void {
  standupDelayMs = Number.isFinite(ms) && ms > 0 ? Math.min(ms, 30_000) : 0;
  standupDelayProject = typeof project === 'string' ? project : '';
}

// ─── _vermilian-config Article (in-memory) ──────────────────────────────────────

export async function findVermilianArticle(_url: string, _token: string): Promise<VermilianArticle | null> {
  return article ? { id: article.id, content: article.content, updated: article.updated } : null;
}

export async function createVermilianArticle(
  _url: string, _token: string, content: string,
): Promise<VermilianArticle | null> {
  article = { id: 'e2e-article', content, updated: nextUpdated() };
  return { id: article.id, content: article.content, updated: article.updated };
}

export async function updateVermilianArticle(
  _url: string, _token: string, articleId: string, content: string,
): Promise<{ updated: number } | null> {
  if (wsArticles.has(articleId)) return writeWsArticle(articleId, content);
  if (articleId === 'e2e-jira-article') {
    if (!jiraArticle) return null;
    jiraArticle = { id: articleId, content, updated: Date.now() };
    return { updated: jiraArticle.updated };
  }
  if (configWriteFailures > 0) {
    configWriteFailures--;
    return null;
  }
  article = { id: articleId, content, updated: nextUpdated() };
  return { updated: article.updated };
}

// e2e-only: refuse the next N writes to _vermilian-config (VERM-53 review).
let configWriteFailures = 0;
export function failConfigWritesForTests(n: number): void {
  configWriteFailures = Number.isInteger(n) && n > 0 ? Math.min(n, 1000) : 0;
}

// e2e-only: an older Vermilian on another machine rewrites _vermilian-config.
export function writeConfigArticleForTests(content: string): boolean {
  if (!article) return false;
  article = { ...article, content, updated: nextUpdated() };
  return true;
}

export async function getVermilianArticle(
  _url: string, _token: string, articleId: string,
): Promise<VermilianArticle | null> {
  const ws = wsArticles.get(articleId);
  if (ws) return { id: ws.id, summary: ws.summary, content: ws.content, updated: ws.updated };
  if (articleId === 'e2e-jira-article') return jiraArticle ? { ...jiraArticle } : null;
  if (!article || article.id !== articleId) return null;
  return { id: article.id, content: article.content, updated: article.updated };
}

// ─── _vermilian-ws-<id> workspace articles (in-memory, VERM-43) ──────────────────
// Like YouTrack: updates are unconditional and titles are not unique.
// VERMILIAN_E2E_WS_ARTICLES seeds a JSON array of { summary, content } — two
// with the same title model a create race that already happened. Content
// updates go through updateVermilianArticle, as with the real client.

interface FakeWsArticle { id: string; summary: string; content: string; updated: number }

const wsArticles = new Map<string, FakeWsArticle>();
let wsSeq = 0;
let wsClock = 0;

// Strictly increasing, so two writes in the same millisecond still differ.
function nextUpdated(): number {
  wsClock = Math.max(Date.now(), wsClock + 1);
  return wsClock;
}

// e2e-only (VERM-123): VERMILIAN_E2E_WS_STORE_FILE keeps the workspace and
// marker articles in a file, so they survive a quit and relaunch the way
// articles in YouTrack do. Without it they live only in this process.
const WS_STORE_FILE = process.env.VERMILIAN_E2E_WS_STORE_FILE ?? '';

function persistWsArticles(): void {
  if (WS_STORE_FILE) writeFileSync(WS_STORE_FILE, JSON.stringify([...wsArticles.values()]), 'utf8');
}

function loadWsArticles(): boolean {
  if (!WS_STORE_FILE || !existsSync(WS_STORE_FILE)) return false;
  for (const a of JSON.parse(readFileSync(WS_STORE_FILE, 'utf8')) as FakeWsArticle[]) {
    wsArticles.set(a.id, a);
    wsSeq = Math.max(wsSeq, Number(a.id.replace(/^e2e-ws-/, '')) || 0);
    wsClock = Math.max(wsClock, a.updated);
  }
  return true;
}
const wsStoreLoaded = loadWsArticles();

function addWsArticle(summary: string, content: string): FakeWsArticle {
  const a = { id: `e2e-ws-${++wsSeq}`, summary, content, updated: nextUpdated() };
  wsArticles.set(a.id, a);
  persistWsArticles();
  return a;
}

// e2e-only: refuse the next N writes to workspace articles (VERM-96 review).
let wsWriteFailures = 0;
export function failWorkspaceWritesForTests(n: number): void {
  wsWriteFailures = Number.isInteger(n) && n > 0 ? Math.min(n, 1000) : 0;
}

function writeWsArticle(articleId: string, content: string): { updated: number } | null {
  const a = wsArticles.get(articleId);
  if (!a) return null;
  if (wsWriteFailures > 0) {
    wsWriteFailures--;
    return null;
  }
  a.content = content;
  a.updated = nextUpdated();
  persistWsArticles();
  return { updated: a.updated };
}

// Seeds apply to a fresh store only; a relaunch keeps what the store holds.
if (process.env.VERMILIAN_E2E_WS_ARTICLES && !wsStoreLoaded) {
  for (const seed of JSON.parse(process.env.VERMILIAN_E2E_WS_ARTICLES) as Array<{ summary: string; content: string }>) {
    addWsArticle(seed.summary, seed.content);
  }
}

// e2e-only (VERM-123): leave one workspace's article out of listings until a
// deadline, the start-up transient that cost the FLDW its last workspace.
let hiddenFromListing: { workspaceId: string; until: number } | null = null;
// VERMILIAN_E2E_HIDE_WORKSPACE_AT_START="<workspaceId>:<ms>" hides it from the
// first moment of a launch, before any test code can run.
{
  const m = /^([A-Za-z0-9-]+):(\d+)$/.exec(process.env.VERMILIAN_E2E_HIDE_WORKSPACE_AT_START ?? '');
  if (m) hiddenFromListing = { workspaceId: m[1], until: Date.now() + Number(m[2]) };
}

export function hideWorkspaceFromListingForTests(workspaceId: string, ms: number): void {
  hiddenFromListing = { workspaceId, until: Date.now() + ms };
}

export async function listWorkspaceArticles(_url: string, _token: string): Promise<WorkspaceArticleListing> {
  const hidden = hiddenFromListing && Date.now() < hiddenFromListing.until
    ? workspaceArticleTitle(hiddenFromListing.workspaceId)
    : null;
  return {
    ok: true,
    articles: [...wsArticles.values()]
      .filter((a) => a.summary.startsWith(WORKSPACE_ARTICLE_PREFIX) && a.summary !== hidden)
      .map((a) => ({ ...a })),
  };
}

export async function createWorkspaceArticle(
  _url: string, _token: string, workspaceId: string, content: string,
): Promise<(VermilianArticle & { summary: string }) | null> {
  return { ...addWsArticle(workspaceArticleTitle(workspaceId), content) };
}

export async function lookupVermilianArticle(_url: string, _token: string, articleId: string): Promise<ArticleLookupResult> {
  const ws = wsArticles.get(articleId);
  return ws ? { state: 'found', article: { ...ws } } : { state: 'absent' };
}

export async function deleteVermilianArticle(_url: string, _token: string, articleId: string): Promise<boolean> {
  const deleted = wsArticles.delete(articleId);
  persistWsArticles();
  return deleted;
}

// e2e-only: every workspace article as stored, unknown fields and all.
export function getWorkspaceArticlesForTests(): FakeWsArticle[] {
  return [...wsArticles.values()].map((a) => ({ ...a }));
}

// e2e-only: another machine overwrites an article's body.
export function writeWorkspaceArticleForTests(articleId: string, content: string): boolean {
  return writeWsArticle(articleId, content) !== null;
}

// ─── _vermilian-storage-activation marker (in-memory, VERM-53) ─────────────────
// Kept in the same store as the workspace articles, so get/update and the
// "another machine" write hook work on it unchanged. VERMILIAN_E2E_STORAGE_MARKER
// seeds its body — e.g. a marker another machine wrote.

if (wsStoreLoaded) {
  // The marker, like every article, comes back from the store.
} else if (process.env.VERMILIAN_E2E_STORAGE_MARKER) {
  addWsArticle(STORAGE_MARKER_TITLE, process.env.VERMILIAN_E2E_STORAGE_MARKER);
} else if (process.env.VERMILIAN_E2E_WORKSPACE_STORAGE === 'per-workspace') {
  // Forced per-workspace storage (services/activeWorkspace.ts) comes with the
  // active marker it would have joined, so its configuration writes pass the guard.
  addWsArticle(STORAGE_MARKER_TITLE, serialiseStorageMarker({
    schema: 1, kind: 'vermilian-storage-activation', state: 'active', generation: 'e2e-generation-0001', sequence: 1,
    activatedAt: '2026-11-15T00:00:00.000Z', retiredAt: null,
    sources: { config: { articleId: 'e2e-article', updated: 0 }, jiraProfile: null }, workspaces: {},
  }));
}

export async function listStorageMarkerArticles(_url: string, _token: string): Promise<WorkspaceArticleListing> {
  return { ok: true, articles: [...wsArticles.values()].filter((a) => a.summary === STORAGE_MARKER_TITLE).map((a) => ({ ...a })) };
}

export async function createStorageMarkerArticle(
  _url: string, _token: string, content: string,
): Promise<(VermilianArticle & { summary: string }) | null> {
  return { ...addWsArticle(STORAGE_MARKER_TITLE, content) };
}

// ─── _vermilian-jira-overlay Article (in-memory) ────────────────────────────────
// VERMILIAN_E2E_JIRA_ARTICLE_CONTENT seeds it; updates go through
// updateVermilianArticle like the real client, so they share one id space.

let jiraArticle: { id: string; content: string; updated: number } | null =
  process.env.VERMILIAN_E2E_JIRA_ARTICLE_CONTENT
    ? { id: 'e2e-jira-article', content: process.env.VERMILIAN_E2E_JIRA_ARTICLE_CONTENT, updated: Date.now() }
    : null;

export async function findJiraArticle(_url: string, _token: string): Promise<VermilianArticle | null> {
  return jiraArticle ? { ...jiraArticle } : null;
}

export async function createJiraArticle(
  _url: string, _token: string, content: string,
): Promise<VermilianArticle> {
  jiraArticle = { id: 'e2e-jira-article', content, updated: Date.now() };
  return { ...jiraArticle };
}

// ─── Migration sources (VERM-44) ─────────────────────────────────────────────────
// The fake holds at most one _vermilian-config and one Jira profile article.

export async function listMigrationSourceArticles(_url: string, _token: string): Promise<WorkspaceArticleListing> {
  const articles = [
    ...(article ? [{ ...article, summary: '_vermilian-config' }] : []),
    ...(jiraArticle ? [{ ...jiraArticle, summary: '_vermilian-jira-overlay' }] : []),
    // The global master plan, as the same env vars seed it (VERM-48).
    ...globalMasterPlanArticles().map((a) => ({ ...a, summary: '_vermilian-master-plan' })),
  ];
  return { ok: true, articles };
}

// e2e-only: the source articles as stored, to assert migration never writes them.
export function getMigrationSourcesForTests(): Array<{ id: string; content: string; updated: number }> {
  return [...(article ? [{ ...article }] : []), ...(jiraArticle ? [{ ...jiraArticle }] : [])];
}

// ─── _vermilian-master-plan discovery (in-memory)────────────────────────────────
// VERMILIAN_E2E_MASTER_PLAN_CONTENT seeds a single matching article.
// VERMILIAN_E2E_MASTER_PLAN_DUPLICATE=1 simulates two matching articles
// (ambiguous discovery) instead, using that same content (or a default) for
// both. VERMILIAN_E2E_MASTER_PLAN_ERROR=1 simulates a fetch failure. Default
// (none of these set): no article exists ('none').
export async function findMasterPlanArticle(
  _url: string, _token: string,
): Promise<MasterPlanDiscovery> {
  if (process.env.VERMILIAN_E2E_MASTER_PLAN_ERROR) {
    return { status: 'discovery-error' };
  }
  if (process.env.VERMILIAN_E2E_MASTER_PLAN_DUPLICATE) {
    const content = process.env.VERMILIAN_E2E_MASTER_PLAN_CONTENT ?? '## Outcome\n- Active epics: TEST-3\n';
    return {
      status: 'ambiguous',
      articles: [
        { id: 'e2e-master-plan-1', content, updated: Date.now() },
        { id: 'e2e-master-plan-2', content, updated: Date.now() },
      ],
    };
  }
  if (process.env.VERMILIAN_E2E_MASTER_PLAN_CONTENT) {
    return {
      status: 'found',
      article: {
        id: 'e2e-master-plan',
        content: process.env.VERMILIAN_E2E_MASTER_PLAN_CONTENT,
        updated: Date.now(),
      },
    };
  }
  return { status: 'none' };
}

// ─── Master-plan articles by readable ID (VERM-48) ──────────────────────────────
// The global plan the env vars above seed has readable ID VERM-A-90 (and
// VERM-A-91 for its duplicate). A spec adds more with setArticleForTests, or
// makes one refuse with an HTTP status to model a missing or unreadable one.

export const FAKE_GLOBAL_MASTER_PLAN_ID = 'VERM-A-90';

function globalMasterPlanArticles(): Array<{ id: string; idReadable: string; content: string; updated: number }> {
  if (process.env.VERMILIAN_E2E_MASTER_PLAN_ERROR) return [];
  const content = process.env.VERMILIAN_E2E_MASTER_PLAN_CONTENT ?? '## Outcome\n- Active epics: TEST-3\n';
  if (process.env.VERMILIAN_E2E_MASTER_PLAN_DUPLICATE) {
    return [
      { id: 'e2e-master-plan-1', idReadable: FAKE_GLOBAL_MASTER_PLAN_ID, content, updated: 1 },
      { id: 'e2e-master-plan-2', idReadable: 'VERM-A-91', content, updated: 1 },
    ];
  }
  if (process.env.VERMILIAN_E2E_MASTER_PLAN_CONTENT) {
    return [{ id: 'e2e-master-plan', idReadable: FAKE_GLOBAL_MASTER_PLAN_ID, content, updated: 1 }];
  }
  return [];
}

const articlesById = new Map<string, { content: string; updated: number } | { status: number }>();

export function setArticleForTests(articleId: string, value: { content: string } | { status: number }): void {
  articlesById.set(articleId, 'status' in value ? { status: value.status } : { content: value.content, updated: Date.now() });
}

const articleFetches: Array<{ articleId: string; credentialRef: string }> = [];
let articleDelayMs = 0;

export function getArticleFetchesForTests() {
  return articleFetches.map((f) => ({ ...f }));
}

export function setArticleDelayForTests(ms: number): void {
  articleDelayMs = Number.isFinite(ms) && ms > 0 ? Math.min(ms, 30_000) : 0;
}

export async function getArticleById(_url: string, token: string, articleId: string): Promise<ArticleFetch> {
  articleFetches.push({ articleId, credentialRef: refFromE2eFakeYouTrackToken(token) ?? 'legacy' });
  if (articleDelayMs > 0) await new Promise((r) => setTimeout(r, articleDelayMs));
  if (!token) return { ok: false, status: 401 };
  const set = articlesById.get(articleId);
  if (set) return 'status' in set ? { ok: false, status: set.status } : { ok: true, article: { id: `e2e-${articleId}`, ...set } };
  const global = globalMasterPlanArticles().find((a) => a.idReadable === articleId);
  if (global) return { ok: true, article: { id: global.id, content: global.content, updated: global.updated } };
  return { ok: false, status: 404 };
}
