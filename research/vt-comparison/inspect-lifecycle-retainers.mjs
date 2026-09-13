import { readFile, writeFile } from 'node:fs/promises';
const prefix = process.env.VT_HEAP_SNAPSHOTS ?? '/tmp/royal-vt-lifecycle-snapshot';
const before = JSON.parse(await readFile(`${prefix}-before.heapsnapshot`, 'utf8'));
const heap = JSON.parse(await readFile(`${prefix}-after.heapsnapshot`, 'utf8'));
const fields = heap.snapshot.meta.node_fields, width = fields.length, edgeWidth = heap.snapshot.meta.edge_fields.length;
const field = Object.fromEntries(fields.map((name, i) => [name, i]));
const types = heap.snapshot.meta.node_types[field.type], edgeTypes = heap.snapshot.meta.edge_types[0];
const { nodes, edges, strings } = heap, count = nodes.length / width;
const oldIds = new Set();
for (let offset = 0; offset < before.nodes.length; offset += width) oldIds.add(before.nodes[offset + field.id]);
const starts = new Uint32Array(count + 1), parents = new Int32Array(count).fill(-1), parentEdges = new Int32Array(count), queue = new Int32Array(count);
for (let node = 0; node < count; node++) starts[node + 1] = starts[node] + nodes[node * width + field.edge_count] * edgeWidth;
parents[0] = 0; queue[0] = 0; let queued = 1;
for (let cursor = 0; cursor < queued; cursor++) {
  const node = queue[cursor];
  for (let edge = starts[node]; edge < starts[node + 1]; edge += edgeWidth) {
    const target = edges[edge + 2] / width;
    if (edgeTypes[edges[edge]] === 'weak' || parents[target] !== -1) continue;
    parents[target] = node; parentEdges[target] = edge; queue[queued++] = target;
  }
}
const label = node => `${types[nodes[node * width + field.type]]}:${strings[nodes[node * width + field.name]]}`;
const newObjects = [];
for (let node = 0; node < count; node++) {
  const id = nodes[node * width + field.id];
  if (label(node) !== 'object:Object' || oldIds.has(id)) continue;
  const properties = [];
  for (let edge = starts[node]; edge < starts[node + 1]; edge += edgeWidth)
    if (edgeTypes[edges[edge]] === 'property' && strings[edges[edge + 1]] !== '__proto__') properties.push(strings[edges[edge + 1]]);
  const path = []; let current = node, allocationSite = false;
  while (current !== 0 && parents[current] !== -1) {
    const name = label(current), edge = parentEdges[current], kind = edgeTypes[edges[edge]];
    allocationSite ||= name === 'code:system / AllocationSite';
    path.push({ edge: kind === 'element' || kind === 'hidden' ? String(edges[edge + 1]) : strings[edges[edge + 1]], node: name });
    current = parents[current];
  }
  newObjects.push({ id, properties, allocationSite, reachableWithoutWeakEdges: parents[node] !== -1, pathTail: path.slice(0, 9).reverse() });
}
await writeFile(process.env.VT_HEAP_RETAINERS ?? 'research/vt-comparison/lifecycle-retainers.json', JSON.stringify({ newPlainObjectCount: newObjects.length,
  viaAllocationSite: newObjects.filter(row => row.allocationSite).length,
  other: newObjects.filter(row => !row.allocationSite),
  templateExamples: newObjects.filter(row => row.allocationSite && row.properties.some(name => ['demandRevision', 'vertexCache', 'src', 'decodedClaims'].includes(name))),
  note: 'BFS paths from snapshot root, excluding weak edges. Allocation-site paths identify engine-held literal templates; path tails are truncated for readability. These are shortest reference paths, not dominator/retained-size calculations. Node IDs compare snapshots from one browser session.' }, null, 2) + '\n');
