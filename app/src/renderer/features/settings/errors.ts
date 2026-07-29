// Map raw API failures to actionable messages rather than echoing server jargon.
// Pure — extracted from SettingsView.tsx so it can be unit-tested.

export function friendlyYouTrackError(res: { status?: number; message?: string }, url: string): string {
  if (res.status === 401 || res.status === 403) return 'Invalid token or insufficient permissions.';
  if (res.status === 404) return `No YouTrack REST API found at ${url}. Check the URL.`;
  if (!res.status) return `Could not reach YouTrack at ${url}. Check the URL and your network.`;
  return res.message ?? 'Connection failed.';
}

// Turn a failed projects/board query into an actionable sentence for the
// connection banner. Unlike friendlyYouTrackError above, this receives whatever
// React Query caught — an Error that has already crossed the IPC boundary, so
// the original { status } object is gone and only the message survives. The
// main process encodes the status into that message (see IPC.getProjects).
//
// The distinction that matters to the user: a rejected token is fixed in
// Settings, an unreachable host is not.
export function connectionErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');

  if (/status 401|status 403|\b401\b|\b403\b|unauthorized|forbidden/i.test(msg)) {
    return 'YouTrack rejected the stored token. It may have been revoked, expired, or replaced — open Settings to enter a new one.';
  }
  if (/status 404/i.test(msg)) {
    return 'No YouTrack REST API found at the configured URL. Check the URL in Settings.';
  }
  if (/status none|fetch failed|ENOTFOUND|ECONNREFUSED|network|timeout/i.test(msg)) {
    return 'Could not reach YouTrack. Check the URL in Settings and your network connection.';
  }
  return 'Could not load projects from YouTrack. Check the connection settings.';
}

export function friendlyClaudeError(raw?: string): string {
  const msg = raw ?? 'Key check failed.';
  if (/401|invalid x-api-key|authentication|unauthorized|permission/i.test(msg)) {
    return 'Invalid Claude API key — check it at console.anthropic.com.';
  }
  if (/network|fetch failed|ENOTFOUND|ECONNREFUSED|timeout/i.test(msg)) {
    return 'Could not reach the Claude API. Check your network connection.';
  }
  return msg;
}
