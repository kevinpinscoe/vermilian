import { describe, it, expect } from 'vitest';
import { CONFIG_QUERY_KEY, CRED_STATUS_QUERY_KEY } from './api';

// These constants are the single source of truth shared by useConfig(),
// useCredentialStatus(), and the invalidateQueries() calls in SettingsView.
// A mismatch between these keys and what components invalidate on save is
// what caused the first-run settings screen to stay open after saving
// credentials (the connected flag in App.tsx never refetched). If these
// constants change, every consumer must change with them.

describe('settings query keys', () => {
  it('CONFIG_QUERY_KEY is ["config"]', () => {
    expect(CONFIG_QUERY_KEY).toEqual(['config']);
  });

  it('CRED_STATUS_QUERY_KEY is ["cred-status"]', () => {
    expect(CRED_STATUS_QUERY_KEY).toEqual(['cred-status']);
  });
});
