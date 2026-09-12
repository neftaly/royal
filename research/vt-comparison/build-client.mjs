import { build } from 'vite';
import glsl from 'vite-plugin-glsl';
import { cp, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { codecModulePlugin } from '../../scripts/codec-module-plugin.ts';
import { sourceAliases } from '../../vite.config.ts';

const baseline = process.env.VT_BASELINE === '1';
const output = `node_modules/.cache/royal-vt-build-${baseline ? 'before' : 'after'}`;
const files = ['demand.ts', 'runtime.ts', 'shader-source.ts'].map(name => `packages/renderer-webgl/src/virtual-texture/${name}`);
const sources = new Map(baseline ? files.map(file => [file, execFileSync('git', ['show', `v0.0.28:${file}`], { encoding: 'utf8' })]) : []);
await build({ configFile: false, publicDir: false, logLevel: 'warn',
  plugins: [{ name: 'royal-vt-release-baseline', enforce: 'pre', load(id) {
    for (const [file, source] of sources) if (id.endsWith('/' + file)) return source;
  } }, codecModulePlugin(), glsl({ include: ['**/*.frag', '**/*.vert'], minify: true })],
  resolve: { alias: sourceAliases },
  worker: { format: 'es', plugins: () => [codecModulePlugin(true)] },
  build: { outDir: output, emptyOutDir: true, sourcemap: false,
    rollupOptions: { input: baseline ? ['research/vt-comparison/scenes.html']
      : ['research/vt-comparison/scenes.html', 'research/vt-comparison/index.html', 'research/vt-comparison/source-combinations.html'] } },
});
await mkdir(`${output}/research/vt-comparison`, { recursive: true });
await cp('research/vt-comparison/generated', `${output}/research/vt-comparison/generated`, { recursive: true });
console.log(output);
