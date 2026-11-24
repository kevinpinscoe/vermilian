import Anthropic from '@anthropic-ai/sdk';
import {
  callTool,
  CUT_OFF_MESSAGE,
  EXTRACT_MAX_TOKENS,
  makeClient,
  RECOMMENDATION_MAX_TOKENS,
  REFUSED_MESSAGE,
  STANDUP_MAX_TOKENS,
  toolFailureMessage,
} from './claudeCore';
import type { AiCreateTaskResult, RecommendationCandidateContext, RecommendationResult, TestClaudeResult } from '../../shared/ipc';
import type { Outcome } from '../../shared/masterPlan';
import type { RecommendationIssue, StandupIssues } from './youtrack';
import { matchProjectByName } from './aiExtract';
import type { CreateFieldOptions } from '../../shared/createFieldOptions';
import { buildExtractTool } from './extractTool';
import { buildStandupSections } from './standupPrompt';
import {
  buildRecommendationPrompt,
  buildRecommendationTool,
  parseRecommendationToolInput,
  RECOMMENDATION_SYSTEM_PROMPT,
  type RecommendationRawInput,
} from './recommendationPrompt';

// Returns the flat TestClaudeResult shape (not a discriminated union) because this
// tsconfig has strictNullChecks off, which disables discriminated-union narrowing.
//
// Looks the model up instead of generating a token: it proves the key works
// (401 otherwise) and that the configured model ID exists (404 otherwise), costs
// nothing, and does not depend on per-model generation rules — a one-token
// Messages request could not leave room for thinking on newer models (VERM-113).
export async function testKey(key: string, model: string): Promise<TestClaudeResult> {
  try {
    const client = makeClient(key);
    await client.models.retrieve(model);
    return { ok: true };
  } catch (e) {
    if (e instanceof Anthropic.NotFoundError) {
      return { ok: false, error: `The key works, but the model "${model}" was not found. Check the model name in Settings → AI.` };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function extractTaskFields(
  key: string,
  description: string,
  projects: { id: string; name: string }[],
  model: string,
  allowed: CreateFieldOptions | null = null,
): Promise<AiCreateTaskResult> {
  try {
    const client = makeClient(key);

    const projectList = projects.map((p) => `- ${p.name}`).join('\n');

    const outcome = await callTool(client, {
      model,
      max_tokens: EXTRACT_MAX_TOKENS,
      tool: buildExtractTool(allowed),
      system:
        'You are a task extraction assistant for a YouTrack project management app. ' +
        'Extract structured task fields from the user\'s natural-language description. ' +
        'Always call the extract_task_fields tool. ' +
        'Only populate fields you can confidently extract — leave others null. ' +
        'If the description is too vague to determine a summary, set clarification_needed.',
      messages: [
        {
          role: 'user',
          content:
            `Available projects:\n${projectList}\n\nTask description:\n${description}`,
        },
      ],
    });

    if (outcome.failure || !outcome.input) {
      return { ok: false, error: toolFailureMessage(outcome.failure) };
    }

    const raw = outcome.input;

    // Match extracted project name to a known project ID
    const { projectId, projectMatchError } = matchProjectByName(
      typeof raw.project === 'string' ? raw.project : null,
      projects,
    );

    const str = (v: unknown): string | null =>
      typeof v === 'string' && v.trim() ? v.trim() : null;

    return {
      ok: true,
      fields: {
        summary: str(raw.summary) ?? '',
        projectId,
        priority: str(raw.priority),
        status: str(raw.status),
        category: str(raw.category),
        dueDate: str(raw.due_date),
        ticket: str(raw.ticket),
        notes: str(raw.notes),
        projectMatchError,
        clarificationNeeded: str(raw.clarification_needed),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// --- Stand-up report generation ---
// Prompt assembly (formatDuration / buildStandupPromptSection / buildStandupSections)
// lives in standupPrompt.ts so it can be unit-tested without the SDK.

export async function generateStandupReport(
  key: string,
  issues: StandupIssues,
  model: string,
): Promise<string> {
  const client = makeClient(key);

  const sections = buildStandupSections(issues);

  const response = await client.messages.create({
    model,
    max_tokens: STANDUP_MAX_TOKENS,
    system: `You are a daily stand-up assistant. Generate a concise stand-up report from the task data.
Format the output as markdown with up to three sections (include only non-empty ones):
## Done
## In Progress
## Blocked

Each section is a bullet list. Each bullet MUST start with the YouTrack issue ID verbatim, followed by an em dash (—) and a short summary.
Example: - KP-42 — Refactor the API client to use TanStack Query
If logged time is provided for a task, append it in parentheses at the end of the bullet: (1h 25m today)
Keep each bullet concise. You may lightly rephrase summaries for clarity. Omit empty sections.`,
    messages: [
      {
        role: 'user',
        content: `Today's relevant tasks:\n\n${sections}\n\nGenerate the stand-up report.`,
      },
    ],
  });

  // A cut-off report would silently drop sections; say so instead (VERM-113).
  if (response.stop_reason === 'max_tokens') throw new Error(CUT_OFF_MESSAGE);
  if (response.stop_reason === 'refusal') throw new Error(REFUSED_MESSAGE);

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text.trim() : '';
}

// --- Priority Desk "Ask for recommendation" (VERM-8) ---
// Bounded strictly to the given candidate issues and the single selected
// Outcome — see recommendationPrompt.ts's buildRecommendationPrompt for the
// exact data scope. Never writes any field itself; this only returns a
// recommendation for the renderer to display.

export async function getRecommendation(
  key: string,
  issues: RecommendationIssue[],
  candidateContext: RecommendationCandidateContext[],
  outcome: Outcome,
  model: string,
): Promise<RecommendationResult> {
  const client = makeClient(key);
  const issueIds = issues.map((i) => i.id);
  const tool = buildRecommendationTool(issueIds);
  const prompt = buildRecommendationPrompt(issues, candidateContext, outcome);

  const result = await callTool(client, {
    model,
    max_tokens: RECOMMENDATION_MAX_TOKENS,
    tool: tool as unknown as Anthropic.Tool,
    system: RECOMMENDATION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  if (result.failure || !result.input) {
    return { kind: 'clarification', question: toolFailureMessage(result.failure) };
  }

  return parseRecommendationToolInput(result.input as unknown as RecommendationRawInput, issues);
}
