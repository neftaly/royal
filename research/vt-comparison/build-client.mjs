import { build } from 'vite';
import glsl from 'vite-plugin-glsl';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { codecModulePlugin } from '../../scripts/codec-module-plugin.ts';
import { sourceAliases } from '../../vite.config.ts';

const baseline = process.env.VT_BASELINE === '1';
const output = `node_modules/.cache/royal-vt-build-${baseline ? 'before' : 'after'}`;
const revision = process.env.VT_BASELINE_REVISION ?? 'v0.0.28';
const baselineFile = baseline ? process.env.VT_BASELINE_FILE : undefined;
const files = baseline && !baselineFile ? execFileSync('git', ['diff', '--name-only', revision, '--', 'packages/renderer-webgl/src'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean) : [];
const sources = new Map(baselineFile ? [[process.env.VT_BASELINE_MODULE ?? 'packages/renderer-webgl/src/virtual-texture/demand.ts', await readFile(baselineFile, 'utf8')]]
  : files.map(file => [file, execFileSync('git', ['show', `${revision}:${file}`], { encoding: 'utf8' })]));
await build({ configFile: false, publicDir: false, logLevel: 'warn',
  plugins: [{ name: 'royal-vt-release-baseline', enforce: 'pre', load(id) {
    for (const [file, source] of sources) if (id.endsWith('/' + file)) return source;
  } }, codecModulePlugin(), glsl({ include: ['**/*.frag', '**/*.vert'], minify: true })],
  resolve: { alias: sourceAliases },
  worker: { format: 'es', plugins: () => [codecModulePlugin(true)] },
  build: { outDir: output, emptyOutDir: true, sourcemap: process.env.VT_SOURCEMAP === '1',
    rollupOptions: { input: ['research/vt-comparison/ordinary-vt-budget.html', 'research/vt-comparison/failed-parent-sampling.html', 'research/vt-comparison/cancelled-preparation-queue.html', 'research/vt-comparison/image-page-cancellation.html', 'research/vt-comparison/scenes.html', 'research/vt-comparison/index.html', 'research/vt-comparison/source-combinations.html', 'research/vt-comparison/steady.html', 'research/vt-comparison/lifecycle.html', 'research/vt-comparison/native-page-read.html', 'research/vt-comparison/native-page-retention.html', 'research/vt-comparison/native-copy.html', 'research/vt-comparison/resident-limit-slots.html', 'research/vt-comparison/resident-limit-gpu.html', 'research/vt-comparison/resident-eviction.html', 'research/vt-comparison/native-identity-gpu.html'] } },
});
await mkdir(`${output}/research/vt-comparison`, { recursive: true });
await cp('research/vt-comparison/generated', `${output}/research/vt-comparison/generated`, { recursive: true });
await cp('research/vt-comparison/fixtures', `${output}/research/vt-comparison/fixtures`, { recursive: true });
console.log(output);
