import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert';
import ts from '@typescript/typescript6';
const sources = {
  before: await readFile('/tmp/royal-vt-before-zero-demand.ts', 'utf8'),
  after: await readFile('/tmp/royal-vt-zero-demand-candidate.ts', 'utf8'),
};
const functions = Object.fromEntries(Object.entries(sources).map(([version, source]) => {
  const start = source.indexOf('    this.#atlasDemand.clear();');
  const end = source.indexOf('    for (const atlas of this.#atlases.values())', start);
  if (start < 0 || end < 0) throw new Error('Missing aggregation block');
  const body = source.slice(start, end).replaceAll('this.#', 'state.').replaceAll('AUTOMATIC_VT_PAGE_SIZE', '128').replaceAll('AUTOMATIC_VT_BORDER_TEXELS', '2');
  const javascript = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText;
  return [version, new Function('state', 'views', 'virtualTextureAtlasKey', 'virtualTexturePageBytes', 'allocateVirtualTexturePoolBytes', javascript)];
}));
const stateFor = resources => ({ resources: new Map(resources.map((r, i) => [i, r])),
  automaticWaiting: 2, atlasDemand: new Map(), atlasDemandBytes: new Map(), atlasMinimumSlots: new Map(),
  atlases: new Map([['0', { allocationBytes: 4096 }]]), budget: { budgetBytes: 1 << 26 }, refreshFrameDemand() {},
});
const run = (fn, state) => { fn(state, [], r => r.pool, m => m.pageBytes, (requests, budget) => ({ requests, budget })); return state.atlasShares; };
let seed = 347623;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
for (let trial = 0; trial < 10000; trial++) {
  const resources = Array.from({ length: Math.floor(random() * 129) }, () => {
    const pool = Math.floor(random() * 8);
    return { pool: String(pool), desiredPageCount: random() < .5 ? 0 : Math.floor(random() * 1024),
      manifestFailure: random() < .1 ? 'failed' : undefined,
      manifest: random() < .1 ? undefined : { pageBytes: (pool + 1) * 4096,
        pageEncoding: pool % 3 ? 'image' : 'ktx2-native',
        physicalSlots: random() < .5 ? undefined : Math.floor(random() * 1024),
        physicalByteBudget: random() < .5 ? undefined : Math.floor(random() * 1e6) } };
  });
  deepStrictEqual(run(functions.before, stateFor(resources)), run(functions.after, stateFor(resources)));
}
const results = [];
for (const existing of [false, true]) for (const emptyFraction of [0, .5, 1]) {
  const resources = Array.from({ length: 16 }, (_, i) => ({ pool: '0', desiredPageCount: i < 16 * emptyFraction ? 0 : 21,
    manifest: { pageEncoding: 'image', pageBytes: 69696 } }));
  const makeState = () => { const state = stateFor(resources); if (!existing) state.atlases.clear(); return state; };
  for (const fn of Object.values(functions)) { const state = makeState(); for (let i = 0; i < 10000; i++) run(fn, state); }
  for (let round = 0; round < 4; round++) for (const version of round % 2 ? ['after', 'before'] : ['before', 'after']) {
    const state = makeState(); global.gc?.();
    const start = performance.now(); let checksum = 0;
    for (let i = 0; i < 50000; i++) checksum += run(functions[version], state).requests.length;
    results.push({ version, existing, emptyFraction, round, elapsedMs: performance.now() - start, checksum });
  }
}
await writeFile('research/vt-comparison/zero-demand-comparison.json', JSON.stringify({
  sourceHashes: Object.fromEntries(Object.entries(sources).map(([k, s]) => [k, createHash('sha256').update(s).digest('hex')])),
  equivalentCases: 10000, measuredIterations: 50000, warmupIterations: 10000, results,
  note: 'Extracted runtime aggregation blocks, TypeScript transpiled. Refresh, atlas key and page-byte functions stubbed equally; allocator returns requests and budget. Excludes rendering, asynchronous work and GPU execution.',
}, null, 2) + '\n');
