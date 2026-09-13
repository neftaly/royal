import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { PerformanceObserver } from 'node:perf_hooks';

const paths = { before: process.env.VT_BASELINE_FILE ?? '/tmp/royal-vt-retention-checkpoint-pool-budget.ts', after: 'packages/renderer-webgl/src/virtual-texture/pool-budget.ts' };
const versions = {}, hashes = {}, results = [], events = [];
const demandScale = Number(process.env.VT_DEMAND_SCALE ?? 1);
if (!Number.isFinite(demandScale) || demandScale < 1) throw new Error('VT_DEMAND_SCALE must be finite and at least 1');
for (const [name, path] of Object.entries(paths)) {
  versions[name] = (await import(pathToFileURL(resolve(path)))).allocateVirtualTexturePoolBytes;
  hashes[name] = createHash('sha256').update(await readFile(path)).digest('hex');
}
const observer = new PerformanceObserver(list => events.push(...list.getEntries()));
observer.observe({ entryTypes: ['gc'] });
let checksum = 0, comparisons = 0;
try {
  let seed = 12345;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let trial = 0; trial < 10000; trial++) {
    const requests = Array.from({ length: Math.floor(random() * 61) }, (_, i) => {
      const minimumBytes = Math.floor(random() * 1e6) + (trial % 2 ? random() : 0);
      return { key: String(i), minimumBytes, wantedBytes: minimumBytes + Math.floor(random() * 1e8) };
    });
    const budget = Math.floor(random() * 1e9) + (trial % 2 ? random() : 0);
    if (JSON.stringify([...versions.before(requests, budget)]) !== JSON.stringify([...versions.after(requests, budget)]))
      throw new Error(`Allocation mismatch in seeded trial ${trial}`);
    comparisons++;
  }
  for (const count of [0, 1, 3, 7, 31, 60]) {
    const requests = Array.from({ length: count }, (_, i) => ({ key: String(i), minimumBytes: (i + 1) * 69696, wantedBytes: demandScale * 2 ** (i % 14) * (i + 1) * 69696 }));
    for (const budget of [0, 1, 101, 100003, 201326592, 1e12]) {
      const before = [...versions.before(requests, budget)], after = [...versions.after(requests, budget)];
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`Allocation mismatch: ${count}/${budget}`);
      comparisons++;
    }
    if (!count) continue;
    const iterations = Math.floor(400000 / Math.sqrt(count));
    for (const version of Object.values(versions)) for (let i = 0; i < 20000; i++) version(requests, 201326592);
    for (let round = 0; round < 4; round++) for (const name of round % 2 ? ['after', 'before'] : ['before', 'after']) {
      global.gc?.();
      const start = performance.now(), cpuStart = process.cpuUsage();
      for (let i = 0; i < iterations; i++) checksum += versions[name](requests, 201326592).get('0');
      const end = performance.now(), cpu = process.cpuUsage(cpuStart);
      await new Promise(resolve => setTimeout(resolve, 0));
      const gc = events.filter(event => event.startTime >= start && event.startTime < end);
      results.push({ count, round, version: name, iterations, elapsedMs: end - start, cpuMs: (cpu.user + cpu.system) / 1000, gcEvents: gc.length, gcMs: gc.reduce((sum, event) => sum + event.duration, 0) });
    }
  }
  await writeFile(process.env.VT_BENCH_OUTPUT ?? 'research/vt-comparison/pool-budget-comparison.json', JSON.stringify({ hashes, node: process.version, nodeOptions: process.execArgv, demandScale, comparisons, checksum, results, note: 'Warmed alternating runs; fixed requests, uneven demands. Microbenchmark excludes other frame work. GC comparison requires fixed V8 nursery flags.' }, null, 2) + '\n');
} finally { observer.disconnect(); }
