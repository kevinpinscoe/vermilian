// One source of a Jira workspace board's issues (VERM-59): a chosen project,
// identified by its key ("DEMO"), or a chosen Jira board, by "board:<id>".
// Project keys never contain a colon, so the two can never collide. The
// source ID is what the renderer's issue and poll queries are keyed by.
// Pure TypeScript.

export type JiraSource = { kind: 'project'; projectKey: string } | { kind: 'board'; boardId: number };

const BOARD_PREFIX = 'board:';

export function boardSourceId(boardId: number): string {
  return `${BOARD_PREFIX}${boardId}`;
}

export function parseJiraSource(id: string): JiraSource {
  if (id.startsWith(BOARD_PREFIX)) {
    const boardId = Number(id.slice(BOARD_PREFIX.length));
    if (Number.isInteger(boardId) && boardId > 0) return { kind: 'board', boardId };
  }
  return { kind: 'project', projectKey: id };
}

/** The IPC arguments that name a source: { projectKey } or { boardId }. */
export function jiraSourceArgs(id: string): { projectKey: string } | { boardId: number } {
  const s = parseJiraSource(id);
  return s.kind === 'board' ? { boardId: s.boardId } : { projectKey: s.projectKey };
}

/** A workspace's sources, projects first in folder order, then boards in their order. */
export function jiraSourceIds(projectKeys: readonly string[], boardIds: readonly number[]): string[] {
  return [...projectKeys, ...boardIds.map(boardSourceId)];
}
