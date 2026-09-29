import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { sortSurfaceRunsFrontToBack as candidate } from '../../packages/renderer-webgl/src/surface/surface-depth-order.ts';

// Optional baseline source copied before editing. No WebGL or asset/network work.
const baseline = process.argv[2]
  ? (await import(pathToFileURL(process.argv[2]).href)).sortSurfaceRunsFrontToBack : undefined;
const view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const rows = [];
for (const count of [1000, 4000, 16000]) {
  const surfaces = Array.from({ length: count }, (_, id) => ({ depthOrder: 0,
    surface: { worldBounds: { min: [0, 0, id], max: [0, 0, id] } } }));
  const ends = new Uint32Array(count).fill(count), scratch = [];
  for (const [label, sort] of [['before', baseline], ['after', candidate]]) {
    if (!sort) continue;
    const times = [];
    for (let pass = 0; pass < 9; pass++) {
      surfaces.sort((a, b) => a.surface.worldBounds.min[2] - b.surface.worldBounds.min[2]);
      const start = performance.now();
      sort(surfaces, ends, view, scratch);
      const elapsed = performance.now() - start;
      if (pass >= 3) times.push(elapsed);
    }
    times.sort((a, b) => a - b);
    rows.push({ label, count, medianMs: (times[2] + times[3]) / 2 });
  }
}
console.log(JSON.stringify(rows, null, 2));
