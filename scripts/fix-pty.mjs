import { chmodSync, existsSync } from 'node:fs';
// npm's prebuilt macOS helper sometimes loses its executable bit.
if (process.platform !== 'win32')
  for (const arch of ['arm64', 'x64']) {
    const file = `node_modules/node-pty/prebuilds/${process.platform}-${arch}/spawn-helper`;
    if (existsSync(file)) chmodSync(file, 0o755);
  }
