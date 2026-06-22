// Map raw API failures to actionable messages rather than echoing server jargon.
// Pure — extracted from SettingsView.tsx so it can be unit-tested.

export function friendlyYouTrackError(res: { status?: number; message?: string }, url: string): string {
  if (res.status === 401 || res.status === 403) return 'Invalid token or insufficient permissions.';
  if (res.status === 404) return `No YouTrack REST API found at ${url}. Check the URL.`;
  if (!res.status) return `Could not reach YouTrack at ${url}. Check the URL and your network.`;
  return res.message ?? 'Connection failed.';
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
