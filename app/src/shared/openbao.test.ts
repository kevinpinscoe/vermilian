import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OPENBAO_CONNECTION,
  checkOpenBaoConnection,
  normaliseOpenBaoUrl,
  sanitiseOpenBaoScopes,
  type OpenBaoConnection,
} from './openbao';

const valid: OpenBaoConnection = {
  ...DEFAULT_OPENBAO_CONNECTION,
  url: 'https://bao.example.test/',
  auth: { ...DEFAULT_OPENBAO_CONNECTION.auth, roleId: 'role-a', secretFile: '/fake/secret-id' },
};

describe('normaliseOpenBaoUrl', () => {
  it.each([
    ['https://bao.example.test/', 'https://bao.example.test'],
    ['https://bao.example.test:8200', 'https://bao.example.test:8200'],
    ['http://127.0.0.1:8200', 'http://127.0.0.1:8200'],
    ['http://localhost:8200/', 'http://localhost:8200'],
    ['http://host.docker.internal:8200', 'http://host.docker.internal:8200'],
  ])('accepts %s', (input, expected) => {
    expect(normaliseOpenBaoUrl(input)).toBe(expected);
  });

  it.each([
    'http://bao.example.test',
    'ftp://bao.example.test',
    'https://user:pass@bao.example.test',
    'https://bao.example.test/v1',
    'https://bao.example.test?token=abc',
    'not a url',
    '',
  ])('refuses %s', (input) => {
    expect(normaliseOpenBaoUrl(input)).toBeNull();
  });
});

describe('checkOpenBaoConnection', () => {
  it('normalises a valid connection', () => {
    const r = checkOpenBaoConnection(valid);
    expect(r.ok && r.connection.url).toBe('https://bao.example.test');
  });

  it.each<[string, OpenBaoConnection]>([
    ['a traversal in the path', { ...valid, pathPrefix: 'vermilian/../../sys' }],
    ['a bad mount', { ...valid, kvMount: '/secret' }],
    ['a missing RoleID', { ...valid, auth: { ...valid.auth, roleId: '' } }],
    ['no login secret', { ...valid, auth: { ...valid.auth, secretFile: '' } }],
    ['two login secrets', { ...valid, auth: { ...valid.auth, secretCommand: 'print-it' } }],
  ])('refuses %s', (_label, input) => {
    expect(checkOpenBaoConnection(input).ok).toBe(false);
  });

  it('does not need a RoleID for the token method', () => {
    expect(checkOpenBaoConnection({ ...valid, auth: { ...valid.auth, method: 'token', roleId: '' } }).ok).toBe(true);
  });

  it('never quotes the rejected values', () => {
    const r = checkOpenBaoConnection({ ...valid, url: 'http://secret-host.test', namespace: '/secret-ns' });
    expect(JSON.stringify(r)).not.toContain('secret-');
  });
});

describe('sanitiseOpenBaoScopes', () => {
  it('drops unknown fields, so a token cannot be stored', () => {
    const out = sanitiseOpenBaoScopes({
      'ws-a': { ...valid, token: 'fake-token', auth: { ...valid.auth, secretId: 'fake-secret' }, credentials: {} },
    });
    expect(JSON.stringify(out)).not.toContain('fake-token');
    expect(JSON.stringify(out)).not.toContain('fake-secret');
  });

  it('keeps a malformed scope, so its credentials cannot silently move elsewhere', () => {
    const out = sanitiseOpenBaoScopes({ 'ws-a': { url: 'nonsense', credentials: { 'jira-1': { path: 'x', field: 'y' } } } });
    expect(out['ws-a'].credentials['jira-1']).toEqual({ path: 'x', field: 'y' });
    expect(checkOpenBaoConnection(out['ws-a']).ok).toBe(false);
  });

  it('ignores malformed scope IDs and references', () => {
    const out = sanitiseOpenBaoScopes({ 'Bad Id': valid, 'ws-a': { credentials: { 'Bad Ref': { path: 'x', field: 'y' } } } });
    expect(Object.keys(out)).toEqual(['ws-a']);
    expect(out['ws-a'].credentials).toEqual({});
  });
});
