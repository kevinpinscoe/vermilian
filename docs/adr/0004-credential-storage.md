# ADR-0004: Credential storage — Electron safeStorage

Date: 2026-05-27
Status: Accepted

## Context

Vermilian stores two credentials that must never appear in plaintext on disk or in any log output:

1. **YouTrack permanent API token** — used for every issue and project API call
2. **Anthropic API key** — used by the Electron main process for AI create and stand-up report features

A decision is needed before the Settings feature can be implemented, because the persistence call is on the Save-button path.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **Electron `safeStorage`** | Built into Electron — no native dependency, no `electron-rebuild` step. OS-backed encryption (macOS Keychain, Windows DPAPI, Linux libsecret/kwallet). Side-steps the pnpm/electron-forge native-module pain documented in `RUNBOOK.md`. | On Linux without libsecret/gnome-keyring, `safeStorage` silently falls back to **plaintext** encryption (a constant key embedded in Electron). Must explicitly check `safeStorage.getSelectedStorageBackend()` and refuse to save if it returns `basic_text`. |
| **`keytar`** | Stores actual key/value pairs in the OS keychain (visible in Keychain Access / `secret-tool`). True per-entry storage. | Native Node module — requires `@electron/rebuild` on install. **Archived by Atlassian in 2023** — no further maintenance. Several Electron projects are migrating off it. Compounds the existing fragile pnpm/electron-forge native-build story. |
| **`safeStorage` + encrypted-file fallback** | Usable on stripped-down Linux without libsecret (user enters a passphrase at app start). | Substantial extra UX surface (passphrase prompt, recovery flow). MVP cost not justified by current user requirements. |

## Decision

Use **Electron `safeStorage`** with a **fail-closed Linux check**.

- Tokens are encrypted via `safeStorage.encryptString()` and stored as binary blobs in `app.getPath('userData')/credentials/`. Keys: `youtrack.token.bin`, `claude.key.bin`.
- Before any encrypt/save, the main process calls `safeStorage.getSelectedStorageBackend()`. If the result is `basic_text` (or, on Linux, anything other than a real backend like `gnome_libsecret` / `kwallet5` / `kwallet6`), **the Save call rejects with a user-visible error** rather than silently using the plaintext fallback. The Settings spec surfaces this as a Vibe `Banner` (danger): *"Vermilian cannot securely store credentials — install gnome-keyring or kwallet, or run Vermilian on a session with a keyring available."*
- The encryption + decryption calls live in the Electron **main process**. The renderer never sees plaintext tokens; it accesses YouTrack and Claude indirectly through IPC methods exposed by the preload script.
- The keychain backend is OS-determined and not configurable.

## Consequences

- No native module install pain on top of the already-fragile pnpm/electron-forge story (see `RUNBOOK.md`).
- A new Vermilian install on a Linux host without a keyring service will refuse to save credentials. Document this prominently in the README and in the Settings spec.
- If, in the future, a multi-machine sync of *credentials* is needed, `safeStorage` blobs are tied to the local OS user and will not transfer — that would require revisiting this ADR.
- The keys `vermilian.youtrack.token` and `vermilian.claude.key` referenced in `spec/features/settings.md` are replaced by the filenames above. The spec is updated accordingly.
- The open question "OS keychain mechanism" in `docs/requirements.md` is resolved — remove from the open questions list.
