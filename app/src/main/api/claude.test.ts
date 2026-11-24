// Request-shape and response-handling tests for the Claude calls (VERM-113).
// The SDK client gets a stub fetch, so nothing reaches the network and no API
// key is needed. Each test queues the responses the "API" returns and inspects
// the requests the SDK actually sent.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { extractTaskFields, generateStandupReport, getRecommendation, testKey } from './claude';
import {
  CUT_OFF_MESSAGE,
  EXTRACT_MAX_TOKENS,
  NO_TOOL_MESSAGE,
  RECOMMENDATION_MAX_TOKENS,
  REFUSED_MESSAGE,
  STANDUP_MAX_TOKENS,
  setClaudeClientFactoryForTests,
} from './claudeCore';
import type { RecommendationIssue, StandupIssues } from './youtrack';
import type { Outcome } from '../../shared/masterPlan';

interface SentRequest {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

interface QueuedResponse {
  status: number;
  body: unknown;
}

let sent: SentRequest[];
let queue: QueuedResponse[];
let restore: () => void;

async function stubFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const raw = init?.body;
  sent.push({
    method: init?.method ?? 'GET',
    path: url.pathname,
    body: typeof raw === 'string' && raw ? (JSON.parse(raw) as Record<string, unknown>) : null,
  });
  const next = queue.shift();
  if (!next) throw new Error(`stub fetch: no response queued for ${url.pathname}`);
  return new Response(JSON.stringify(next.body), {
    status: next.status,
    headers: { 'content-type': 'application/json', 'request-id': 'req_test' },
  });
}

// The JSON body of the i-th request; every Messages request has one.
function bodyOf(i: number): Record<string, unknown> {
  const body = sent[i].body;
  if (!body) throw new Error(`request ${i} (${sent[i].path}) had no JSON body`);
  return body;
}

function message(content: unknown[], stopReason: string): QueuedResponse {
  return {
    status: 200,
    body: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-test',
      content,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  };
}

const toolUse = (name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id: 'toolu_1', name, input });
const text = (t: string) => ({ type: 'text', text: t });
const apiError = (status: number, type: string, msg: string): QueuedResponse => ({
  status,
  body: { type: 'error', error: { type, message: msg } },
});

beforeEach(() => {
  sent = [];
  queue = [];
  restore = setClaudeClientFactoryForTests(
    (apiKey) => new Anthropic({ apiKey, fetch: stubFetch as unknown as typeof fetch, maxRetries: 0 }),
  );
});

afterEach(() => restore());

// ─── AI create task ─────────────────────────────────────────────────────────

const PROJECTS = [{ id: '0-1', name: 'Vermilian' }];
const EXTRACTED = {
  summary: 'Fix the login bug',
  project: 'Vermilian',
  priority: 'Major',
  status: null,
  category: null,
  due_date: '2026-12-01',
  ticket: null,
  notes: null,
  clarification_needed: null,
};

describe('extractTaskFields', () => {
  it('never forces tool use, and asks for at most one call with room for thinking', async () => {
    queue.push(message([toolUse('extract_task_fields', EXTRACTED)], 'tool_use'));
    await extractTaskFields('k', 'fix login', PROJECTS, 'claude-sonnet-5-5');

    expect(sent).toHaveLength(1);
    const body = bodyOf(0);
    expect(sent[0].path).toBe('/v1/messages');
    expect(body.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
    expect(body.max_tokens).toBe(EXTRACT_MAX_TOKENS);
    expect((body.tools as { name: string }[]).map((t) => t.name)).toEqual(['extract_task_fields']);
    expect(body.system).toContain('Always call the extract_task_fields tool');
  });

  it('maps the tool input to fields and matches the project', async () => {
    queue.push(message([text('Here you go.'), toolUse('extract_task_fields', EXTRACTED)], 'tool_use'));
    const res = await extractTaskFields('k', 'fix login', PROJECTS, 'm');

    expect(res.ok).toBe(true);
    expect(res.fields?.summary).toBe('Fix the login bug');
    expect(res.fields?.projectId).toBe('0-1');
    expect(res.fields?.priority).toBe('Major');
    expect(res.fields?.dueDate).toBe('2026-12-01');
    expect(res.fields?.status).toBeNull();
  });

  it('retries once when the model answers in text, and uses the second reply', async () => {
    queue.push(message([text('Sure — what project?')], 'end_turn'));
    queue.push(message([toolUse('extract_task_fields', EXTRACTED)], 'tool_use'));
    const res = await extractTaskFields('k', 'fix login', PROJECTS, 'm');

    expect(sent).toHaveLength(2);
    expect(res.ok).toBe(true);
    expect(res.fields?.summary).toBe('Fix the login bug');
  });

  it('gives up after the retry with the no-structured-output message', async () => {
    queue.push(message([text('no')], 'end_turn'));
    queue.push(message([text('still no')], 'end_turn'));
    const res = await extractTaskFields('k', 'fix login', PROJECTS, 'm');

    expect(sent).toHaveLength(2);
    expect(res).toEqual({ ok: false, error: NO_TOOL_MESSAGE });
  });

  it('ignores a call to a different tool name', async () => {
    queue.push(message([toolUse('something_else', {})], 'tool_use'));
    queue.push(message([toolUse('something_else', {})], 'tool_use'));
    const res = await extractTaskFields('k', 'fix login', PROJECTS, 'm');
    expect(res).toEqual({ ok: false, error: NO_TOOL_MESSAGE });
  });

  it('reports a cut-off reply without parsing its half-written tool call, and does not retry', async () => {
    queue.push(message([toolUse('extract_task_fields', { summary: 'Fix the' })], 'max_tokens'));
    const res = await extractTaskFields('k', 'fix login', PROJECTS, 'm');

    expect(sent).toHaveLength(1);
    expect(res).toEqual({ ok: false, error: CUT_OFF_MESSAGE });
  });

  it('reports a refusal', async () => {
    queue.push(message([], 'refusal'));
    const res = await extractTaskFields('k', 'fix login', PROJECTS, 'm');
    expect(res).toEqual({ ok: false, error: REFUSED_MESSAGE });
  });

  it('returns an API error instead of throwing', async () => {
    queue.push(apiError(400, 'invalid_request_error', 'tool_choice: type "any" is not supported for this model.'));
    const res = await extractTaskFields('k', 'fix login', PROJECTS, 'm');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('400');
  });
});

// ─── Recommendations ────────────────────────────────────────────────────────

const ISSUES: RecommendationIssue[] = [
  { id: 'p-1', idReadable: 'TEST-1', summary: 'Fix the thing', description: null, status: 'To do', priority: 'Normal', links: [] },
];
const OUTCOME: Outcome = {
  name: 'Ship the desk',
  activeEpics: ['TEST-3'],
  successMeasure: null,
  targetWindow: null,
  risks: null,
};
const RANKED_INPUT = {
  clarification_needed: null,
  ranked: [
    {
      issue_id: 'p-1',
      outcome_contribution: 'Advances it directly.',
      dependency_readiness: 'No blockers.',
      urgency: 'Due soon.',
      effort: 'Small.',
      risk: 'Low.',
    },
  ],
  alternates: [],
};

describe('getRecommendation', () => {
  it('never forces tool use and tells the model to answer through the tool', async () => {
    queue.push(message([toolUse('recommend_priority', RANKED_INPUT)], 'tool_use'));
    await getRecommendation('k', ISSUES, [], OUTCOME, 'claude-opus-5-5');

    const body = bodyOf(0);
    expect(body.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
    expect(body.max_tokens).toBe(RECOMMENDATION_MAX_TOKENS);
    expect((body.tools as { name: string }[]).map((t) => t.name)).toEqual(['recommend_priority']);
    expect(body.system).toContain('calling the recommend_priority tool');
  });

  it('parses a ranked recommendation', async () => {
    queue.push(message([toolUse('recommend_priority', RANKED_INPUT)], 'tool_use'));
    const res = await getRecommendation('k', ISSUES, [], OUTCOME, 'm');
    if (res.kind !== 'ranked') throw new Error(`expected a ranked result, got ${res.kind}`);
    expect(res.ranked[0].issueId).toBe('p-1');
  });

  it('turns a failure into a clarification carrying the matching message', async () => {
    queue.push(message([text('…')], 'max_tokens'));
    expect(await getRecommendation('k', ISSUES, [], OUTCOME, 'm')).toEqual({
      kind: 'clarification',
      question: CUT_OFF_MESSAGE,
    });

    queue.push(message([text('a')], 'end_turn'), message([text('b')], 'end_turn'));
    expect(await getRecommendation('k', ISSUES, [], OUTCOME, 'm')).toEqual({
      kind: 'clarification',
      question: NO_TOOL_MESSAGE,
    });
  });
});

// ─── Stand-up ───────────────────────────────────────────────────────────────

const NO_TASKS: StandupIssues = { done: [], inProgress: [], blocked: [] };

describe('generateStandupReport', () => {
  it('sends no tools and leaves room for thinking', async () => {
    queue.push(message([text('## Done\n- TEST-1 — Did it')], 'end_turn'));
    await generateStandupReport('k', NO_TASKS, 'm');

    const body = bodyOf(0);
    expect(body.max_tokens).toBe(STANDUP_MAX_TOKENS);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it('returns the text block, skipping a thinking block before it', async () => {
    queue.push(message([{ type: 'thinking', thinking: '', signature: 'sig' }, text('  ## Done\n- TEST-1 — Did it  ')], 'end_turn'));
    expect(await generateStandupReport('k', NO_TASKS, 'm')).toBe('## Done\n- TEST-1 — Did it');
  });

  it('throws instead of returning a cut-off report', async () => {
    queue.push(message([text('## Done\n- TEST-1 — Did')], 'max_tokens'));
    await expect(generateStandupReport('k', NO_TASKS, 'm')).rejects.toThrow(CUT_OFF_MESSAGE);
  });

  it('throws on a refusal', async () => {
    queue.push(message([], 'refusal'));
    await expect(generateStandupReport('k', NO_TASKS, 'm')).rejects.toThrow(REFUSED_MESSAGE);
  });
});

// ─── Test Claude key ────────────────────────────────────────────────────────

describe('testKey', () => {
  it('looks the model up instead of generating anything', async () => {
    queue.push({
      status: 200,
      body: { type: 'model', id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6', created_at: '2026-01-01T00:00:00Z' },
    });
    expect(await testKey('k', 'claude-sonnet-4-6')).toEqual({ ok: true });

    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe('GET');
    expect(sent[0].path).toBe('/v1/models/claude-sonnet-4-6');
  });

  it('says the key works but the model is unknown on a 404', async () => {
    queue.push(apiError(404, 'not_found_error', 'model: claude-nope'));
    const res = await testKey('k', 'claude-nope');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('The key works, but the model "claude-nope" was not found. Check the model name in Settings → AI.');
  });

  it('passes an authentication failure through for the renderer to word', async () => {
    queue.push(apiError(401, 'authentication_error', 'invalid x-api-key'));
    const res = await testKey('bad', 'claude-sonnet-4-6');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('401');
  });
});
