// In-memory fake Claude used ONLY under the e2e harness (VERMILIAN_E2E=1).
// Mirrors the surface of api/claude.ts so api/claudeClient.ts can swap it in,
// giving the AI-create and stand-up flows deterministic output with no network
// access and no API key. Outputs are derived from the inputs so e2e specs can
// assert on them.

import type { AiCreateTaskFields, AiCreateTaskResult, TestClaudeResult } from '../../shared/ipc';
import type { StandupIssues, StandupTask } from './youtrack';
import { matchProjectByName } from './aiExtract';
import { formatDuration } from './standupPrompt';

export async function testKey(_key: string, _model: string): Promise<TestClaudeResult> {
  return { ok: true };
}

export async function extractTaskFields(
  _key: string,
  description: string,
  projects: { id: string; name: string }[],
  _model: string,
): Promise<AiCreateTaskResult> {
  const trimmed = description.trim();

  const blank: AiCreateTaskFields = {
    summary: '', projectId: null, priority: null, status: null, category: null,
    dueDate: null, ticket: null, notes: null, projectMatchError: false,
    clarificationNeeded: null,
  };

  // Too short to extract a meaningful summary → ask for clarification.
  if (trimmed.length < 3) {
    return { ok: true, fields: { ...blank, clarificationNeeded: 'Please describe the task in a bit more detail.' } };
  }

  // Deterministic, description-driven extraction.
  const summary = trimmed.split('\n')[0].slice(0, 120);
  const lc = trimmed.toLowerCase();

  // Match a known project named anywhere in the description, if any.
  const named = projects.find((p) => lc.includes(p.name.toLowerCase()));
  const { projectId, projectMatchError } = matchProjectByName(named?.name ?? null, projects);

  const priority =
    lc.includes('critical') ? 'Critical'
    : lc.includes('urgent') || lc.includes('asap') ? 'Major'
    : null;
  const ticket = (trimmed.match(/\b[A-Z]{2,}-\d+\b/) ?? [null])[0];

  return {
    ok: true,
    fields: { ...blank, summary, projectId, priority, ticket, projectMatchError },
  };
}

export async function generateStandupReport(
  _key: string,
  issues: StandupIssues,
  _model: string,
): Promise<string> {
  // Build markdown directly from the issues, matching the format the real model
  // is prompted to produce (## heading + "- ID — summary (duration today)").
  const section = (title: string, tasks: StandupTask[]): string => {
    if (!tasks.length) return '';
    const bullets = tasks.map((t) => {
      const dur = t.loggedMinutesToday > 0 ? ` (${formatDuration(t.loggedMinutesToday)} today)` : '';
      return `- ${t.idReadable} — ${t.summary}${dur}`;
    });
    return `## ${title}\n${bullets.join('\n')}`;
  };
  return [
    section('Done', issues.done),
    section('In Progress', issues.inProgress),
    section('Blocked', issues.blocked),
  ].filter(Boolean).join('\n\n');
}
