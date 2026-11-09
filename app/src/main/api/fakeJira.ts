// In-memory Jira stand-in for the e2e harness (VERMILIAN_E2E=1). Mirrors the
// surface of ./jira so jiraClient.ts can swap it in; no network access.
// Any token is accepted as classic except FAKE_JIRA_BAD_TOKEN, which both
// routes reject, so a spec can exercise the failure path.

import type { JiraProfile } from '../../shared/jiraProfile';
import type { JiraAccount, JiraProbeResult } from './jira';

export { JIRA_GATEWAY, siteApiBase, gatewayApiBase } from './jira';
export type { JiraError, JiraTokenKind, JiraAccount, JiraProbeResult } from './jira';

export const FAKE_JIRA_CLOUD_ID = 'e2e00000-0000-4000-8000-000000000000';
export const FAKE_JIRA_BAD_TOKEN = 'e2e-bad-jira-token';

const ACCOUNT: JiraAccount = {
  accountId: 'e2e-account',
  displayName: 'E2E Jira User',
  emailAddress: 'e2e@example.com',
};

export async function detectCloudId(_siteUrl: string): Promise<string | null> {
  return FAKE_JIRA_CLOUD_ID;
}

export async function getMyself(_base: string, _email: string, token: string): Promise<JiraAccount> {
  if (token === FAKE_JIRA_BAD_TOKEN) throw { status: 401, message: 'Client must be authenticated' };
  return { ...ACCOUNT };
}

export async function probeJiraToken(profile: JiraProfile, token: string): Promise<JiraProbeResult> {
  const cloudId = profile.cloudId || FAKE_JIRA_CLOUD_ID;
  if (token === FAKE_JIRA_BAD_TOKEN) {
    return {
      ok: false,
      reason: 'unauthorized',
      cloudId,
      message: 'Jira rejected the token at both the site URL and the scoped-token gateway — it is wrong, expired or revoked, or the email does not match it.',
      status: 401,
    };
  }
  return { ok: true, kind: 'classic', cloudId, account: { ...ACCOUNT } };
}
