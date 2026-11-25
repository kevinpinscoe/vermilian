import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RUNWAY_MARKDOWN_MAX_BYTES } from '../../shared/runwayImport';
import { readRunwayMarkdownFile } from './runwayMarkdownFile';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runway-md-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function file(name: string, content: string | Buffer): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

describe('readRunwayMarkdownFile', () => {
  it('returns the file name and its UTF-8 text', async () => {
    const p = file('plan.md', '## Ship the offline reader\n\n- [ ] READ-12 Café\n');
    expect(await readRunwayMarkdownFile(p)).toEqual({ ok: true, canceled: false, fileName: 'plan.md', text: '## Ship the offline reader\n\n- [ ] READ-12 Café\n' });
  });

  it('accepts exactly 1 MiB', async () => {
    const p = file('max.md', Buffer.alloc(RUNWAY_MARKDOWN_MAX_BYTES, 'a'));
    const r = await readRunwayMarkdownFile(p);
    expect(r.ok).toBe(true);
    expect(r.ok && r.text.length).toBe(RUNWAY_MARKDOWN_MAX_BYTES);
  });

  it('refuses one byte more than 1 MiB', async () => {
    const p = file('big.md', Buffer.alloc(RUNWAY_MARKDOWN_MAX_BYTES + 1, 'a'));
    expect(await readRunwayMarkdownFile(p)).toEqual({ ok: false, code: 'too-large', error: 'big.md is larger than 1 MiB, the most a schedule file can be.' });
  });

  it('counts bytes, not characters: 1 MiB of text that is more bytes than that is refused', async () => {
    const p = file('wide.md', 'é'.repeat(RUNWAY_MARKDOWN_MAX_BYTES / 2 + 1)); // 2 bytes each
    expect(await readRunwayMarkdownFile(p)).toMatchObject({ ok: false, code: 'too-large' });
  });

  it('applies a smaller limit to the bytes actually read', async () => {
    const p = file('small.md', 'abcdef');
    expect(await readRunwayMarkdownFile(p, 6)).toMatchObject({ ok: true, text: 'abcdef' });
    expect(await readRunwayMarkdownFile(p, 5)).toMatchObject({ ok: false, code: 'too-large', error: 'small.md is larger than 5 bytes, the most a schedule file can be.' });
  });

  it('refuses text that is not UTF-8', async () => {
    const p = file('latin1.md', Buffer.from([0x2d, 0x20, 0xe9, 0x0a]));
    expect(await readRunwayMarkdownFile(p)).toEqual({ ok: false, code: 'not-utf8', error: 'latin1.md is not UTF-8 text.' });
  });

  it('drops a leading byte order mark', async () => {
    const p = file('bom.md', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('- READ-1\n')]));
    expect(await readRunwayMarkdownFile(p)).toMatchObject({ ok: true, text: '- READ-1\n' });
  });

  it('accepts an empty file', async () => {
    expect(await readRunwayMarkdownFile(file('empty.md', ''))).toMatchObject({ ok: true, text: '' });
  });

  it('a missing file or a directory is a read failure', async () => {
    expect(await readRunwayMarkdownFile(path.join(dir, 'gone.md'))).toMatchObject({ ok: false, code: 'read-failed' });
    expect(await readRunwayMarkdownFile(dir)).toMatchObject({ ok: false, code: 'read-failed' });
  });

  it('leaves the file unchanged', async () => {
    const p = file('plan.md', '- READ-1\n');
    const before = fs.statSync(p).mtimeMs;
    await readRunwayMarkdownFile(p);
    expect(fs.readFileSync(p, 'utf8')).toBe('- READ-1\n');
    expect(fs.statSync(p).mtimeMs).toBe(before);
  });
});
