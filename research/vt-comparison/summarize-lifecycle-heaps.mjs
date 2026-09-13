import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const prefix = process.env.VT_HEAP_SNAPSHOTS ?? '/tmp/royal-vt-lifecycle-snapshot';
const summaries = {};
for (const label of ['before', 'after', 'disposed']) {
  const path = `${prefix}-${label}.heapsnapshot`, bytes = await readFile(path), heap = JSON.parse(bytes);
  const fields = heap.snapshot.meta.node_fields, width = fields.length;
  const typeOffset = fields.indexOf('type'), nameOffset = fields.indexOf('name'), sizeOffset = fields.indexOf('self_size');
  const types = heap.snapshot.meta.node_types[typeOffset];
  const groups = new Map(), byType = new Map();
  for (let index = 0; index < heap.nodes.length; index += width) {
    const type = types[heap.nodes[index + typeOffset]], name = heap.strings[heap.nodes[index + nameOffset]], size = heap.nodes[index + sizeOffset];
    for (const [map, key] of [[groups, `${type}:${name}`], [byType, type]]) {
      const row = map.get(key) ?? { count: 0, bytes: 0 }; row.count++; row.bytes += size; map.set(key, row);
    }
  }
  summaries[label] = { path, sha256: createHash('sha256').update(bytes).digest('hex'), nodes: heap.snapshot.node_count,
    totalSelfBytes: [...byType.values()].reduce((sum, row) => sum + row.bytes, 0), byType: Object.fromEntries(byType), groups };
}
const compare = (from, to) => [...new Set([...summaries[from].groups.keys(), ...summaries[to].groups.keys()])].map(name => {
  const before = summaries[from].groups.get(name) ?? { count: 0, bytes: 0 }, after = summaries[to].groups.get(name) ?? { count: 0, bytes: 0 };
  return { name, before, after, countDelta: after.count - before.count, bytesDelta: after.bytes - before.bytes };
}).filter(row => row.countDelta || row.bytesDelta).sort((a, b) => b.bytesDelta - a.bytesDelta);
const growth = compare('before', 'after'), disposal = compare('after', 'disposed');
for (const summary of Object.values(summaries)) {
  summary.resourceNodes = Object.fromEntries([...summary.groups].filter(([name]) => /^(object|native):(ImageBitmap|Blob|WebGLTexture|OffscreenCanvas|HTMLCanvasElement|ArrayBuffer)$/.test(name)));
  delete summary.groups;
}
await writeFile(process.env.VT_HEAP_SUMMARY ?? 'research/vt-comparison/lifecycle-heap-summary.json', JSON.stringify({ summaries,
  largestGrowth: growth.slice(0, 40), objectGrowth: growth.filter(row => row.name.startsWith('object:') || row.name.startsWith('native:')),
  disposalChanges: [...disposal.slice(0, 20), ...disposal.slice(-20)],
  note: 'Exact shallow/self-size sums by snapshot node type/name; not dominator retained sizes. Code includes V8 instruction/metadata nodes. Raw snapshots live at the recorded local paths, with SHA-256 hashes. Snapshot instrumentation may alter warm-up and GC.' }, null, 2) + '\n');
