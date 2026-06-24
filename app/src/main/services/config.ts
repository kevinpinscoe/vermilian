// Non-credential settings persisted to `userData/app-config.json`.
// Tokens/keys are never written here (they live in safeStorage — see credentials.ts).

import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AppConfig, DEFAULT_CONFIG } from '../../shared/config';
import { IS_E2E } from '../e2e';

function configPath(): string {
  return path.join(app.getPath('userData'), 'app-config.json');
}

function merge(partial: Partial<AppConfig>): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    pomodoro: { ...DEFAULT_CONFIG.pomodoro, ...(partial.pomodoro ?? {}) },
  };
}

export async function readConfig(): Promise<AppConfig> {
  let cfg: AppConfig;
  try {
    const raw = await fs.readFile(configPath(), 'utf8');
    cfg = merge(JSON.parse(raw) as Partial<AppConfig>);
  } catch {
    cfg = { ...DEFAULT_CONFIG };
  }
  // Under e2e, present as "connected" so AppShell renders without a real backend.
  // Set VERMILIAN_E2E_UNCONFIGURED=1 to skip this seed and test the first-run flow.
  if (IS_E2E && !cfg.youtrackUrl && !process.env.VERMILIAN_E2E_UNCONFIGURED) {
    cfg = { ...cfg, youtrackUrl: 'http://e2e.local' };
  }
  return cfg;
}

export async function writeConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const current = await readConfig();
  const next = merge({ ...current, ...patch });

  // Defensive: strip any token-like keys that should never be persisted here.
  const sanitized = next as unknown as Record<string, unknown>;
  delete sanitized.youtrackToken;
  delete sanitized.claudeKey;
  delete sanitized.apiKey;

  const file = configPath();
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
  await fs.rename(tmp, file);
  return next;
}
