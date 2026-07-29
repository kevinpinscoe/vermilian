import { describe, it, expect } from 'vitest';
import { friendlyYouTrackError, friendlyClaudeError, connectionErrorMessage } from './errors';

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

describe('connectionErrorMessage', () => {
  // Regression: a YouTrack instance was rebuilt, invalidating the stored token.
  // The app still saw a token *file* on disk, so it routed to the board instead
  // of Settings, then rendered an empty board with no explanation — and the only
  // Settings button lived in the left rail, which had failed to render. The
  // banner these messages feed is the escape hatch.
  const REVOKED = 'Error invoking remote method: YouTrack request failed (status 401): Unauthorized';

  it('names the token as the problem on 401/403, and points at Settings', () => {
    const msg = connectionErrorMessage(new Error(REVOKED));
    expect(msg).toMatch(/rejected the stored token/i);
    expect(msg).toMatch(/Settings/);
    expect(connectionErrorMessage(new Error('failed (status 403): Forbidden'))).toMatch(/rejected the stored token/i);
  });

  it('distinguishes a bad URL from a bad token', () => {
    expect(connectionErrorMessage(new Error('failed (status 404): Not Found'))).toMatch(/No YouTrack REST API found/i);
  });

  it('treats an absent status as unreachable rather than an auth failure', () => {
    const msg = connectionErrorMessage(new Error('failed (status none): fetch failed'));
    expect(msg).toMatch(/Could not reach YouTrack/i);
    expect(msg).not.toMatch(/rejected the stored token/i);
  });

  it('handles non-Error values without throwing', () => {
    expect(connectionErrorMessage('plain string')).toMatch(/Could not load projects/i);
    expect(connectionErrorMessage(null)).toMatch(/Could not load projects/i);
    expect(connectionErrorMessage(undefined)).toMatch(/Could not load projects/i);
  });

  it('always yields something actionable, never an empty string', () => {
    for (const input of [new Error(''), '', 0, {}, []]) {
      expect(connectionErrorMessage(input).length).toBeGreaterThan(0);
    }
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
