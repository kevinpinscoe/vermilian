import { describe, it, expect } from 'vitest';
import { friendlyYouTrackError, friendlyClaudeError } from './errors';

const URL = 'https://yt.example.com';

describe('friendlyYouTrackError', () => {
  it('maps 401/403 to a permissions message', () => {
    expect(friendlyYouTrackError({ status: 401 }, URL)).toBe('Invalid token or insufficient permissions.');
    expect(friendlyYouTrackError({ status: 403 }, URL)).toBe('Invalid token or insufficient permissions.');
  });

  it('maps 404 to a URL hint that includes the url', () => {
    expect(friendlyYouTrackError({ status: 404 }, URL)).toBe(`No YouTrack REST API found at ${URL}. Check the URL.`);
  });

  it('treats a missing status as an unreachable-host error', () => {
    expect(friendlyYouTrackError({}, URL)).toBe(`Could not reach YouTrack at ${URL}. Check the URL and your network.`);
  });

  it('falls back to the server message for other statuses', () => {
    expect(friendlyYouTrackError({ status: 500, message: 'Boom' }, URL)).toBe('Boom');
    expect(friendlyYouTrackError({ status: 500 }, URL)).toBe('Connection failed.');
  });
});

describe('friendlyClaudeError', () => {
  it('detects auth failures (case-insensitive, several phrasings)', () => {
    const expected = 'Invalid Claude API key — check it at console.anthropic.com.';
    expect(friendlyClaudeError('HTTP 401 Unauthorized')).toBe(expected);
    expect(friendlyClaudeError('invalid x-api-key')).toBe(expected);
    expect(friendlyClaudeError('authentication_error')).toBe(expected);
    expect(friendlyClaudeError('permission denied')).toBe(expected);
  });

  it('detects network failures', () => {
    const expected = 'Could not reach the Claude API. Check your network connection.';
    expect(friendlyClaudeError('fetch failed')).toBe(expected);
    expect(friendlyClaudeError('getaddrinfo ENOTFOUND api.anthropic.com')).toBe(expected);
    expect(friendlyClaudeError('connect ECONNREFUSED')).toBe(expected);
    expect(friendlyClaudeError('request timeout')).toBe(expected);
  });

  it('passes through an unrecognised message', () => {
    expect(friendlyClaudeError('something weird')).toBe('something weird');
  });

  it('uses a default when no message is given', () => {
    expect(friendlyClaudeError(undefined)).toBe('Key check failed.');
  });
});
