import { build } from 'vite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { PerformanceObserver } from 'node:perf_hooks';

const directory = await mkdtemp(join(tmpdir(), 'royal-vt-demand-'));
try {
  await build({ configFile: false, logLevel: 'error', build: { ssr: 'research/vt-comparison/demand.ts', outDir: directory, minify: false } });
  const { runDemandBenchmark } = await import(pathToFileURL(join(directory, 'demand.js')));
  // Warm all fixtures/JIT before observing. The measured pass still includes
  // fixture construction: these are aggregate GC results, not per-bind claims.
  runDemandBenchmark(20);
  global.gc?.();
  const events = [];
  const observer = new PerformanceObserver(list => events.push(...list.getEntries().map(e => ({ kind: e.detail.kind, durationMs: e.duration }))));
  observer.observe({ entryTypes: ['gc'] });
  const before = process.memoryUsage();
  const report = runDemandBenchmark(120);
  const after = process.memoryUsage();
  await new Promise(resolve => setTimeout(resolve, 100));
  observer.disconnect();
  const result = { node: process.version, report, heapDelta: after.heapUsed - before.heapUsed,
    arrayBufferDelta: after.arrayBuffers - before.arrayBuffers, gcEvents: events.length,
    gcDurationMs: events.reduce((sum, e) => sum + e.durationMs, 0),
    note: 'Aggregate demand-only run including fixture construction; excludes browser rendering, network, decode, and uploads.' };
  await writeFile('research/vt-comparison/cpu-results.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }
