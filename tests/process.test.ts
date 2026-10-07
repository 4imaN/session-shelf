import { afterEach, expect, it } from 'vitest';
import { readFile, rm, writeFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './fixtures';
import {
  summarize,
  Terminals,
  resolveExecutable,
  launchDesktop,
  terminalShellCommand,
  tmuxArgs,
  ghosttyScript,
  detectTerminals,
} from '../src/server/processes';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SettingsSchema, type Settings } from '../src/shared/types';
const cleanup: (() => Promise<void>)[] = [];
it('detects supported terminals without changing the saved choice', async () => {
  const f = await setup();
  await f.engine.handle({
    op: 'saveSettings',
    settings: { ...f.engine.settings, desktopTerminal: 'muxy' },
  });
  const options = await f.engine.handle({ op: 'detectTerminals' });
  expect(options.map((t: { id: string }) => t.id)).toEqual([
    'system',
    'ghostty',
    'cmux',
    'muxy',
    'custom',
  ]);
  expect(f.store.get<Settings>('settings')?.desktopTerminal).toBe('muxy');
  expect((await f.engine.handle({ op: 'settings' })).desktopTerminal).toBe('muxy');
  const unavailable = (await detectTerminals()).find((t) => !t.available);
  if (unavailable)
    await expect(
      launchDesktop(f.engine.list()[0], { ...f.engine.settings, desktopTerminal: unavailable.id }),
    ).rejects.toThrow('Choose an installed terminal');
});
it('keeps existing settings on the system terminal by default', () => {
  const settings = SettingsSchema.parse({
    codexRoot: '/codex',
    claudeRoot: '/claude',
    deviceName: 'test',
  });
  expect(settings.desktopTerminal).toBe('system');
  expect(settings.useTmux).toBe(false);
});
it.skipIf(process.platform === 'win32')(
  'shell command preserves spaces, quotes and metacharacters literally',
  async () => {
    const args = ['a b', "it\'s", '$(echo unsafe)', '`echo unsafe`', 'line\nbreak'];
    const command = terminalShellCommand(process.execPath, [
      '-e',
      'console.log(JSON.stringify(process.argv.slice(1)))',
      ...args,
    ]);
    const result = await promisify(execFile)('/bin/sh', ['-c', command]);
    expect(JSON.parse(result.stdout)).toEqual(args);
  },
);
it('tmux keeps the same saved session and cwd; Ghostty creates a fresh configured window', async () => {
  const f = await setup();
  const session = f.engine.list()[0];
  const args = tmuxArgs(session, '/path with space/cli', ['--resume', session.id]);
  expect(args).toEqual([
    'new-session',
    '-A',
    '-s',
    `shelf-${session.provider}-${session.id}`,
    '-c',
    session.cwd,
    '/path with space/cli',
    '--resume',
    session.id,
  ]);
  const script = ghosttyScript('/project "quoted"', '/path/cli', ['--resume', session.id]);
  expect(script).toContain('new window with configuration cfg');
  expect(script).toContain('set initial working directory of cfg to "/project \\"quoted\\""');
  expect(script).toContain(session.id);
});
it('custom terminal receives cwd and separate resume arguments in a real subprocess', async () => {
  const f = await setup();
  const launcher = path.join(f.dir, 'terminal launcher.mjs');
  const output = path.join(f.cwd, 'launch.json');
  await writeFile(
    launcher,
    `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(output)},JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}));`,
  );
  const cli = path.join(f.dir, 'fake cli.mjs');
  await writeFile(cli, '');
  const session = f.engine.list().find((s) => s.provider === 'claude')!;
  await launchDesktop(session, {
    ...f.engine.settings,
    desktopTerminal: 'custom',
    terminalExecutable: launcher,
    terminalFlag: '--',
    claudeExecutable: cli,
  });
  await expect
    .poll(async () => {
      try {
        return JSON.parse(await readFile(output, 'utf8'));
      } catch {
        return null;
      }
    })
    .toEqual({
      cwd: await realpath(f.cwd),
      args: ['--', process.execPath, await realpath(cli), '--resume', session.id],
    });
});
it.skipIf(process.platform === 'win32')(
  'skips non-executable launchers earlier in PATH',
  async () => {
    const f = await setup();
    const bad = path.join(f.dir, 'bad'),
      good = path.join(f.dir, 'good');
    await mkdir(bad);
    await mkdir(good);
    const name = 'shelf-regression-cli';
    await writeFile(path.join(bad, name), 'not an executable', { mode: 0o644 });
    await writeFile(path.join(good, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const original = process.env.PATH;
    try {
      process.env.PATH = [bad, good].join(path.delimiter);
      expect((await resolveExecutable(name)).file).toBe(path.join(good, name));
    } finally {
      process.env.PATH = original;
    }
    await expect(resolveExecutable(path.join(bad, name))).rejects.toThrow('executable');
  },
);
it('runs a readable JavaScript launcher through Node even without an executable bit', async () => {
  const f = await setup();
  const script = path.join(f.dir, 'cli.mjs');
  await writeFile(script, 'console.log("ready")', { mode: 0o644 });
  const resolved = await resolveExecutable(script);
  expect(resolved.file).toBe(process.execPath);
  expect(resolved.prefix).toEqual([await realpath(script)]);
});
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});
async function setup() {
  const f = await fixture();
  cleanup.push(async () => {
    f.engine.close();
    f.store.close();
    await rm(f.dir, { recursive: true, force: true });
  });
  return f;
}
it('runs a real summary subprocess with bounded input and does not change session files', async () => {
  const f = await setup(),
    script = path.join(f.dir, 'summary.mjs'),
    before = await readFile(f.file, 'utf8');
  await writeFile(
    script,
    `let text=''; process.stdin.setEncoding('utf8'); process.stdin.on('data',d=>text+=d); process.stdin.on('end',()=>{const args=process.argv.slice(2);if(!args.includes('--ephemeral')||!args.includes('read-only')||!text.includes('<conversation>'))process.exit(2);console.log('Task: Command palette.\\nProgress: Keyboard navigation added.\\nWhere to resume: Accessibility checks.');});`,
  );
  const session = f.engine.list().find((s) => s.provider === 'codex')!;
  const recap = await summarize(session, await f.engine.transcript(session.key), 'codex', {
    ...f.engine.settings,
    codexExecutable: script,
  });
  expect(recap.hash).toBe(session.hash);
  expect(recap.text).toContain('Accessibility checks');
  expect(await readFile(f.file, 'utf8')).toBe(before);
  expect(f.engine.list()).toHaveLength(2);
});
it('reports CLI errors instead of falling back to unrestricted summary execution', async () => {
  const f = await setup(),
    script = path.join(f.dir, 'failure.mjs');
  await writeFile(script, "console.error('Login required');process.exit(1);");
  const session = f.engine.list()[0];
  await expect(
    summarize(session, [], 'claude', { ...f.engine.settings, claudeExecutable: script }),
  ).rejects.toThrow('Login required');
});
it('resumes the exact ID in a real pseudo-terminal and reuses its live process', async () => {
  const f = await setup(),
    script = path.join(f.dir, 'terminal.mjs');
  await writeFile(
    script,
    `console.log('RESUMED:'+JSON.stringify(process.argv.slice(2)));console.log('PROJECT:'+process.cwd());process.stdin.setEncoding('utf8');process.stdin.on('data',d=>{if(d.includes('hello'))console.log('RECEIVED_HELLO');});`,
  );
  const terminals = new Terminals();
  cleanup.unshift(async () => terminals.close());
  const session = f.engine.list().find((s) => s.provider === 'codex')!;
  const settings = { ...f.engine.settings, codexExecutable: script };
  const id = await terminals.start(session, settings);
  await expect
    .poll(() => terminals.attach(id).buffer)
    .toContain(`RESUMED:["resume","${session.id}"]`);
  await expect.poll(() => terminals.attach(id).buffer).toContain(f.cwd);
  expect(await terminals.start(session, settings)).toBe(id);
  terminals.resize(id, 120, 40);
  terminals.input(id, 'hello\r');
  await expect.poll(() => terminals.attach(id).buffer).toContain('RECEIVED_HELLO');
  terminals.stop(id);
  await expect.poll(() => terminals.attach(id).exited).toBe(true);
});
