/**
 * Server-side fixture preparation and verification, always through the
 * independent verifier client — never through the application under test.
 *
 * Fixtures are identified two ways, and both must hold before the harness
 * will touch an issue: the summary starts with FIXTURE_PREFIX, and the
 * description contains FIXTURE_MARKER. An issue that has one but not the
 * other stops the run.
 */

import { Client, HarnessError, ok } from './clients';

export const FIXTURE_PREFIX = '[VLH]';
export const FIXTURE_MARKER = 'vermilian-live-harness fixture: disposable, created by the live acceptance harness. Not real work.';

export interface Project {
  id: string;
  shortName: string;
  name: string;
}

export interface FocusState {
  id: string;
  idReadable: string;
  summary: string;
  status: string | null;
  focus: string | null;
  focusRank: number | null;
  whyNow: string | null;
  resolved: number | null;
}

interface RawIssue {
  id: string;
  idReadable: string;
  summary: string;
  description: string | null;
  resolved: number | null;
  customFields: Array<{ name: string; value: unknown }>;
}

const ISSUE_FIELDS = 'id,idReadable,summary,description,resolved,customFields(name,value(name))';

export async function findProject(client: Client, shortName: string): Promise<Project | null> {
  const projects = await ok<Project[]>(client, 'GET', '/api/admin/projects?fields=id,shortName,name&$top=500');
  return projects.find((p) => p.shortName === shortName) ?? null;
}

function toState(raw: RawIssue): FocusState {
  const field = (name: string) => raw.customFields.find((f) => f.name === name)?.value;
  const named = (v: unknown) => (v && typeof v === 'object' && 'name' in v ? String((v as { name: unknown }).name) : null);
  const rank = field('Focus rank');
  const why = field('Why now');
  return {
    id: raw.id,
    idReadable: raw.idReadable,
    summary: raw.summary,
    status: named(field('Status')),
    focus: named(field('Focus')),
    focusRank: typeof rank === 'number' ? rank : null,
    whyNow: typeof why === 'string' ? why : null,
    resolved: raw.resolved,
  };
}

export async function readIssue(client: Client, idOrReadable: string): Promise<FocusState> {
  return toState(await ok<RawIssue>(client, 'GET', `/api/issues/${idOrReadable}?fields=${ISSUE_FIELDS}`));
}

async function projectIssues(client: Client, shortName: string): Promise<RawIssue[]> {
  const q = encodeURIComponent(`project: {${shortName}}`);
  return ok<RawIssue[]>(client, 'GET', `/api/issues?query=${q}&fields=${ISSUE_FIELDS}&$top=500`);
}

function isFixture(raw: RawIssue): boolean {
  return raw.summary.startsWith(FIXTURE_PREFIX) && (raw.description ?? '').includes(FIXTURE_MARKER);
}

/**
 * Every issue in the project must be either a well-formed fixture or an
 * issue that holds no Focus, so the harness can reset its own fixtures to a
 * known state without leaving another issue's rank in play.
 */
export async function auditProject(client: Client, shortName: string): Promise<{ fixtures: FocusState[]; problems: string[] }> {
  const issues = await projectIssues(client, shortName);
  const problems: string[] = [];
  for (const raw of issues) {
    const half = raw.summary.startsWith(FIXTURE_PREFIX) !== (raw.description ?? '').includes(FIXTURE_MARKER);
    if (half) problems.push(`${raw.idReadable} carries only one of the two fixture identifiers; refusing to treat it as a fixture`);
    const st = toState(raw);
    if (!isFixture(raw) && (st.focus === 'Yes' || st.focusRank !== null)) {
      problems.push(`${raw.idReadable} is not a harness fixture but holds Focus=${st.focus} rank=${st.focusRank}`);
    }
  }
  return { fixtures: issues.filter(isFixture).map(toState), problems };
}

/** Finds the fixture with this exact summary suffix, creating it if absent. */
export async function ensureFixture(client: Client, project: Project, name: string): Promise<FocusState> {
  const summary = `${FIXTURE_PREFIX} ${name}`;
  const existing = (await projectIssues(client, project.shortName)).filter((i) => i.summary === summary);
  if (existing.length > 1) throw new HarnessError(`more than one fixture named "${summary}" in ${project.shortName}`);
  if (existing.length === 1) {
    if (!isFixture(existing[0])) throw new HarnessError(`${existing[0].idReadable} has the fixture summary but not the marker`);
    return toState(existing[0]);
  }
  const created = await ok<{ id: string }>(client, 'POST', '/api/issues?fields=id', {
    project: { id: project.id },
    summary,
    description: FIXTURE_MARKER,
  });
  return readIssue(client, created.id);
}

export interface FieldValues {
  focus?: 'Yes' | null;
  focusRank?: number | null;
  whyNow?: string | null;
  status?: string;
}

export async function setFields(client: Client, issueId: string, v: FieldValues): Promise<void> {
  const fields: unknown[] = [];
  if ('focus' in v) fields.push({ name: 'Focus', $type: 'SingleEnumIssueCustomField', value: v.focus ? { name: v.focus } : null });
  if ('focusRank' in v) fields.push({ name: 'Focus rank', $type: 'SimpleIssueCustomField', value: v.focusRank ?? null });
  if ('whyNow' in v) fields.push({ name: 'Why now', $type: 'SimpleIssueCustomField', value: v.whyNow ?? null });
  if (v.status) fields.push({ name: 'Status', $type: 'StateIssueCustomField', value: { name: v.status } });
  await ok(client, 'POST', `/api/issues/${issueId}?fields=id`, { customFields: fields });
}

/** Puts every fixture in the given projects back to unfocused, unranked, no reason, open. */
export async function resetFixtures(client: Client, shortNames: string[], openState: string): Promise<FocusState[]> {
  const all: FocusState[] = [];
  for (const sn of shortNames) {
    const { fixtures, problems } = await auditProject(client, sn);
    if (problems.length) throw new HarnessError(`project ${sn} is not in a resettable state: ${problems.join('; ')}`);
    for (const f of fixtures) {
      if (f.focus !== null || f.focusRank !== null || f.whyNow !== null || f.status !== openState) {
        await setFields(client, f.id, { focus: null, focusRank: null, whyNow: null, status: openState });
      }
    }
    for (const f of fixtures) all.push(await readIssue(client, f.id));
  }
  return all;
}

export interface WorkItem {
  id: string;
  duration: { minutes: number };
  author: { login: string } | null;
  date: number;
}

export async function workItems(client: Client, issueId: string): Promise<WorkItem[]> {
  return ok<WorkItem[]>(client, 'GET', `/api/issues/${issueId}/timeTracking/workItems?fields=id,duration(minutes),author(login),date&$top=200`);
}

export async function timeTrackingEnabled(client: Client, projectId: string): Promise<boolean | null> {
  const res = await client.request<{ enabled?: boolean }>('GET', `/api/admin/projects/${projectId}/timeTrackingSettings?fields=enabled`);
  if (res.status !== 200) return null;
  return Boolean(res.body?.enabled);
}

/** Server values for the given issues, for before/after evidence. */
export async function snapshot(client: Client, ids: string[]): Promise<Record<string, FocusState>> {
  const out: Record<string, FocusState> = {};
  for (const id of ids) {
    const st = await readIssue(client, id);
    out[st.idReadable] = st;
  }
  return out;
}
