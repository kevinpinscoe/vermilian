import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';

export interface TimerCheckpointData {
  issueId: string;
  issueReadableId: string;
  summary: string;
  worklogType: string;
  checkpointWorkMs: number; // total work ms at time of checkpoint
  startedAt: number;
}

function filePath(): string {
  return path.join(app.getPath('userData'), 'timer-state.json');
}

export async function writeCheckpoint(data: TimerCheckpointData): Promise<void> {
  const p = filePath();
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data), 'utf8');
  await fs.rename(tmp, p);
}

export async function readCheckpoint(): Promise<TimerCheckpointData | null> {
  try {
    const raw = await fs.readFile(filePath(), 'utf8');
    return JSON.parse(raw) as TimerCheckpointData;
  } catch {
    return null;
  }
}

export async function clearCheckpoint(): Promise<void> {
  try {
    await fs.unlink(filePath());
  } catch {
    // already gone
  }
}
