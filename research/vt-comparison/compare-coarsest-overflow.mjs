import { build } from 'vite';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const modulePath = 'packages/renderer-webgl/src/virtual-texture/demand.ts';
const sources = {
  before: await readFile(process.env.VT_BASELINE_FILE ?? '/tmp/royal-vt-before-coarsest-overflow.ts', 'utf8'),
  after: await readFile(modulePath, 'utf8'),
};
const directory = await mkdtemp(join(tmpdir(), 'royal-coarsest-overflow-'));
try {
  const versions = {};
  for (const [version, source] of Object.entries(sources)) {
    await build({ configFile: false, logLevel: 'error', plugins: [{ name: 'expose-coarsest-demand', enforce: 'pre',
      load(id) { if (id.endsWith('/' + modulePath)) return source + '\nexport { addCoarsestMip };\n'; } }],
      build: { ssr: modulePath, outDir: join(directory, version), minify: false } });
    versions[version] = await import(pathToFileURL(join(directory, version, 'demand.js')));
  }
  const results = [];
  for (const width of [1, 1024]) {
    const iterations = width === 1 ? 100000 : 10;
    const manifest = { mipCount: 1, mipLayouts: [{ width, height: width }] };
    const states = Object.fromEntries(Object.entries(versions).map(([key, api]) => [key, api.createVirtualTextureDemandWorkspace(4)]));
    for (const [version, api] of Object.entries(versions)) for (let i = 0; i < (width === 1 ? 10000 : 2); i++) {
      api.resetVirtualTextureDemand(states[version]); api.addCoarsestMip(states[version], manifest);
    }
    for (let round = 0; round < 4; round++) for (const version of round % 2 ? ['after', 'before'] : ['before', 'after']) {
      const api = versions[version], workspace = states[version];
      global.gc?.();
      const start = performance.now(), cpu = process.cpuUsage();
      for (let i = 0; i < iterations; i++) { api.resetVirtualTextureDemand(workspace); api.addCoarsestMip(workspace, manifest); }
      const elapsedMs = performance.now() - start, usage = process.cpuUsage(cpu);
      results.push({ version, round, width, iterations, elapsedMs, cpuMs: (usage.user + usage.system) / 1000,
        count: workspace.count, overflow: workspace.overflow, keys: [...workspace.keys] });
    }
    if (JSON.stringify([...states.before.keys]) !== JSON.stringify([...states.after.keys])) throw new Error('Demand differs');
  }
  await writeFile('research/vt-comparison/coarsest-overflow-comparison.json', JSON.stringify({
    sourceHashes: Object.fromEntries(Object.entries(sources).map(([key, source]) => [key, createHash('sha256').update(source).digest('hex')])),
    node: process.version, results,
    note: 'Actual coarsest helper from Vite-built source; warmed alternating rounds, includes workspace reset, excludes rendering and decoding. Large case deliberately exhausts capacity. Not a GC benchmark.',
  }, null, 2) + '\n');
} finally { await rm(directory, { recursive: true, force: true }); }
