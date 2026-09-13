import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert';

const sources = {
  before: await readFile(process.env.VT_BASELINE_FILE ?? '/tmp/royal-vt-before-admission-loop.ts', 'utf8'),
  after: await readFile('packages/renderer-webgl/src/virtual-texture/runtime.ts', 'utf8'),
};
const functions = Object.fromEntries(Object.entries(sources).map(([version, source]) => {
  const block = source.match(/const requests = resources\.filter[\s\S]*?(?=      const shares = allocateVirtualTexturePoolBytes)/)?.[0]
    ?? source.match(/const requests = \[\];\n      for \(const resource of resources\)[\s\S]*?(?=      const shares = allocateVirtualTexturePoolBytes)/)?.[0];
  if (!block) throw new Error(`Admission block not found: ${version}`);
  return [version, new Function('resources', 'atlas', block.replaceAll('resource.manifest!', 'resource.manifest').replaceAll('resource.desiredPageCount!', 'resource.desiredPageCount') + '\nreturn requests;')];
}));
let seed = 0x13759;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
for (let trial = 0; trial < 10000; trial++) {
  const atlas = { slotCount: 1 + Math.floor(random() * 512), allocationBytes: 69696 * (1 + Math.floor(random() * 512)) };
  const resources = Array.from({ length: Math.floor(random() * 129) }, (_, index) => ({ key: String(index),
    desiredPageCount: random() < .2 ? undefined : Math.floor(random() * 1024),
    manifest: { physicalSlots: random() < .5 ? undefined : 1 + Math.floor(random() * 1024),
      physicalByteBudget: random() < .5 ? undefined : 1 + Math.floor(random() * 1e7) },
  }));
  deepStrictEqual(functions.before(resources, atlas), functions.after(resources, atlas));
}
const results = [];
for (const count of [1, 16, 128]) {
  const atlas = { slotCount: 512, allocationBytes: 512 * 69696 };
  const resources = Array.from({ length: count }, (_, index) => ({ key: String(index), desiredPageCount: index % 3 ? 21 : 0, manifest: {} }));
  for (const fn of Object.values(functions)) for (let i = 0; i < 10000; i++) fn(resources, atlas);
  for (let round = 0; round < 4; round++) for (const version of round % 2 ? ['after', 'before'] : ['before', 'after']) {
    global.gc?.();
    const start = performance.now(), cpu = process.cpuUsage();
    let checksum = 0;
    for (let i = 0; i < 100000; i++) checksum += functions[version](resources, atlas).length;
    const elapsedMs = performance.now() - start, usage = process.cpuUsage(cpu);
    results.push({ version, round, count, elapsedMs, cpuMs: (usage.user + usage.system) / 1000, checksum });
  }
}
await writeFile('research/vt-comparison/admission-loop-comparison.json', JSON.stringify({
  sourceHashes: Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, createHash('sha256').update(value).digest('hex')])),
  equivalentCases: 10000, results,
  note: 'Actual request-building blocks with TypeScript non-null assertions removed. Deterministic output/order comparisons, then four alternating warmed CPU rounds; excludes full runtime, rendering, decoding and GC profiling.',
}, null, 2) + '\n');
