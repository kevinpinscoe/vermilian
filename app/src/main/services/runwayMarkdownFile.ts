// Reading a chosen Markdown schedule file (VERM-102). Electron-free, so the
// limits run under vitest; main/ipc.ts shows the picker and calls this.
//
// Read-only. The file is opened for reading and closed; nothing is written.
// At most RUNWAY_MARKDOWN_MAX_BYTES (1 MiB) is accepted: one byte more is
// refused, whatever the file's reported size, because the read itself stops
// one byte past the limit. The text must be valid UTF-8; a leading byte
// order mark is dropped.

import fs from 'node:fs/promises';
import path from 'node:path';
import { RUNWAY_MARKDOWN_MAX_BYTES, type RunwayMarkdownOpenResult } from '../../shared/runwayImport';

const MIB = RUNWAY_MARKDOWN_MAX_BYTES / (1024 * 1024);

export async function readRunwayMarkdownFile(
  filePath: string,
  maxBytes = RUNWAY_MARKDOWN_MAX_BYTES,
): Promise<Exclude<RunwayMarkdownOpenResult, { canceled: true }>> {
  const fileName = path.basename(filePath);
  const tooLarge = (): RunwayMarkdownOpenResult & { ok: false } => ({
    ok: false,
    code: 'too-large',
    error: `${fileName} is larger than ${maxBytes === RUNWAY_MARKDOWN_MAX_BYTES ? `${MIB} MiB` : `${maxBytes} bytes`}, the most a schedule file can be.`,
  });
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(filePath, 'r');
    const stat = await handle.stat();
    if (!stat.isFile()) return { ok: false, code: 'read-failed', error: `${fileName} is not a file.` };
    if (stat.size > maxBytes) return tooLarge();
    // Read up to one byte past the limit, so a file that grew since stat is still caught.
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > maxBytes) return tooLarge();
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buffer.subarray(0, length));
    } catch {
      return { ok: false, code: 'not-utf8', error: `${fileName} is not UTF-8 text.` };
    }
    return { ok: true, canceled: false, fileName, text };
  } catch (err) {
    const message = (err as { message?: unknown } | null)?.message;
    return { ok: false, code: 'read-failed', error: `${fileName} could not be read${typeof message === 'string' ? `: ${message}` : ''}.` };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
