// Creating a workspace and choosing a Jira workspace's projects (VERM-33,
// ADR-0011 §1, §3).
//
// Three rules from Kevin (recorded on VERM-33, 2026-11-13):
//   - creating a workspace, the user explicitly chooses YouTrack or Jira;
//     there is no default backend, so NewWorkspaceInput has no optional kind;
//   - a workspace has exactly one backend and never mixes YouTrack and Jira
//     projects: Jira project selection applies only to a Jira workspace, and
//     only Jira project keys reach its folders;
//   - changing an existing workspace's backend must not silently discard its
//     configuration: backendChangeProblem refuses a change of kind while the
//     workspace still holds projects, board settings, Jira project settings
//     or dismissals that belong to the old backend.
//
// Pure TypeScript: no Electron, no React.

import { normaliseSiteUrl } from './jiraProfile';
import {
  WORKSPACE_SCHEMA_VERSION,
  validateWorkspaceDocument,
  workspaceProjectIds,
  type CredentialRef,
  type WorkspaceDocument,
  type WorkspaceValidationError,
} from './workspaceSchema';

export type NewWorkspaceBackend =
  | { kind: 'youtrack'; serverUrl: string; credentialRef: CredentialRef | null }
  | { kind: 'jira'; siteUrl: string; email: string; credentialRef: CredentialRef | null };

export interface NewWorkspaceInput {
  workspaceId: string;
  name: string;
  order: number;
  backend: NewWorkspaceBackend;
  /** The Anthropic credential reference AI features use; None (null) when omitted (VERM-47). */
  aiCredentialRef?: CredentialRef | null;
}

export type BuildWorkspaceResult =
  | { ok: true; document: WorkspaceDocument }
  | { ok: false; errors: WorkspaceValidationError[] };

/** The one folder a new workspace starts with; projects are added to it. */
export const DEFAULT_FOLDER_ID = 'folder-projects';
const DEFAULT_FOLDER_NAME = 'Projects';

/** The display order a new workspace takes: after every existing one. */
export function nextWorkspaceOrder(existing: readonly Pick<WorkspaceDocument, 'order'>[]): number {
  return existing.reduce((max, d) => Math.max(max, d.order + 1), 0);
}

/**
 * A new workspace document, validated. Connection values are normalised the
 * way the schema stores them (trimmed, Jira site URL in canonical form); any
 * remaining problem is returned rather than thrown, for the form to show.
 */
export function buildWorkspaceDocument(input: NewWorkspaceInput): BuildWorkspaceResult {
  const b = input.backend;
  const backend: WorkspaceDocument['backend'] =
    b.kind === 'youtrack'
      ? { kind: 'youtrack', serverUrl: b.serverUrl.trim().replace(/\/+$/, ''), credentialRef: b.credentialRef }
      : {
          kind: 'jira',
          siteUrl: normaliseSiteUrl(b.siteUrl) ?? b.siteUrl.trim(),
          email: b.email.trim(),
          cloudId: '',
          credentialRef: b.credentialRef,
        };
  const document: WorkspaceDocument = {
    schema: WORKSPACE_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    name: input.name.trim(),
    order: input.order,
    backend,
    // None unless the form chose one: a new workspace is never given
    // anthropic-1 (VERM-47, proposal R5.4 G3).
    ai: { credentialRef: input.aiCredentialRef ?? null },
    // None: a new workspace has no master plan until one is chosen (VERM-48).
    masterPlan: { articleId: null },
    folders: [{ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME, order: 0, parentId: null, projectIds: [] }],
    boards: {},
    dismissals: {},
  };
  const errors = validateWorkspaceDocument(document);
  return errors.length ? { ok: false, errors } : { ok: true, document };
}

export class WorkspaceSetupError extends Error {}

const JIRA_PROJECT_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

/**
 * The workspace with exactly `projectKeys` selected. Projects that stay keep
 * their folder and position; new ones are appended to the first folder (one
 * is created if there is none); deselected ones leave their folder. Board and
 * per-project settings are kept, so re-selecting a project restores them.
 *
 * Throws WorkspaceSetupError for a workspace that is not Jira-backed or for a
 * value that is not a Jira project key.
 */
export function withJiraProjects(doc: WorkspaceDocument, projectKeys: readonly string[]): WorkspaceDocument {
  if (doc.backend.kind !== 'jira') {
    throw new WorkspaceSetupError('Jira projects can only be chosen for a Jira workspace.');
  }
  for (const k of projectKeys) {
    if (typeof k !== 'string' || !JIRA_PROJECT_KEY_RE.test(k)) {
      throw new WorkspaceSetupError(`Not a Jira project key: ${JSON.stringify(k)}`);
    }
  }
  const wanted = new Set(projectKeys);
  const kept = new Set<string>();
  const folders = doc.folders.map((f) => {
    const projectIds = f.projectIds.filter((id) => wanted.has(id) && !kept.has(id));
    projectIds.forEach((id) => kept.add(id));
    return { ...f, projectIds };
  });
  const added = [...new Set(projectKeys)].filter((k) => !kept.has(k));
  if (added.length) {
    const first = [...folders].sort((a, b) => a.order - b.order)[0];
    if (first) first.projectIds = [...first.projectIds, ...added];
    else folders.push({ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME, order: 0, parentId: null, projectIds: added });
  }
  return { ...doc, folders };
}

/**
 * Why `edited` may not replace `base`, or null when it may. A change of
 * backend kind is refused while the workspace holds anything configured for
 * the old backend; the message says what to do instead. A change within the
 * same kind (a new server URL, credential or email) is always allowed.
 */
export function backendChangeProblem(base: WorkspaceDocument, edited: WorkspaceDocument): string | null {
  if (base.backend.kind === edited.backend.kind) return null;
  const held: string[] = [];
  if (workspaceProjectIds(base).length) held.push('projects');
  if (Object.keys(base.boards ?? {}).length) held.push('board settings');
  if (Object.keys(base.jiraProjects ?? {}).length) held.push('Jira project settings');
  if (Object.keys(base.dismissals ?? {}).length) held.push('"Not this week" dismissals');
  if (!held.length) return null;
  const from = base.backend.kind === 'jira' ? 'Jira' : 'YouTrack';
  const to = edited.backend.kind === 'jira' ? 'Jira' : 'YouTrack';
  return (
    `"${base.name}" still has ${held.join(', ')} from ${from}, and changing it to ${to} would discard them. ` +
    `Create a new ${to} workspace instead, or remove them first.`
  );
}
