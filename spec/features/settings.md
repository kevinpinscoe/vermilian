# Feature: Settings

## Description

The Settings view is where the user configures Vermilian's connection to YouTrack and the Claude API, the Pomodoro/timer behaviour, the daily-notes folder for stand-up reports, the theme, and a handful of other preferences. It is the first view shown on a fresh install (before any credentials are stored). Credentials are encrypted via **Electron `safeStorage`** (see [ADR-0004](../../docs/adr/0004-credential-storage.md)) and stored as binary blobs in `app.getPath('userData')/credentials/`. Non-credential preferences are stored in an `app-config.json` file in the same `userData` directory. The Settings view is also where the user controls the app's appearance (theme).

## Acceptance criteria

### Access and first-run behaviour

- [ ] A **Settings** gear icon in the bottom of the left rail opens the Settings view.
- [ ] The keyboard shortcut **Cmd+,** (macOS) / **Ctrl+,** (Linux, Windows) opens Settings from any view.
- [ ] On first launch, if no YouTrack URL or token is stored in the keychain, the Settings view opens automatically and the app does not attempt any YouTrack API calls until a valid connection is confirmed.
- [ ] After a valid connection is confirmed for the first time, the app navigates to the task list and Settings can subsequently be opened via the gear icon.

### Layout

- [ ] Settings is a full-content-area view (replaces the project board, not a modal) with these sections in order: **Connection**, **AI**, **Timer & Pomodoro**, **Daily notes**, **Appearance**, **Advanced**.
- [ ] Each section is a visually distinct card or panel within the view.
- [ ] A **Save** button and a **Cancel** button are in a sticky footer bar at the bottom of the view.

### Connection section (YouTrack)

- [ ] **YouTrack URL** — a text input for the base URL (e.g., `https://youtrack.example.com`). Trailing slashes are stripped before saving.
- [ ] **API Token** — a password input (masked by default) for the YouTrack permanent token. A show/hide toggle (eye icon) reveals the value.
- [x] **Test connection** button — when clicked, sends a `GET /api/users/me` request to the configured URL with the configured token. While in flight the button shows a loading state.
  - On success: a positive banner appears below the inputs: "Connected — logged in as \<displayName\>."
  - On failure (401/403): "Invalid token or insufficient permissions."
  - On failure (network / no status): "Could not reach YouTrack at \<url\>. Check the URL and your network." (404 → a URL-specific hint.) Implemented in `friendlyYouTrackError`.
- [ ] The API Token field shows a placeholder "••••••••" (not the actual token) after save. To change the token, the user clears the field and types a new value.

### AI section (Claude)

- [ ] **Claude API Key** — a password input (masked) for the Anthropic API key. Show/hide toggle present.
- [ ] **Model for task creation** — a text input pre-filled with `claude-haiku-4-5-20251001` (see [ADR-0006](../../docs/adr/0006-claude-model-selection.md)). Allows the user to enter any model ID string (not validated beyond non-empty).
- [ ] **Model for stand-up reports** — a text input pre-filled with `claude-sonnet-4-6` (ADR-0006).
- [ ] **Test connection** button — sends a minimal Claude API request (e.g., a 1-token completion) to verify the key. Success/failure shown in a `Banner` inline.
- [ ] If the Claude API Key is left blank and saved, AI features (AI create, stand-up) are disabled throughout the app (as documented in their respective specs).

### Timer & Pomodoro section

- [ ] **Work block duration** — numeric input, default `25` minutes, range 5–120.
- [ ] **Short break duration** — numeric input, default `5` minutes, range 1–60.
- [ ] **Long break duration** — numeric input, default `15` minutes, range 1–120.
- [ ] **Long break frequency** — numeric input, default `4` (long break every Nth work block), range 2–10.
- [ ] **Sound on block end** — toggle (default on). When on, plays a short soft sound at the end of each work block and break.
- [ ] **OS notifications** — toggle (default on). When on, fires a desktop notification at the end of each work block and break.
- [ ] **Default worklog type** — dropdown of YouTrack work-item types (fetched on first Settings open from `/api/admin/timeTrackingSettings/workItemTypes`); default `Development` if present, otherwise the first available type.
- [ ] Changes apply immediately to any **future** timer starts. A timer already running uses the durations it was started with.

### Daily notes section

- [ ] **Daily notes folder** — a path input with a **Browse…** button that opens the OS native folder picker (Electron `dialog.showOpenDialog`). Empty by default.
- [ ] If empty, the **Save to daily notes** button in the stand-up report is disabled (see `standup-report.md`).
- [ ] When set, the path is validated on Save: must be a folder that exists and is writable. Otherwise an inline error: *"Folder does not exist or is not writable."*

### Appearance section

- [ ] **Theme** — a segmented control or radio group with three options: **Light**, **Dark**, **System**. Changes apply immediately to the app without requiring Save.
- [ ] The selected theme is stored in Electron `userData` (not the keychain) and restored on next launch.

### Advanced section

- [ ] **Reset to defaults** button — opens a Vibe `AlertDialog`: *"Reset all non-credential settings to their defaults? Your YouTrack token and Claude API key will be kept."* with `Reset` and `Cancel` actions. On confirm, all non-credential settings revert to their factory defaults and `app-config.json` is rewritten. Workspace structure and per-board configuration (stored in the YouTrack Article) are **not** affected.
- [ ] **Open config folder** link — opens `app.getPath('userData')` in the OS file manager for users who need to inspect or back up state.

### Save and cancel

- [ ] **Save** writes all credential fields (YouTrack token, Claude API key) to `app.getPath('userData')/credentials/` using `safeStorage.encryptString()` (see [ADR-0004](../../docs/adr/0004-credential-storage.md)). Filenames: `youtrack.token.bin`, `claude.key.bin`.
- [ ] **Keyring fail-closed check (Linux)**: before encrypting, the main process calls `safeStorage.getSelectedStorageBackend()`. If the result is `basic_text` (or any non-OS-backed result), the Save operation **refuses to write credentials** and shows a Vibe `Banner` (danger) above the footer: *"Vermilian cannot securely store credentials on this system — install gnome-keyring or kwallet, or run Vermilian on a desktop session with a keyring available."* The user can still Save non-credential settings; credential fields are left in their previous state.
- [ ] Non-credential settings (YouTrack URL, model names, Pomodoro durations, daily-notes path, theme, scope/window preferences) are written to `app-config.json` in `app.getPath('userData')`. This file must never contain tokens or API keys.
- [ ] **Cancel** discards unsaved changes and navigates back to the previous view (task list if one was active).
- [x] If either credential field is non-empty and the user clicks Cancel without saving, a confirm `Modal` asks: "Discard unsaved changes?" with **Discard changes** and **Keep editing** options. (Vibe build has no `AlertDialog`, so a `Modal` is used.)
- [ ] After a successful save, a Vibe `Toast` (positive, 3 s): "Settings saved."

### Credential storage

- [ ] Credentials are encrypted with `safeStorage.encryptString()` and written only to `app.getPath('userData')/credentials/`. Plaintext tokens never touch any other path on disk.
- [ ] Credentials must never appear in any log output (`console.log`, Electron DevTools, etc.).
- [ ] All encryption / decryption happens in the Electron main process. The renderer never sees plaintext credentials — it makes YouTrack and Claude calls through IPC methods exposed by the preload script.
- [ ] On Linux, if `safeStorage.getSelectedStorageBackend()` returns a non-OS-backed value, credential saves are refused (see Save section above).

## Wireframe

See: `docs/design/screen-settings.d2`

## Open questions

<!-- Resolved questions (kept here for traceability):
- ADR-0004 (keychain mechanism): resolved — Electron safeStorage with Linux fail-closed.
- Reset to defaults: resolved — yes, non-credential settings only (Advanced section).
- Multiple YouTrack connections: resolved — no, single instance app-wide. Workspaces are the multi-context dimension.
-->

- [ ] Should the YouTrack URL be validated as `https://` only (refuse `http://`)? Recommend yes; confirm during implementation.
