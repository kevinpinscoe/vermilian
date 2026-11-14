// The YouTrack backend as a TrackerProvider (VERM-27, ADR-0011).
//
// A thin binding: every method delegates to the YouTrack REST client with the
// connection's URL and token, unchanged. The client itself (api/youtrack.ts)
// is not modified, and callers pass the `youtrack` export of api/client.ts so
// the e2e fake stands in exactly as before.
//
// Operations only YouTrack has today — the worklog-type list, issue creation,
// and the recommendation and stand-up queries — sit on YouTrackProvider
// rather than on the backend-neutral interface.

import type * as YouTrackClient from '../api/youtrack';
import type { WritableTrackerProvider } from '../../shared/tracker';

export interface YouTrackProvider extends WritableTrackerProvider {
  readonly kind: 'youtrack';
  getWorklogTypes(): Promise<string[]>;
  createIssue(payload: YouTrackClient.CreateIssuePayload): Promise<YouTrackClient.CreateIssueResult>;
  getIssuesForRecommendation(issueIds: string[]): Promise<YouTrackClient.RecommendationIssue[]>;
  getIssuesForStandup(projectShortNames: string[], cutoffMs: number): Promise<YouTrackClient.StandupIssues>;
}

export function createYouTrackProvider(
  client: typeof YouTrackClient,
  url: string,
  token: string,
): YouTrackProvider {
  return {
    kind: 'youtrack',
    getCurrentUser: () => client.getCurrentUser(url, token),
    getProjects: () => client.getProjects(url, token),
    getIssues: (projectShortName, includeResolved) =>
      client.getIssues(url, token, projectShortName, includeResolved),
    searchIssues: (projectShortNames, query) => client.searchIssues(url, token, projectShortNames, query),
    getIssueDetail: (issueId) => client.getIssueDetail(url, token, issueId),
    patchIssue: (issueId, field, value) => client.patchIssue(url, token, issueId, field, value),
    postComment: (issueId, text) => client.postComment(url, token, issueId, text),
    moveIssue: (issueId, targetProjectId) => client.moveIssue(url, token, issueId, targetProjectId),
    deleteIssue: (issueId) => client.deleteIssue(url, token, issueId),
    postWorklog: (issueId, minutes, worklogType) =>
      client.postWorklog(url, token, issueId, minutes, worklogType),
    getWorklogTypes: () => client.getWorklogTypes(url, token),
    createIssue: (payload) => client.createIssue(url, token, payload),
    getIssuesForRecommendation: (issueIds) => client.getIssuesForRecommendation(url, token, issueIds),
    getIssuesForStandup: (projectShortNames, cutoffMs) =>
      client.getIssuesForStandup(url, token, projectShortNames, cutoffMs),
  };
}
