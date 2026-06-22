// Non-credential application configuration. Persisted to
// `userData/app-config.json`. This object MUST NEVER contain tokens or API keys
// (those live only in safeStorage blobs — see ADR-0004).

export type ThemeSetting = 'light' | 'dark' | 'system';

export interface PomodoroConfig {
  work: number; // minutes
  shortBreak: number;
  longBreak: number;
  longBreakEvery: number; // long break every Nth work block
}

export type StandupScope = 'all-workspace' | 'active-workspace' | 'custom';
export type StandupWindow = '24h' | '48h' | '7d' | 'custom';

export interface AppConfig {
  youtrackUrl: string;
  youtrackLogin: string; // YouTrack username (login), used to identify the current user

  // Credential sources — tried in priority order for YouTrack token and Claude key.
  // An empty string means "not configured; skip this source."
  //
  // Priority 1 — shell command: stdout (trimmed) is used as the credential.
  //   Examples: op read "op://Personal/YouTrack/token"   (1Password CLI)
  //             bao kv get -field=token secret/youtrack  (OpenBao)
  //             pass show youtrack/token                 (pass)
  //
  // Priority 2 — file path: file content (trimmed) is used as the credential.
  //   Example:  /run/secrets/youtrack-token
  //             ~/.config/youtrack-token
  //
  // Priority 3 — safeStorage encrypted blob (existing fallback; may be unavailable
  //   on Linux without a keyring daemon).
  youtrackTokenCommand: string;
  youtrackTokenFile: string;
  claudeKeyCommand: string;
  claudeKeyFile: string;

  modelForCreate: string;
  modelForStandup: string;
  pomodoro: PomodoroConfig;
  soundOnBlockEnd: boolean;
  osNotifications: boolean;
  defaultWorklogType: string;
  dailyNotesFolder: string;
  theme: ThemeSetting;
  standupScope: StandupScope;
  standupWindow: StandupWindow;
}

// Defaults follow ADR-0006 (Claude model defaults) and task-timer.md / settings.md.
export const DEFAULT_CONFIG: AppConfig = {
  youtrackUrl: '',
  youtrackLogin: '',
  youtrackTokenCommand: '',
  youtrackTokenFile: '',
  claudeKeyCommand: '',
  claudeKeyFile: '',
  modelForCreate: 'claude-haiku-4-5-20251001',
  modelForStandup: 'claude-sonnet-4-6',
  pomodoro: { work: 25, shortBreak: 5, longBreak: 15, longBreakEvery: 4 },
  soundOnBlockEnd: true,
  osNotifications: true,
  defaultWorklogType: 'Development',
  dailyNotesFolder: '',
  theme: 'light',
  standupScope: 'all-workspace',
  standupWindow: '48h',
};
