import { build } from 'vite';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PerformanceObserver } from 'node:perf_hooks';
import { Session } from 'node:inspector/promises';
import { createHash } from 'node:crypto';

const revision = process.env.VT_BASELINE_REVISION ?? '56130d34';
const sourcePath = 'packages/renderer-webgl/src/virtual-texture/demand.ts';
const baselineSource = process.env.VT_BASELINE_FILE ? await readFile(process.env.VT_BASELINE_FILE, 'utf8')
  : execFileSync('git', ['show', `${revision}:${sourcePath}`], { encoding: 'utf8' });
const directory = await mkdtemp(join(tmpdir(), 'royal-demand-comparison-'));
const events = [];
const profiler = process.env.VT_PROFILE ? new Session() : undefined;
profiler?.connect();
const observer = new PerformanceObserver(list => events.push(...list.getEntries()));
try {
  const versions = {};
  for (const version of ['before', 'after']) {
    const output = join(directory, version);
    await build({ configFile: false, logLevel: 'error', plugins: [{ name: 'demand-baseline', enforce: 'pre',
      load(id) { if (version === 'before' && id.endsWith('/' + sourcePath)) return baselineSource; } }],
      build: { ssr: 'research/vt-comparison/demand.ts', outDir: output, minify: false } });
    versions[version] = (await import(pathToFileURL(join(output, 'demand.js')))).runDemandBenchmark;
    versions[version](40, false); versions[version](40, true);
  }
  observer.observe({ entryTypes: ['gc'] });
  const results = [];
  for (let round = 0; (profiler ? round < 1 : round < 4); round++) for (const grid of [false, true]) {
    for (const version of round % 2 ? ['after', 'before'] : ['before', 'after']) {
      global.gc?.();
      const started = performance.now(), heap = process.memoryUsage().heapUsed;
      const cpuStart = process.cpuUsage(), hostLoad = loadavg();
      if (profiler) await profiler.post('HeapProfiler.startSampling', { samplingInterval: 32768, includeObjectsCollectedByMinorGC: true, includeObjectsCollectedByMajorGC: true });
      const report = versions[version](120, grid);
      const ended = performance.now(), heapDelta = process.memoryUsage().heapUsed - heap;
      const cpu = process.cpuUsage(cpuStart);
      let allocations;
      if (profiler) {
        const { profile } = await profiler.post('HeapProfiler.stopSampling');
        allocations = [];
        const visit = node => { if (node.selfSize) allocations.push({ name: node.callFrame.functionName, line: node.callFrame.lineNumber, bytes: node.selfSize }); node.children.forEach(visit); };
        visit(profile.head); allocations.sort((a, b) => b.bytes - a.bytes);
      }
      await new Promise(resolve => setTimeout(resolve, 0));
      const gc = events.filter(event => event.startTime >= started && event.startTime < ended);
      results.push({ allocations, cpuMs: (cpu.user + cpu.system) / 1000, elapsedMs: ended - started, hostLoad, round, grid, version, report, heapDelta, gcEvents: gc.length, gcMs: gc.reduce((sum, e) => sum + e.duration, 0) });
    }
  }
  const sourceHashes = { before: createHash('sha256').update(baselineSource).digest('hex'),
    after: createHash('sha256').update(await readFile(sourcePath)).digest('hex') };
  const result = { sourceHashes, node: process.version, nodeOptions: process.execArgv, profile: Boolean(profiler), baseline: process.env.VT_BASELINE_FILE ?? revision, results,
    note: 'Alternating order, four rounds (one when profiling), warmed bundles in one process. Sampling adds overhead; GC counts depend on heap sizing. Each report includes fixture construction; excludes rendering/network/decode/upload. Compare matched geometry and ancestors, not aggregate GC across unlike workloads.' };
  await writeFile(process.env.VT_DEMAND_OUTPUT ?? 'research/vt-comparison/raster-demand-comparison.json', JSON.stringify(result, null, 2) + '\n');
  console.log('Completed alternating demand comparison');
} finally { profiler?.disconnect(); observer.disconnect(); await rm(directory, { recursive: true, force: true }); }
