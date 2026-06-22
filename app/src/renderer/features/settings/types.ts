import type { PomodoroConfig } from '../../../shared/config';

// Local, editable copy of settings while the Settings view is open.
// Token/key fields hold '' when unchanged (the real values live in safeStorage).
export interface SettingsDraft {
  youtrackUrl: string;
  youtrackLogin: string;
  youtrackToken: string;       // direct-paste path → saved to safeStorage on Save
  youtrackTokenCommand: string; // shell command path (priority 1)
  youtrackTokenFile: string;   // file path (priority 2)
  claudeKey: string;           // direct-paste path → saved to safeStorage on Save
  claudeKeyCommand: string;    // shell command path (priority 1)
  claudeKeyFile: string;       // file path (priority 2)
  modelForCreate: string;
  modelForStandup: string;
  pomodoro: PomodoroConfig;
  soundOnBlockEnd: boolean;
  osNotifications: boolean;
  defaultWorklogType: string;
  dailyNotesFolder: string;
}

export type UpdateDraft = (patch: Partial<SettingsDraft>) => void;

export type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };
