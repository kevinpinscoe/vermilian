// Pure transform from a Jira REST issue (search/jql response) to the row the
// read-only Jira list renders (VERM-21). No Electron, no React.

// The subset of fields requested from search/jql; every one may be absent if
// the field is hidden from the user or not on the project's screens.
export const JIRA_LIST_FIELDS = ['summary', 'status', 'priority', 'updated'] as const;

export interface JiraSearchIssue {
  id: string;
  key: string;
  fields?: {
    summary?: string | null;
    status?: { name?: string; statusCategory?: { key?: string } } | null;
    priority?: { name?: string } | null;
    updated?: string | null;
  };
}

export interface JiraIssueRow {
  key: string;
  summary: string;
  status: string;
  // Jira's fixed category keys: 'new' (to do), 'indeterminate' (in progress),
  // 'done'; '' when unknown. Used only for the status chip's colour.
  statusCategory: string;
  priority: string; // '' when the project has no priority field
  updated: string; // ISO timestamp, '' when absent
  url: string; // the issue in the Jira web UI
}

export function toJiraIssueRow(issue: JiraSearchIssue, siteUrl: string): JiraIssueRow {
  const f = issue.fields ?? {};
  return {
    key: issue.key,
    summary: f.summary ?? '',
    status: f.status?.name ?? '',
    statusCategory: f.status?.statusCategory?.key ?? '',
    priority: f.priority?.name ?? '',
    updated: f.updated ?? '',
    url: `${siteUrl.replace(/\/+$/, '')}/browse/${encodeURIComponent(issue.key)}`,
  };
}
