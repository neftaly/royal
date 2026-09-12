// node --expose-gc research/native-texture-formats/retention-benchmark.mjs
import { build } from 'vite';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
const baseline = process.argv.includes('--baseline');
const outDir = resolve('node_modules/.cache/royal-retention-review');
await build({ configFile: false, logLevel: 'error',
  plugins: baseline ? [{ name: 'review-baseline', enforce: 'pre', load(id) {
    if (id === resolve('packages/renderer-webgl/src/texture/browser-decode.ts')) {
      return readFileSync(process.argv[process.argv.indexOf('--baseline') + 1], 'utf8');
    }
  } }] : [], build: {
  outDir, emptyOutDir: true,
  lib: { entry: resolve('research/native-texture-formats/retention-workload.ts'), formats: ['es'], fileName: () => 'workload.mjs' },
}});
const { decodeRetentionFixture } = await import(`${outDir}/workload.mjs`);
if (!global.gc) throw new Error('Run with --expose-gc');
let original;
const read = Blob.prototype.arrayBuffer;
Blob.prototype.arrayBuffer = async function () {
  const buffer = await read.call(this);
  original = new WeakRef(buffer);
  return buffer;
};
const collect = async () => {
  for (let i = 0; i < 8; i++) {
    await new Promise(resolve => setImmediate(resolve));
    global.gc();
  }
};
const results = [];
try {
  for (const vk of [166, 172]) for (const fitted of [false, true]) {
    const source = await decodeRetentionFixture(vk, fitted ? 65536 : undefined);
    if (source.kind === undefined) throw new Error('Expected native source');
    const retainedBytes = source.levels.reduce((sum, level) => sum + level.blocks.byteLength, 0);
    await collect();
    const originalRetained = original.deref() !== undefined;
    if (!baseline && originalRetained === fitted) throw new Error(`Unexpected live source allocation: ${vk}, fitted=${fitted}`);
    source.close();
    await collect();
    const originalRetainedAfterClose = original.deref() !== undefined;
    if (!baseline && originalRetainedAfterClose) throw new Error('Closed source still pins original buffer');
    results.push({ vk, fitted, retainedBytes, originalRetained, originalRetainedAfterClose });
  }
} finally { Blob.prototype.arrayBuffer = read; }
const report = { node: process.version, baseline: baseline ? '99d59425' : null, results,
  note: '4096px authored mip chains; fitted budget 64KiB. Explicit GC and WeakRef test original Blob arrayBuffer lifetime while decoded source remains reachable. This is a retention oracle, not a timing benchmark.' };
writeFileSync(`research/native-texture-formats/retention-${baseline ? 'baseline' : 'results'}.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
