import { createInterface } from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Pairing input goes directly into argv, never into a shell command string.
const root = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../dist/server/cli.js', import.meta.url));
const mode = process.argv[2];
if (!['pair', 'start'].includes(mode)) {
  console.error('Usage: node scripts/windows-connector.mjs pair|start');
  process.exit(1);
}
if (!existsSync(new URL('../node_modules/better-sqlite3', import.meta.url)) || !existsSync(cli)) {
  console.error('Run Setup.cmd first. Keep the extracted package together.');
  process.exit(1);
}
const args = [cli, '--connector'];
if (mode === 'pair') {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('Get a fresh pairing code from Computers on your Mac hub website.');
    const hub = new URL((await input.question('Mac hub HTTPS address: ')).trim());
    if (hub.protocol !== 'https:' || hub.username || hub.password || hub.search || hub.hash || hub.pathname !== '/')
      throw new Error('Use only the HTTPS hub origin, for example https://mac.example.ts.net');
    const pair = (await input.question('One-time pairing code: ')).trim();
    if (!pair) throw new Error('A pairing code is required.');
    args.push('--hub', hub.origin, '--pair', pair);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally { input.close(); }
  if (process.exitCode) process.exit(process.exitCode);
}
console.log('Starting Windows connector. Keep this window open; Ctrl+C stops it.');
const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', shell: false });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
