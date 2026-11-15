// The active workspace (VERM-46, ADR-0011 §1–§2): exactly one workspace is
// active on each machine, and the choice is per-machine state. It is kept in
// the local user-data directory and never written to the shared
// _vermilian-config article, so switching on one machine cannot move another.
//
// Workspaces come from one of two stores, chosen by the activation gate:
//   legacy        — _vermilian-config (authoritative today), every workspace
//                   on the one configured YouTrack server;
//   per-workspace — the _vermilian-ws-<id> articles (VERM-43), each with its
//                   own backend. Activating this store is VERM-53's job; in
//                   VERM-46 the gate is off everywhere except e2e.
//
// Everything here is plain data: no secrets, no credential values. A backend
// context names a credential *reference*, never what it resolves to.
//
// Pure TypeScript: no Electron, no React.

import type { Workspace } from './workspace';
import type { CredentialRef, WorkspaceDocument } from './workspaceSchema';
import { aiAvailability, type AiAvailability } from './workspaceAi';

import type { WorkspaceStorageMode } from './storageActivation';
export type { WorkspaceStorageMode };

export type ActiveBackendContext =
  | { kind: 'youtrack'; serverUrl: string; credentialRef: string | null }
  | { kind: 'jira'; siteUrl: string; credentialRef: string | null };

export interface ActiveWorkspaceContext {
  storage: WorkspaceStorageMode;
  workspaceId: string; // '' when there are no workspaces yet
  workspaceName: string;
  backend: ActiveBackendContext | null;
  // Whether this build can show the workspace's board. A Jira workspace has a
  // read-only board (VERM-34); a YouTrack backend on a server other than the
  // configured one does not (per-workspace credential loading is VERM-53).
  boardAvailable: boolean;
  boardUnavailableReason: string | null;
  // Whether this workspace's AI features can run here, and why not (VERM-47,
  // shared/workspaceAi.ts). Names a reference at most, never a value.
  ai: AiAvailability;
}

export type SetActiveWorkspaceResult =
  | { ok: true; context: ActiveWorkspaceContext }
  | { ok: false; message: string };

/** One selectable workspace, as either store describes it. */
export interface WorkspaceChoice {
  id: string;
  name: string;
  order: number;
  backend: ActiveBackendContext;
  /** The Anthropic credential reference its AI features use (aiCredentialRefOf). */
  aiCredentialRef: CredentialRef | null;
}

/**
 * Pick the active workspace from the ones that exist.
 *
 * The locally stored choice wins when it still names a workspace. Otherwise
 * the legacy hint — the activeWorkspaceId _vermilian-config carried before
 * VERM-46, read and never written — keeps an upgraded machine on the
 * workspace it was showing. Otherwise the first workspace in display order.
 */
export function resolveActiveWorkspaceId(
  choices: readonly Pick<WorkspaceChoice, 'id' | 'order'>[],
  stored: string,
  legacyHint: string,
): string {
  const ids = new Set(choices.map((c) => c.id));
  if (stored && ids.has(stored)) return stored;
  if (legacyHint && ids.has(legacyHint)) return legacyHint;
  const first = [...choices].sort((a, b) => a.order - b.order)[0];
  return first?.id ?? '';
}

/** A per-workspace document's backend, reduced to its non-secret context. */
export function backendContextOf(doc: Pick<WorkspaceDocument, 'backend'>): ActiveBackendContext {
  const b = doc.backend;
  return b.kind === 'youtrack'
    ? { kind: 'youtrack', serverUrl: b.serverUrl, credentialRef: b.credentialRef }
    : { kind: 'jira', siteUrl: b.siteUrl, credentialRef: b.credentialRef };
}

/** Per-workspace documents as the rail's Workspace shape (read-only view). */
export function workspacesFromDocuments(docs: readonly WorkspaceDocument[]): Workspace[] {
  return [...docs]
    .sort((a, b) => a.order - b.order)
    .map((d) => ({ id: d.workspaceId, name: d.name, order: d.order, folders: d.folders }));
}

/** Whether this build can show the board for `backend`. */
export function boardAvailability(
  backend: ActiveBackendContext | null,
  configuredServerUrl: string,
): { available: boolean; reason: string | null } {
  if (!backend) return { available: true, reason: null };
  // Read-only, through the workspace's own Jira connection (VERM-34).
  if (backend.kind === 'jira') return { available: true, reason: null };
  // Under per-workspace storage every issue operation uses the workspace's
  // own server and credential reference (VERM-53), so a different server is
  // fine. Legacy workspaces are always on the configured server.
  void configuredServerUrl;
  return { available: true, reason: null };
}

/** Assemble the context for `id` from the available choices. */
export function buildActiveContext(
  storage: WorkspaceStorageMode,
  choices: readonly WorkspaceChoice[],
  id: string,
  configuredServerUrl: string,
  /** Whether the chosen workspace's AI reference has a source on this machine. */
  aiConfigured = false,
): ActiveWorkspaceContext {
  const ws = choices.find((c) => c.id === id) ?? null;
  const backend = ws?.backend ?? null;
  const board = boardAvailability(backend, configuredServerUrl);
  return {
    storage,
    workspaceId: ws?.id ?? '',
    workspaceName: ws?.name ?? '',
    backend,
    boardAvailable: board.available,
    boardUnavailableReason: board.reason,
    ai: aiAvailability(ws?.aiCredentialRef ?? null, aiConfigured),
  };
}
