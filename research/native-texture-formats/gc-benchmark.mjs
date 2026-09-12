// node --expose-gc research/native-texture-formats/gc-benchmark.mjs
import { build } from 'vite';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PerformanceObserver, performance } from 'node:perf_hooks';
const outDir = resolve('node_modules/.cache/royal-native-gc');
await build({ configFile: false, logLevel: 'error', build: {
  outDir, emptyOutDir: true,
  lib: { entry: resolve('research/native-texture-formats/gc-workload.ts'), formats: ['es'], fileName: () => 'workload.mjs' },
}});
const { createWorkload } = await import(`${outDir}/workload.mjs`);
if (!global.gc) throw new Error('Run Node with --expose-gc');
const events = [];
const observer = new PerformanceObserver(list => events.push(...list.getEntries()));
observer.observe({ entryTypes: ['gc'] });
const results = [];
for (const mode of ['etc2', 'astc', 'astc-preview', 'unsupported', 'parse']) {
  const workload = createWorkload(mode);
  for (let i = 0; i < 100000; i++) workload.run();
  global.gc();
  await new Promise(resolve => setTimeout(resolve, 20));
  const before = process.memoryUsage();
  const iterations = mode === 'parse' ? 100000 : 1000000;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) workload.run();
  const end = performance.now();
  const after = process.memoryUsage();
  await new Promise(resolve => setTimeout(resolve, 20));
  const measured = events.filter(event => event.startTime >= start && event.startTime <= end);
  global.gc();
  const retained = process.memoryUsage();
  results.push({ mode, iterations, nsPerCall: (end-start)*1e6/iterations,
    heapGrowthBytes: after.heapUsed-before.heapUsed, retainedHeapDeltaBytes: retained.heapUsed-before.heapUsed,
    arrayBufferDeltaBytes: after.arrayBuffers-before.arrayBuffers,
    gcCount: measured.length, gcMs: measured.reduce((sum,event)=>sum+event.duration,0), ...workload.counters() });
  workload.close();
}
observer.disconnect();
const report = { node: process.version, results, note: 'After 100k warm-up calls. No-op driver isolates JS cost; GC and heap deltas are noisy, not proof of zero allocation. Parse allocates metadata/views, never a payload buffer.' };
writeFileSync(process.argv[2] ?? 'research/native-texture-formats/gc-results.json', JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
