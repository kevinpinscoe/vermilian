// Credential references, resolved per host (ADR-0011 §5, VERM-45).
//
// A workspace names a credential by an opaque reference (`anthropic-1`,
// `jira-1`, …). Each host maps a reference to its own sources, in priority
// order: a shell command, a file path, an Electron safeStorage blob. The
// highest-priority source configured for that reference is its only source:
// if it fails, resolution stops. Nothing falls through to a lower source, to
// another reference, or to another workspace's credential.
//
// Three references are special, for compatibility with workspaces migrated by
// VERM-44: `youtrack-1`, `anthropic-1` and `jira-1` resolve through the legacy
// per-kind settings (`youtrackTokenCommand`, `claude.key.bin`, …) and nowhere
// else. Every other reference resolves only through its own entry in
// `AppConfig.credentialSources` and its own blob.
//
// Pure: no Electron, no Node. Safe in either process and in unit tests.

import type { AppConfig, CredentialSourceConfig } from './config';
import { isCredentialRef, type CredentialRef } from './workspaceSchema';
import {
  MIGRATED_ANTHROPIC_CREDENTIAL_REF,
  MIGRATED_JIRA_CREDENTIAL_REF,
  MIGRATED_YOUTRACK_CREDENTIAL_REF,
} from './workspaceMigration';

export type { CredentialSourceConfig };

export type CredentialSourceKind = 'command' | 'file' | 'safeStorage';

interface LegacyMapping {
  commandKey: 'youtrackTokenCommand' | 'claudeKeyCommand' | 'jiraTokenCommand';
  fileKey: 'youtrackTokenFile' | 'claudeKeyFile' | 'jiraTokenFile';
  /** The legacy blob filename, matching credentials.ts FILES. */
  blob: string;
}

/** The only references that read the legacy per-kind settings. */
export const LEGACY_CREDENTIAL_REFS: Readonly<Record<string, LegacyMapping>> = Object.freeze({
  [MIGRATED_YOUTRACK_CREDENTIAL_REF]: {
    commandKey: 'youtrackTokenCommand',
    fileKey: 'youtrackTokenFile',
    blob: 'youtrack.token.bin',
  },
  [MIGRATED_ANTHROPIC_CREDENTIAL_REF]: {
    commandKey: 'claudeKeyCommand',
    fileKey: 'claudeKeyFile',
    blob: 'claude.key.bin',
  },
  [MIGRATED_JIRA_CREDENTIAL_REF]: {
    commandKey: 'jiraTokenCommand',
    fileKey: 'jiraTokenFile',
    blob: 'jira.token.bin',
  },
});

export function isLegacyCredentialRef(ref: string): boolean {
  return Object.prototype.hasOwnProperty.call(LEGACY_CREDENTIAL_REFS, ref);
}

const REF_BLOB_PREFIX = 'ref-';
const REF_BLOB_SUFFIX = '.bin';

/**
 * The safeStorage blob filename for a reference. A legacy reference keeps its
 * legacy file; any other gets `ref-<reference>.bin`, which can never collide
 * with a legacy filename because those contain a dot before `.bin`.
 */
export function blobFilenameFor(ref: CredentialRef): string {
  const legacy = LEGACY_CREDENTIAL_REFS[ref];
  if (legacy && isLegacyCredentialRef(ref)) return legacy.blob;
  return `${REF_BLOB_PREFIX}${ref}${REF_BLOB_SUFFIX}`;
}

/** The reference a per-reference blob filename belongs to, or null. */
export function refFromBlobFilename(name: string): CredentialRef | null {
  if (!name.startsWith(REF_BLOB_PREFIX) || !name.endsWith(REF_BLOB_SUFFIX)) return null;
  const ref = name.slice(REF_BLOB_PREFIX.length, -REF_BLOB_SUFFIX.length);
  return isCredentialRef(ref) && !isLegacyCredentialRef(ref) ? ref : null;
}

/** A reference's command and file sources on this host, from the right place. */
export function sourcesFor(ref: CredentialRef, cfg: AppConfig): CredentialSourceConfig {
  if (isLegacyCredentialRef(ref)) {
    const m = LEGACY_CREDENTIAL_REFS[ref];
    return { command: cfg[m.commandKey] ?? '', file: cfg[m.fileKey] ?? '' };
  }
  const own = Object.prototype.hasOwnProperty.call(cfg.credentialSources ?? {}, ref)
    ? cfg.credentialSources[ref]
    : undefined;
  return { command: own?.command ?? '', file: own?.file ?? '' };
}

/**
 * The single source a reference resolves through: the highest-priority one
 * that is configured. Only a genuinely unconfigured source is skipped. Null
 * when nothing is configured.
 */
export function selectSource(
  sources: CredentialSourceConfig,
  blobPresent: boolean,
): CredentialSourceKind | null {
  if (sources.command.trim()) return 'command';
  if (sources.file.trim()) return 'file';
  if (blobPresent) return 'safeStorage';
  return null;
}

const MAX_CREDENTIAL_LENGTH = 4096;
// Whitespace or control characters inside a value mean the source produced
// something other than a single credential (a warning line plus a token, a
// prompt, a multi-line file), so it is refused rather than used.
// eslint-disable-next-line no-control-regex
const INVALID_CHARS_RE = /[\s\u0000-\u001f\u007f]/;

export type CredentialValueCheck = 'ok' | 'empty' | 'invalid';

/** Checks a source's trimmed output before it is used as a credential. */
export function checkCredentialValue(value: string): CredentialValueCheck {
  if (value.length === 0) return 'empty';
  if (value.length > MAX_CREDENTIAL_LENGTH || INVALID_CHARS_RE.test(value)) return 'invalid';
  return 'ok';
}

export type CredentialFailureReason =
  | 'not-selected' // the workspace names no reference (e.g. no Anthropic account chosen)
  | 'invalid-reference' // the reference is not a well-formed reference
  | 'no-source' // nothing is configured for the reference on this host
  | 'command-failed' // non-zero exit, could not start, or timed out
  | 'file-unreadable'
  | 'blob-unreadable' // missing at read time, or cannot be decrypted
  | 'empty' // the source produced nothing
  | 'invalid'; // the source produced something that is not a single credential

export interface CredentialFailure {
  workspaceId: string;
  credentialRef: string | null;
  source: CredentialSourceKind | null;
  reason: CredentialFailureReason;
  /** Human-readable; never contains a credential, command output or file content. */
  message: string;
}

const SOURCE_LABEL: Record<CredentialSourceKind, string> = {
  command: 'command',
  file: 'file',
  safeStorage: 'saved (safeStorage) credential',
};

const REASON_TEXT: Record<CredentialFailureReason, string> = {
  'not-selected': 'names no credential',
  'invalid-reference': 'names a malformed credential reference',
  'no-source': 'has no source configured on this machine',
  'command-failed': 'failed to run or exited with an error',
  'file-unreadable': 'could not be read',
  'blob-unreadable': 'could not be read or decrypted',
  empty: 'produced an empty value',
  invalid: 'produced a value that is not a single credential',
};

/**
 * Builds a failure. The message names the workspace, the reference and the
 * source kind — never the command text, file path, output or value, any of
 * which can carry a secret.
 */
export function credentialFailure(
  workspaceId: string,
  credentialRef: string | null,
  source: CredentialSourceKind | null,
  reason: CredentialFailureReason,
): CredentialFailure {
  const ws = isSafeLabel(workspaceId) ? workspaceId : '(unnamed workspace)';
  const ref = credentialRef !== null && isCredentialRef(credentialRef) ? credentialRef : null;
  let message: string;
  if (reason === 'not-selected') {
    message = `Workspace ${ws} has no credential selected.`;
  } else if (reason === 'invalid-reference' || ref === null) {
    message = `Workspace ${ws} names a malformed credential reference.`;
  } else if (source === null) {
    message = `Credential ${ref} for workspace ${ws} ${REASON_TEXT[reason]}.`;
  } else {
    message = `The ${SOURCE_LABEL[source]} for credential ${ref} (workspace ${ws}) ${REASON_TEXT[reason]}.`;
  }
  return {
    workspaceId: ws,
    credentialRef: ref,
    source,
    reason: ref === null && reason !== 'not-selected' ? 'invalid-reference' : reason,
    message,
  };
}

function isSafeLabel(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
}

/**
 * Keeps only well-formed, non-legacy references with string sources, and
 * drops entries with nothing configured. Applied whenever the config is read
 * or written, so a hand-edited or renderer-supplied map cannot smuggle in a
 * legacy reference or a non-string value.
 */
export function sanitiseCredentialSources(input: unknown): Record<CredentialRef, CredentialSourceConfig> {
  const out: Record<CredentialRef, CredentialSourceConfig> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [ref, v] of Object.entries(input as Record<string, unknown>)) {
    if (!isCredentialRef(ref) || isLegacyCredentialRef(ref)) continue;
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const { command, file } = v as Record<string, unknown>;
    const entry = {
      command: typeof command === 'string' ? command.trim() : '',
      file: typeof file === 'string' ? file.trim() : '',
    };
    if (entry.command || entry.file) out[ref] = entry;
  }
  return out;
}

/** What the renderer may know about a reference: never a value, never output. */
export interface CredentialRefStatus {
  credentialRef: CredentialRef;
  legacy: boolean;
  command: string;
  file: string;
  blobPresent: boolean;
  /** The source resolution would use, or null when none is configured. */
  selected: CredentialSourceKind | null;
}
