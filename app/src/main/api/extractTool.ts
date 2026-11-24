// The AI create extraction tool (VERM-115), kept apart from claude.ts so
// the fake Claude (fakeClaude.ts) need not mirror it.

import type Anthropic from '@anthropic-ai/sdk';
import { CREATE_FIELD_KEYS, CREATE_FIELD_NAMES, type CreateFieldOptions } from '../../shared/createFieldOptions';

// The extraction tool. No value list is fixed here (VERM-115): when the
// project is known before the request, its own Status/Priority/Category
// values become the schema's enums; otherwise the fields are free strings and
// are validated against the matched project afterwards (ipc.ts).
export const EXTRACT_TOOL_BASE: Anthropic.Tool = {
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
        description: 'Task priority or null.',
      },
      status: {
        type: ['string', 'null'] as unknown as 'string',
        description: 'Task status or null.',
      },
      category: {
        type: ['string', 'null'] as unknown as 'string',
        description: 'Task category or null.',
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

/**
 * The extraction tool for one request. With `allowed`, each field the project
 * has is limited to its values (plus null), and a field it lacks is limited
 * to null; without it, the base tool is used unchanged.
 */
export function buildExtractTool(allowed: CreateFieldOptions | null): Anthropic.Tool {
  if (!allowed) return EXTRACT_TOOL_BASE;
  const schema = EXTRACT_TOOL_BASE.input_schema as { properties: Record<string, Record<string, unknown>> };
  const properties = { ...schema.properties };
  for (const key of CREATE_FIELD_KEYS) {
    const opt = allowed[key];
    properties[key] = {
      ...properties[key],
      enum: [...(opt.present ? opt.values : []), null],
      description: opt.present
        ? `Task ${CREATE_FIELD_NAMES[key].toLowerCase()}: one of the listed values, or null.`
        : `Always null: this project has no ${CREATE_FIELD_NAMES[key]} field.`,
    };
  }
  return { ...EXTRACT_TOOL_BASE, input_schema: { ...EXTRACT_TOOL_BASE.input_schema, properties } };
}
