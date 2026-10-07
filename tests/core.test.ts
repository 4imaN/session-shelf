import { afterEach, describe, expect, it } from 'vitest';
import { appendFile, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture, codexLines, id } from './fixtures';
import { parseSession } from '../src/server/parser';
import { powershellCommand, resumeArgs, shellQuote, summaryExcerpt } from '../src/server/processes';
import { validateHubUrl } from '../src/server/connector';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});
async function setup() {
  const f = await fixture();
  cleanups.push(async () => {
    f.engine.close();
    f.store.close();
    await rm(f.dir, { recursive: true, force: true });
  });
  return f;
}
describe('session indexing', () => {
  it('parses both providers, deduplicates Codex events, and keeps source logs untouched', async () => {
    const f = await setup(),
      before = await readFile(f.file, 'utf8');
    const sessions = f.engine.list();
    expect(sessions).toHaveLength(2);
    const s = sessions.find((s) => s.provider === 'codex')!;
    expect(s.messageCount).toBe(2);
    expect(s.id).toBe(id);
    expect(s.cwd).toBe(f.cwd);
    expect(sessions.find((s) => s.provider === 'claude')?.title).toBe(
      'Refining the first-run experience',
    );
    await f.engine.scan();
    expect(await readFile(f.file, 'utf8')).toBe(before);
  });
  it('tolerates malformed records and a partial trailing line, then indexes completed activity', async () => {
    const f = await setup();
    await appendFile(f.file, 'null\n{broken\n{"type":');
    await f.engine.scan();
    expect(f.engine.list().find((s) => s.provider === 'codex')?.messageCount).toBe(2);
    await writeFile(
      f.file,
      codexLines(f.cwd)
        .map((r) => JSON.stringify(r))
        .join('\n') +
        '\n' +
        JSON.stringify({
          type: 'response_item',
          payload: { type: 'message', role: 'user', content: 'Please check accessibility next.' },
        }),
    );
    await f.engine.scan();
    expect(f.engine.list().find((s) => s.provider === 'codex')?.messageCount).toBe(3);
  });
  it('excludes subordinate sessions and invalid metadata', async () => {
    const f = await setup(),
      file = path.join(f.codex, 'child.jsonl'),
      rows = codexLines(f.cwd, '33333333-3333-4333-8333-333333333333');
    (rows[0].payload as any).source = { subagent: {} };
    await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n'));
    expect(await parseSession(file, 'codex', 'device')).toBeNull();
    await writeFile(
      file,
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: 'missing metadata' },
      }),
    );
    expect(await parseSession(file, 'codex', 'device')).toBeNull();
  });
  it('marks missing files unavailable and restores them when they return', async () => {
    const f = await setup(),
      contents = await readFile(f.file);
    await rm(f.file);
    await f.engine.scan();
    expect(f.engine.list().find((s) => s.provider === 'codex')?.available).toBe(false);
    await writeFile(f.file, contents);
    await f.engine.scan();
    expect(f.engine.list().find((s) => s.provider === 'codex')?.available).toBe(true);
  });
  it('keeps a recap but makes its content hash stale on new activity', async () => {
    const f = await setup(),
      s = f.engine.list().find((s) => s.provider === 'codex')!;
    f.store.put({
      ...s,
      recap: {
        text: 'Task: Palette',
        provider: 'codex',
        hash: s.hash,
        partial: false,
        createdAt: new Date().toISOString(),
      },
    });
    await appendFile(
      f.file,
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: 'Another request' },
      }) + '\n',
    );
    await f.engine.scan();
    const updated = f.engine.list().find((x) => x.key === s.key)!;
    expect(updated.recap?.hash).not.toBe(updated.hash);
  });
  it('requires provider selection and validates source paths', async () => {
    const f = await setup();
    await expect(f.engine.recap(f.engine.list()[0].key)).rejects.toThrow('Choose a recap provider');
    await expect(
      f.engine.handle({
        op: 'saveSettings',
        settings: { ...f.engine.settings, codexRoot: 'relative' },
      }),
    ).rejects.toThrow('absolute');
  });
});
describe('launch boundaries', () => {
  it('resumes an explicit original ID and rejects injected IDs', () => {
    expect(resumeArgs({ provider: 'codex', id })).toEqual(['resume', id]);
    expect(resumeArgs({ provider: 'claude', id })).toEqual(['--resume', id]);
    expect(() => resumeArgs({ provider: 'codex', id: '; touch /tmp/no' })).toThrow();
  });
  it('quotes shell and PowerShell metacharacters literally', () => {
    expect(shellQuote("a'b $(whoami) `x`")).toBe("'a'\\''b $(whoami) `x`'");
    expect(powershellCommand("C:\\a'b; $x", 'codex', ['resume', id])).toContain(
      "Set-Location -LiteralPath 'C:\\a''b; $x'",
    );
  });
  it('bounds recap input while preserving start and finish', () => {
    const r = summaryExcerpt([{ role: 'user', text: 'first ' + '.'.repeat(60000) + ' last' }]);
    expect(r.partial).toBe(true);
    expect(r.text.length).toBeLessThan(49000);
    expect(r.text).toContain('first');
    expect(r.text).toContain('last');
  });
  it('requires HTTPS for remote pairing', () => {
    expect(validateHubUrl('http://127.0.0.1:4317')).toBe('http://127.0.0.1:4317');
    expect(() => validateHubUrl('http://remote.example')).toThrow('HTTPS');
    expect(() => validateHubUrl('https://user:pass@example.com')).toThrow();
  });
});
