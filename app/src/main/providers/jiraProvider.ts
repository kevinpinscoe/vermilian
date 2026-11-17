// The Jira backend as a read-only TrackerProvider (VERM-29, ADR-0011).
//
// Binds the Jira read client (api/jira.ts, VERM-28) to one connection — the
// API base the token works through, the account email and the token — and
// maps every issue through mapJiraIssue with its own project's settings
// (status mapping, due-date field — VERM-31). Each project's priority values
// and their order come from its priority scheme through editmeta (VERM-30),
// never from the YouTrack list. It implements TrackerProvider alone,
// never WritableTrackerProvider: nothing in Phase 1 writes to Jira, and
// isWritableTracker() is false for it.
//
// Callers pass the `jira` export of api/jiraClient.ts so the e2e fake stands
// in under VERMILIAN_E2E.

import type * as JiraClient from '../api/jira';
import type { TrackerProject, TrackerProvider } from '../../shared/tracker';
import {
  jiraBoardFields,
  jiraDetailFields,
  jiraProjectKeyOf,
  jiraSearchJql,
  jiraSearchKey,
  mapJiraIssue,
  mapJiraIssueDetail,
} from '../../shared/jiraBoardIssue';
import type { JiraProjectSettings, JiraProjectSettingsMap } from '../../shared/jiraProjectSettings';
import { jiraPriorityOrder } from '../../shared/priority';
import { mapJiraIssueContent, type JiraIssueContent } from '../../shared/jiraContent';
import { JIRA_POLL_WINDOW_MINUTES } from '../../shared/jiraPoll';
import type { BoardIssue } from '../../shared/workspace';

// How many of a project's open issues to try for editmeta before giving up.
// Normally the first answers; a later one helps only when the user cannot
// edit the first.
export const PRIORITY_PROBE_ISSUES = 3;

export interface JiraConnection {
  /** The site URL or gateway base the token works through (jiraApiBase). */
  base: string;
  email: string;
  token: string;
}

export interface JiraProvider extends TrackerProvider {
  readonly kind: 'jira';
  /** The issue's description and comments as Markdown, read-only (VERM-32). */
  getIssueContent(key: string): Promise<JiraIssueContent>;
  /**
   * One project's issues updated in the last JIRA_POLL_WINDOW_MINUTES,
   * resolved ones included — the board's incremental poll (VERM-39).
   */
  getRecentlyUpdatedIssues(projectKey: string): Promise<BoardIssue[]>;
  /** The connection's own accountId: what "Me" means on this workspace's board (VERM-62). */
  getMyAccountId(): Promise<string>;
}

export function createJiraProvider(
  client: typeof JiraClient,
  conn: JiraConnection,
  projectSettings: JiraProjectSettingsMap = {},
): JiraProvider {
  const { base, email, token } = conn;
  const settingsFor = (projectKey: string): JiraProjectSettings =>
    Object.prototype.hasOwnProperty.call(projectSettings, projectKey) ? projectSettings[projectKey] : {};
  // A priority scheme changes only by a site admin's hand, so each project's
  // is read once per provider. A failed read is not remembered.
  const priorityCache = new Map<string, Promise<string[]>>();

  async function readPriorityValues(projectKey: string): Promise<string[]> {
    // editmeta is per issue, so it is read from one of the project's open
    // issues (an issue in a Done status is often not editable, and then
    // editmeta lists no fields).
    const issues = await client.searchJql(base, email, token, client.projectIssuesJql(projectKey), ['summary'], 1);
    for (const issue of issues.slice(0, PRIORITY_PROBE_ISSUES)) {
      const meta = await client.getEditMeta(base, email, token, issue.key);
      const order = jiraPriorityOrder(meta.fields);
      if (order) return order;
    }
    return [];
  }

  const mapIssue = (issue: Parameters<typeof mapJiraIssue>[0]) => mapJiraIssue(issue, settingsFor(jiraProjectKeyOf(issue.key)));

  return {
    kind: 'jira',

    async getCurrentUser() {
      return (await client.getMyself(base, email, token)).displayName;
    },

    async getMyAccountId() {
      return (await client.getMyself(base, email, token)).accountId;
    },

    async getProjects(): Promise<TrackerProject[]> {
      const projects = await client.listProjects(base, email, token);
      return projects.map((p) => ({ id: p.id, name: p.name, shortName: p.key }));
    },

    async getIssues(projectKey, includeResolved) {
      const options = settingsFor(projectKey);
      const issues = await client.searchProjectIssues(base, email, token, projectKey, {
        includeResolved,
        fields: jiraBoardFields(options),
      });
      // A board's issues belong to its project, except one moved away since
      // the search ran; those take their new project's settings.
      return issues.map(mapIssue);
    },

    async getRecentlyUpdatedIssues(projectKey) {
      const issues = await client.searchProjectRecentlyUpdated(base, email, token, projectKey, {
        windowMinutes: JIRA_POLL_WINDOW_MINUTES,
        fields: jiraBoardFields(settingsFor(projectKey)),
      });
      return issues.map(mapIssue);
    },

    async searchIssues(projectKeys, query) {
      if (projectKeys.length === 0) return [];
      for (const k of projectKeys) {
        if (!client.isValidProjectKey(k)) throw { message: `Invalid Jira project key: ${JSON.stringify(k)}` };
      }
      // Key or text over every status, Done included (VERM-61).
      const jql = jiraSearchJql(projectKeys, query);
      if (!jql) return [];
      const key = jiraSearchKey(projectKeys, query);
      // Every searched project's fields, so each issue maps with its own.
      const fields = [...new Set(projectKeys.flatMap((k) => jiraBoardFields(settingsFor(k))))];
      const [byKey, byText] = await Promise.all([
        // A 404 is simply "no such issue"; anything else (401, 403) surfaces.
        key
          ? client.getIssue(base, email, token, key, fields).catch((e: unknown) => {
              if ((e as { status?: unknown } | null)?.status === 404) return null;
              throw e;
            })
          : Promise.resolve(null),
        client.searchJql(base, email, token, jql, fields, 1),
      ]);
      // A moved issue answers its old key from its new project; keep it only
      // while that project is still one of the workspace's.
      const exact = byKey && projectKeys.includes(jiraProjectKeyOf(byKey.key)) ? [byKey] : [];
      const seen = new Set(exact.map((i) => i.id));
      return [...exact, ...byText.filter((i) => !seen.has(i.id))].map(mapIssue);
    },

    getPriorityValues(projectKey) {
      if (!client.isValidProjectKey(projectKey)) {
        return Promise.reject({ message: `Invalid Jira project key: ${JSON.stringify(projectKey)}` });
      }
      let pending = priorityCache.get(projectKey);
      if (!pending) {
        pending = readPriorityValues(projectKey);
        priorityCache.set(projectKey, pending);
        pending.catch(() => priorityCache.delete(projectKey));
      }
      return pending.then((values) => [...values]);
    },

    async getIssueContent(key) {
      const [issue, comments] = await Promise.all([
        client.getIssue(base, email, token, key, ['description']),
        client.getIssueComments(base, email, token, key),
      ]);
      const fields = (issue.fields ?? {}) as Record<string, unknown>;
      return mapJiraIssueContent(fields.description, comments);
    },

    async getIssueDetail(key) {
      const options = settingsFor(jiraProjectKeyOf(key));
      const issue = await client.getIssue(base, email, token, key, jiraDetailFields(options));
      return mapJiraIssueDetail(issue, settingsFor(jiraProjectKeyOf(issue.key ?? key)));
    },
  };
}
