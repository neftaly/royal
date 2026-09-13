import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { PerformanceObserver } from 'node:perf_hooks';
const paths = { before: process.env.VT_BASELINE_FILE ?? '/tmp/royal-vt-membership-checkpoint-runtime.ts', after: 'packages/renderer-webgl/src/virtual-texture/runtime.ts' };
const versions = {}, sources = {}, events = [], results = [];
for (const [name, path] of Object.entries(paths)) {
  const source = (await readFile(path, 'utf8')).match(/const virtualTextureAtlasKey = [\s\S]*?;/)?.[0];
  if (!source) throw new Error('Atlas key helper not found');
  sources[name] = source;
  const js = stripTypeScriptTypes(`export ${source}`);
  const helper = (await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))).virtualTextureAtlasKey;
  versions[name] = source.includes("RuntimeResource") ? resource => helper(resource, resource.manifest) : resource => helper(resource.asset, resource.manifest);
}
const formats = ['image', 'ktx2-etc2', 'ktx2-astc-6x6', 'ktx2-astc-8x8', 'ktx2-bc1', 'ktx2-bc3', 'ktx2-bc7'];
const oldToNew = new Map(), newToOld = new Map();
let comparisons = 0;
for (let pageSize = 1; pageSize <= 1024; pageSize++) for (const pageEncoding of formats) for (const colorSpace of ['linear', 'srgb']) {
  for (const override of [undefined, 'linear', 'srgb']) {
    const manifest = { pageSize, borderTexels: 2, pageEncoding, colorSpace }, asset = { colorSpace: override };
    const resource = { asset, manifest };
    const before = versions.before(resource), after = versions.after(resource);
    if (versions.after({ ...resource, gpu: { atlas: { key: after } } }) !== after) throw new Error('Resident key mismatch');
    if ((oldToNew.has(before) && oldToNew.get(before) !== after) || (newToOld.has(after) && newToOld.get(after) !== before)) throw new Error('Key equivalence mismatch');
    oldToNew.set(before, after); newToOld.set(after, before); comparisons++;
  }
}
const observer = new PerformanceObserver(list => events.push(...list.getEntries()));
observer.observe({ entryTypes: ['gc'] });
let checksum = 0;
const asset = { colorSpace: 'srgb' }, manifest = { pageSize: 128, borderTexels: 2, pageEncoding: 'image', colorSpace: 'linear' };
const resident = process.env.VT_RESIDENT_KEY === '1';
const resource = { asset, manifest, ...(resident ? { gpu: { atlas: { key: versions.before({ asset, manifest }) } } } : {}) };
try {
  for (const version of Object.values(versions)) for (let i = 0; i < 100000; i++) checksum += version(resource).length;
  for (let round = 0; round < 4; round++) for (const version of round % 2 ? ['after', 'before'] : ['before', 'after']) {
    const lookup = new Map([[versions[version](resource), 1]]);
    global.gc?.();
    const start = performance.now(), cpuStart = process.cpuUsage();
    for (let i = 0; i < 1000000; i++) checksum += lookup.get(versions[version](resource));
    const end = performance.now(), cpu = process.cpuUsage(cpuStart);
    await new Promise(resolve => setTimeout(resolve, 0));
    const gc = events.filter(event => event.startTime >= start && event.startTime < end);
    results.push({ version, round, iterations: 1000000, cpuMs: (cpu.user + cpu.system) / 1000, elapsedMs: end - start, gcEvents: gc.length, gcMs: gc.reduce((sum, e) => sum + e.duration, 0) });
  }
  await writeFile(process.env.VT_BENCH_OUTPUT ?? 'research/vt-comparison/atlas-key-comparison.json', JSON.stringify({ sources, resident, comparisons, uniqueKeys: oldToNew.size, node: process.version, nodeOptions: process.execArgv, checksum, results, note: 'Actual source helpers, TypeScript types stripped. Key outputs consumed by Map lookups and checksum; repeated input represents a settled atlas. Microbenchmark excludes all other rendering work.' }, null, 2) + '\n');
} finally { observer.disconnect(); }
