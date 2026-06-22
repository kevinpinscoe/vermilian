import Anthropic from '@anthropic-ai/sdk';
import type { AiCreateTaskResult, TestClaudeResult } from '../../shared/ipc';
import type { StandupIssues } from './youtrack';
import { matchProjectByName } from './aiExtract';
import { buildStandupSections } from './standupPrompt';

// Returns the flat TestClaudeResult shape (not a discriminated union) because this
// tsconfig has strictNullChecks off, which disables discriminated-union narrowing.
export async function testKey(key: string, model: string): Promise<TestClaudeResult> {
  try {
    const client = new Anthropic({ apiKey: key });
    await client.messages.create({
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const EXTRACT_TOOL: Anthropic.Tool = {
  name: 'extract_task_fields',
  description:
    'Extract structured YouTrack task fields from a natural-language description. Call this tool with every field you can confidently extract.',
  input_schema: {
    type: 'object' as const,
    properties: {
      summary: {
        type: 'string',
        description: 'Short task title. Empty string if clarification is needed.',
      },
      project: {
        type: ['string', 'null'] as unknown as 'string',
        description: 'Project name exactly as mentioned by the user, or null.',
      },
      priority: {
        type: ['string', 'null'] as unknown as 'string',
        enum: ['Show-stopper', 'Critical', 'Major', 'Normal', 'Minor', null],
        description: 'Task priority or null.',
      },
      status: {
        type: ['string', 'null'] as unknown as 'string',
        description: 'Task status or null.',
      },
      category: {
        type: ['string', 'null'] as unknown as 'string',
        description: 'Task category (e.g. OPS, COMPANY, INBOX) or null.',
      },
      due_date: {
        type: ['string', 'null'] as unknown as 'string',
        description: 'Due date in YYYY-MM-DD format, or null.',
      },
      ticket: {
        type: ['string', 'null'] as unknown as 'string',
        description: 'Jira or external ticket number (e.g. JIRA-123), or null.',
      },
      notes: {
        type: ['string', 'null'] as unknown as 'string',
        description: 'Additional notes or context, or null.',
      },
      clarification_needed: {
        type: ['string', 'null'] as unknown as 'string',
        description:
          'If the description is too vague to extract a meaningful summary, describe what clarification is needed. Otherwise null.',
      },
    },
    required: [
      'summary',
      'project',
      'priority',
      'status',
      'category',
      'due_date',
      'ticket',
      'notes',
      'clarification_needed',
    ],
  },
};

export async function extractTaskFields(
  key: string,
  description: string,
  projects: { id: string; name: string }[],
  model: string,
): Promise<AiCreateTaskResult> {
  try {
    const client = new Anthropic({ apiKey: key });

    const projectList = projects.map((p) => `- ${p.name}`).join('\n');

    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'any' },
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

    const toolUseBlock = response.content.find((b) => b.type === 'tool_use');
    if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
      return { ok: false, error: 'Model did not return structured output — please try again.' };
    }

    const raw = toolUseBlock.input as Record<string, unknown>;

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
  const client = new Anthropic({ apiKey: key });

  const sections = buildStandupSections(issues);

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
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

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text.trim() : '';
}
