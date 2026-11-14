// The Jira backend as a read-only TrackerProvider (VERM-29, ADR-0011).
//
// Binds the Jira read client (api/jira.ts, VERM-28) to one connection — the
// API base the token works through, the account email and the token — and
// maps every issue through mapJiraIssue. It implements TrackerProvider alone,
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
  jqlTextClause,
  mapJiraIssue,
  mapJiraIssueDetail,
  type JiraMappingOptions,
} from '../../shared/jiraBoardIssue';

export interface JiraConnection {
  /** The site URL or gateway base the token works through (jiraApiBase). */
  base: string;
  email: string;
  token: string;
}

export interface JiraProvider extends TrackerProvider {
  readonly kind: 'jira';
}

export function createJiraProvider(
  client: typeof JiraClient,
  conn: JiraConnection,
  options: JiraMappingOptions = {},
): JiraProvider {
  const { base, email, token } = conn;
  const fields = jiraBoardFields(options);

  return {
    kind: 'jira',

    async getCurrentUser() {
      return (await client.getMyself(base, email, token)).displayName;
    },

    async getProjects(): Promise<TrackerProject[]> {
      const projects = await client.listProjects(base, email, token);
      return projects.map((p) => ({ id: p.id, name: p.name, shortName: p.key }));
    },

    async getIssues(projectKey, includeResolved) {
      const issues = await client.searchProjectIssues(base, email, token, projectKey, { includeResolved, fields });
      return issues.map((i) => mapJiraIssue(i, options));
    },

    async searchIssues(projectKeys, query) {
      if (projectKeys.length === 0) return [];
      for (const k of projectKeys) {
        if (!client.isValidProjectKey(k)) throw { message: `Invalid Jira project key: ${JSON.stringify(k)}` };
      }
      const projects = `project in (${projectKeys.map((k) => `"${k}"`).join(', ')})`;
      const text = query.trim() ? ` AND ${jqlTextClause(query.trim())}` : '';
      const issues = await client.searchJql(base, email, token, `${projects}${text} ORDER BY updated DESC`, fields);
      return issues.map((i) => mapJiraIssue(i, options));
    },

    async getIssueDetail(key) {
      const issue = await client.getIssue(base, email, token, key, jiraDetailFields(options));
      return mapJiraIssueDetail(issue, options);
    },
  };
}
