import { mkdtemp, mkdir, copyFile, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Allowlist only built code and install inputs: no credentials, data, or Mac native modules.
const stage = await mkdtemp(path.join(os.tmpdir(), 'shelf-windows-package-'));
const folder = path.join(stage, 'Session-Shelf-Windows');
await mkdir(path.join(folder, 'scripts'), { recursive: true });
await cp('dist/server', path.join(folder, 'dist/server'), { recursive: true });
await cp('dist/ui', path.join(folder, 'dist/ui'), { recursive: true });
for (const file of ['package.json', 'package-lock.json', 'WINDOWS-SETUP.md', 'README.md'])
  await copyFile(file, path.join(folder, file));
for (const file of ['fix-pty.mjs', 'windows-connector.mjs'])
  await copyFile(path.join('scripts', file), path.join(folder, 'scripts', file));
for (const file of ['Setup.cmd', 'Pair-Windows.cmd', 'Start-Connector.cmd'])
  await copyFile(path.join('scripts/windows', file), path.join(folder, file));
await mkdir('release', { recursive: true });
const output = path.resolve('release/Session-Shelf-Windows-Connector.zip');
const result = spawnSync('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--keepParent', folder, output], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error('Could not create connector ZIP');
console.log(`Windows connector package: ${output}`);
