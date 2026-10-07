import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Optional native smoke check; opens and closes only an isolated app instance.
const executable =
  process.argv[2] ||
  path.resolve(`release/mac-${process.arch}/Session Shelf.app/Contents/MacOS/Session Shelf`);
const directory = await mkdtemp(path.join(os.tmpdir(), 'shelf-desktop-smoke-'));
const child = spawn(executable, ['--remote-debugging-port=9240'], {
  env: {
    ...process.env,
    SHELF_DATA_DIR: directory,
    CODEX_HOME: path.join(directory, 'codex'),
    CLAUDE_CONFIG_DIR: path.join(directory, 'claude'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let exited = false,
  stderr = '';
child.stdout.resume();
child.stderr.on('data', (data) => {
  stderr = (stderr + data).slice(-4000);
});
const exit = new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('exit', (code, signal) => {
    exited = true;
    resolve({ code, signal });
  });
});
try {
  const deadline = Date.now() + 15000;
  let ready = false;
  while (Date.now() < deadline && !exited) {
    try {
      const response = await fetch('http://127.0.0.1:9240/json/list', {
        signal: AbortSignal.timeout(1000),
      });
      const pages = await response.json();
      ready = pages.some(
        (page) => page.type === 'page' && page.url.startsWith('http://127.0.0.1:'),
      );
      if (ready) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (!ready) throw new Error(`Desktop window did not become ready. ${stderr}`);
  console.log('Packaged desktop window opened successfully.');
  child.kill('SIGTERM');
  let timer;
  const result = await Promise.race([
    exit,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Desktop did not shut down within 8 seconds.')),
        8000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
  if (result.code !== 0) throw new Error(`Unexpected exit: ${JSON.stringify(result)}`);
  console.log('Packaged desktop shut down cleanly.');
} finally {
  if (!exited) {
    child.kill('SIGKILL');
    await exit.catch(() => {});
  }
  await rm(directory, { recursive: true, force: true });
}
