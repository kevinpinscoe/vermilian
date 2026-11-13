// Resolves a workspace's credential reference on this host (ADR-0011 §5,
// VERM-45). Main process only: a resolved value never crosses IPC.
//
// The highest-priority source configured for the reference — command, then
// file, then safeStorage blob — is its only source. If it fails, resolution
// stops with a CredentialFailure naming the workspace, the reference and the
// source kind. Nothing falls through to a lower source, another reference or
// another workspace's credential.
//
// Nothing here is wired into the existing YouTrack, Claude or Jira loading
// paths yet; VERM-46 and VERM-47 switch them over.

import {
  blobFilenameFor,
  checkCredentialValue,
  credentialFailure,
  isLegacyCredentialRef,
  selectSource,
  sourcesFor,
  type CredentialFailure,
  type CredentialSourceKind,
  type CredentialRefStatus,
} from '../../shared/credentialRefs';
import type { AppConfig } from '../../shared/config';
import type { WorkspaceCredentialCheck } from '../../shared/ipc';
import { isCredentialRef, type CredentialRef } from '../../shared/workspaceSchema';

/** Raw reads, each reporting only whether it worked — never why in detail. */
export interface CredentialSourceIO {
  /** Runs a command; `ok: false` for a non-zero exit, a spawn error or a timeout. */
  runCommand(command: string): Promise<{ ok: true; stdout: string } | { ok: false }>;
  readFile(filePath: string): Promise<{ ok: true; content: string } | { ok: false }>;
  /** Whether the blob (or, for a legacy reference, its plain-text fallback) exists. */
  blobPresent(filename: string, legacy: boolean): Promise<boolean>;
  readBlob(filename: string, legacy: boolean): Promise<{ ok: true; value: string } | { ok: false }>;
}

export interface WorkspaceCredentialRequest {
  workspaceId: string;
  /** The workspace's reference for this purpose, or null when none is chosen. */
  credentialRef: CredentialRef | null;
}

export type CredentialResolution =
  | { ok: true; value: string; credentialRef: CredentialRef; source: CredentialSourceKind }
  | ({ ok: false } & CredentialFailure);

function fail(
  req: WorkspaceCredentialRequest,
  source: CredentialSourceKind | null,
  reason: CredentialFailure['reason'],
): CredentialResolution {
  return { ok: false, ...credentialFailure(req.workspaceId, req.credentialRef, source, reason) };
}

export async function resolveWorkspaceCredential(
  req: WorkspaceCredentialRequest,
  cfg: AppConfig,
  io: CredentialSourceIO,
): Promise<CredentialResolution> {
  const ref = req.credentialRef;
  if (ref === null) return fail(req, null, 'not-selected');
  if (!isCredentialRef(ref)) return fail(req, null, 'invalid-reference');

  const legacy = isLegacyCredentialRef(ref);
  const sources = sourcesFor(ref, cfg);
  const blob = blobFilenameFor(ref);
  // The blob is only consulted when nothing above it is configured, so a
  // configured command or file is never second-guessed by a stored value.
  const needBlobCheck = !sources.command.trim() && !sources.file.trim();
  const source = selectSource(sources, needBlobCheck ? await io.blobPresent(blob, legacy) : false);
  if (source === null) return fail(req, null, 'no-source');

  let raw: string;
  if (source === 'command') {
    const r = await io.runCommand(sources.command.trim());
    if (!r.ok) return fail(req, source, 'command-failed');
    raw = r.stdout;
  } else if (source === 'file') {
    const r = await io.readFile(sources.file.trim());
    if (!r.ok) return fail(req, source, 'file-unreadable');
    raw = r.content;
  } else {
    const r = await io.readBlob(blob, legacy);
    if (!r.ok) return fail(req, source, 'blob-unreadable');
    raw = r.value;
  }

  const value = raw.trim();
  const check = checkCredentialValue(value);
  if (check !== 'ok') return fail(req, source, check);
  return { ok: true, value, credentialRef: ref, source };
}

/**
 * Whether a workspace's credential resolves, for IPC: the source on success,
 * the failure otherwise. The resolved value is dropped here, in the main
 * process, and never returned.
 */
export async function checkWorkspaceCredential(
  req: WorkspaceCredentialRequest,
  cfg: AppConfig,
  io: CredentialSourceIO,
): Promise<WorkspaceCredentialCheck> {
  const r = await resolveWorkspaceCredential(req, cfg, io);
  if (!r.ok) return r;
  return { ok: true, credentialRef: r.credentialRef, source: r.source };
}

/**
 * A reference's configuration, without running or reading any source. Says
 * which sources are configured, never their command text or path.
 */
export async function credentialRefStatus(
  ref: CredentialRef,
  cfg: AppConfig,
  io: Pick<CredentialSourceIO, 'blobPresent'>,
): Promise<CredentialRefStatus> {
  const legacy = isLegacyCredentialRef(ref);
  const sources = sourcesFor(ref, cfg);
  const blobPresent = await io.blobPresent(blobFilenameFor(ref), legacy);
  return {
    credentialRef: ref,
    legacy,
    commandConfigured: sources.command.trim() !== '',
    fileConfigured: sources.file.trim() !== '',
    blobPresent,
    selected: selectSource(sources, blobPresent),
  };
}
