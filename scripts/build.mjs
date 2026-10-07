import { build } from 'esbuild';
await build({
  entryPoints: { 'server/cli': 'src/server/cli.ts', 'electron/main': 'src/electron/main.ts' },
  outdir: 'dist',
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
});
await build({
  entryPoints: ['src/electron/preload.ts'],
  outfile: 'dist/electron/preload.cjs',
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'cjs',
  target: 'node22',
});
