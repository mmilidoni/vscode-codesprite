import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const config = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  minify: production,
  sourcemap: !production,
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(config);
  await ctx.watch();
  console.log('[esbuild] Watching for changes...');
} else {
  await esbuild.build(config);
}
