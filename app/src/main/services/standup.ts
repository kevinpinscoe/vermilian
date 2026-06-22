import fs from 'fs/promises';
import path from 'path';

export async function saveToFile(
  markdown: string,
  folder: string,
  dateStr: string,
  timeStr: string,
): Promise<void> {
  const filePath = path.join(folder, `standup-${dateStr}.md`);
  try {
    await fs.access(filePath);
    // File exists — append with divider and timestamped heading
    const append = `\n\n---\n\n## Stand-up (${timeStr})\n\n${markdown}`;
    await fs.appendFile(filePath, append, 'utf8');
  } catch {
    // File does not exist — create it
    await fs.writeFile(filePath, markdown, 'utf8');
  }
}
