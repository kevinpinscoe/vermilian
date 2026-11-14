// The Jira backend as a read-only TrackerProvider (VERM-29, ADR-0011).
//
// Binds the Jira read client (api/jira.ts, VERM-28) to one connection — the
// API base the token works through, the account email and the token — and
// maps every issue through mapJiraIssue with its own project's settings
// (status mapping, due-date field — VERM-31). It implements TrackerProvider alone,
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
  jqlTextClause,
  mapJiraIssue,
  mapJiraIssueDetail,
} from '../../shared/jiraBoardIssue';
import type { JiraProjectSettings, JiraProjectSettingsMap } from '../../shared/jiraProjectSettings';

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
  projectSettings: JiraProjectSettingsMap = {},
): JiraProvider {
  const { base, email, token } = conn;
  const settingsFor = (projectKey: string): JiraProjectSettings =>
    Object.prototype.hasOwnProperty.call(projectSettings, projectKey) ? projectSettings[projectKey] : {};
  const mapIssue = (issue: Parameters<typeof mapJiraIssue>[0]) => mapJiraIssue(issue, settingsFor(jiraProjectKeyOf(issue.key)));

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
      const options = settingsFor(projectKey);
      const issues = await client.searchProjectIssues(base, email, token, projectKey, {
        includeResolved,
        fields: jiraBoardFields(options),
      });
      // A board's issues belong to its project, except one moved away since
      // the search ran; those take their new project's settings.
      return issues.map(mapIssue);
    },

    async searchIssues(projectKeys, query) {
      if (projectKeys.length === 0) return [];
      for (const k of projectKeys) {
        if (!client.isValidProjectKey(k)) throw { message: `Invalid Jira project key: ${JSON.stringify(k)}` };
      }
      const projects = `project in (${projectKeys.map((k) => `"${k}"`).join(', ')})`;
      const text = query.trim() ? ` AND ${jqlTextClause(query.trim())}` : '';
      // Every searched project's fields, so each issue maps with its own.
      const fields = [...new Set(projectKeys.flatMap((k) => jiraBoardFields(settingsFor(k))))];
      const issues = await client.searchJql(base, email, token, `${projects}${text} ORDER BY updated DESC`, fields);
      return issues.map(mapIssue);
    },

    async getIssueDetail(key) {
      const options = settingsFor(jiraProjectKeyOf(key));
      const issue = await client.getIssue(base, email, token, key, jiraDetailFields(options));
      return mapJiraIssueDetail(issue, settingsFor(jiraProjectKeyOf(issue.key ?? key)));
    },
  };
}
