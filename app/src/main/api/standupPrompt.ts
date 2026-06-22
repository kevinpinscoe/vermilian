// Pure prompt assembly for the stand-up report. Extracted from claude.ts so it
// can be unit-tested without the Anthropic SDK.

import type { StandupTask, StandupIssues } from './youtrack';

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function buildStandupPromptSection(title: string, tasks: StandupTask[]): string {
  if (!tasks.length) return '';
  const lines = tasks.map((t) => {
    let line = `- ${t.idReadable}: "${t.summary}"`;
    if (t.priority) line += ` | Priority: ${t.priority}`;
    if (t.loggedMinutesToday > 0) line += ` | Logged today: ${formatDuration(t.loggedMinutesToday)}`;
    return line;
  });
  return `${title}:\n${lines.join('\n')}`;
}

// Assemble the full task-data block sent to the model. Empty sections are omitted.
export function buildStandupSections(issues: StandupIssues): string {
  return [
    buildStandupPromptSection('Done (completed recently)', issues.done),
    buildStandupPromptSection('In Progress', issues.inProgress),
    buildStandupPromptSection('Blocked', issues.blocked),
  ]
    .filter(Boolean)
    .join('\n\n');
}
