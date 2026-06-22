// Local cache of the workspace configuration in userData/workspace-config.json.
// This is the offline-safe fallback; the source of truth that syncs across
// machines is the _vermilian-config YouTrack Article (see services/articleConfig.ts).
// On startup the article is loaded and mirrored back into this file.

import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { VermilianConfig } from '../../shared/workspace';

function filePath(): string {
  return path.join(app.getPath('userData'), 'workspace-config.json');
}

export async function readWorkspaceConfig(): Promise<VermilianConfig | null> {
  try {
    const raw = await fs.readFile(filePath(), 'utf-8');
    return JSON.parse(raw) as VermilianConfig;
  } catch {
    return null;
  }
}

export async function writeWorkspaceConfig(config: VermilianConfig): Promise<void> {
  await fs.writeFile(filePath(), JSON.stringify(config, null, 2), 'utf-8');
}
