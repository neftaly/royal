import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { strictEqual } from 'node:assert';
import ts from '@typescript/typescript6';
const sources = { before: await readFile('/tmp/royal-vt-before-resident-limit-residency.ts', 'utf8'),
  after: await readFile('packages/renderer-webgl/src/virtual-texture/residency.ts', 'utf8') };
const functions = Object.fromEntries(Object.entries(sources).map(([name, source]) => {
  const start = source.indexOf('export const selectVirtualTexturePoolSlot');
  const end = source.indexOf('\n};', start) + 3;
  if (start < 0 || end < 3) throw new Error('Missing selector');
  const js = ts.transpileModule(source.slice(start, end).replace('export ', ''),
    { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText;
  return [name, new Function(js + ';return selectVirtualTexturePoolSlot;')()];
}));
const results = [];
let checksum = 0;
for (const size of [512, 3600]) for (const full of [false, true]) for (const capped of [false, true]) {
  const slots = Array.from({ length: size }, (_, i) => !full && i >= 24 ? undefined
    : { resourceKey: i % 4 === 0 ? 'owner' : 'neighbor', pageKey: i });
  const frames = Uint32Array.from({ length: size }, (_, i) => i + 1);
  const protectedPages = { has: (_resource, key) => key !== 20 && key % 3 !== 0 };
  const owned = capped ? new Map(slots.flatMap((entry, slot) => entry?.resourceKey === 'owner' ? [[entry.pageKey, slot]] : [])) : undefined;
  const args = ['owner', -1, slots, frames, protectedPages, owned];
  if (!capped) strictEqual(functions.before(...args), functions.after(...args));
  else strictEqual(slots[functions.after(...args)].resourceKey, 'owner');
  for (const fn of Object.values(functions)) for (let i = 0; i < 10000; i++) checksum += fn(...args);
  for (let round = 0; round < 6; round++) for (const version of round % 2 ? ['after', 'before'] : ['before', 'after']) {
    global.gc?.();
    const start = performance.now();
    for (let i = 0; i < 10000; i++) checksum += functions[version](...args);
    results.push({ size, full, capped, version, round, elapsedMs: performance.now() - start });
  }
}
await writeFile('research/vt-comparison/resident-limit-cpu.json', JSON.stringify({
  sourceHashes: Object.fromEntries(Object.entries(sources).map(([name, s]) => [name, createHash('sha256').update(s).digest('hex')])),
  iterations: 10000, warmupIterations: 10000, checksum, results,
  note: 'Actual transpiled slot selectors. Capped before ignores the new argument and is deliberately incorrect; its timing is a cost reference, not equivalent behavior. No rendering or transport included.',
}, null, 2) + '\n');
