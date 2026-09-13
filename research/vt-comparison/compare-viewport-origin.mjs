import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { strictEqual } from 'node:assert';

const sources = {
  before: await readFile(process.env.VT_BASELINE_FILE ?? '/tmp/royal-vt-before-viewport-origin.ts', 'utf8'),
  after: await readFile('packages/renderer-webgl/src/virtual-texture/runtime.ts', 'utf8'),
};
const functions = Object.fromEntries(Object.entries(sources).map(([version, source]) => {
  const body = source.match(/const stride = \d+;[\s\S]*?return changed;/)?.[0];
  if (!body) throw new Error('View comparison not found');
  return [version, new Function('views', 'state', body.replaceAll('this.#', 'state.').replaceAll('views[viewIndex]!', 'views[viewIndex]').replaceAll('view.viewProjection[component]!', 'view.viewProjection[component]'))];
}));
const state = () => ({ viewState: new Float64Array(), viewCount: 0 });
const states = { before: state(), after: state() };
const previous = { before: '[]', after: '[]' };
let seed = 0x893;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
let views = [];
for (let trial = 0; trial < 10000; trial++) {
  if (trial % 5 === 0) views = Array.from({ length: Math.floor(random() * 5) }, () => ({
    viewProjection: Array.from({ length: 16 }, (_, i) => i % 5 === 0 ? 1 : 0),
    viewport: { x: 0, y: 0, width: 512, height: 512 },
  }));
  for (const view of views) {
    view.viewport.x = Math.floor(random() * 1024); view.viewport.y = -Math.floor(random() * 1024);
    if (trial % 3 === 0) view.viewport.width = Math.floor(random() * 1024);
    if (trial % 7 === 0) view.viewport.height = Math.floor(random() * 1024);
    if (trial % 11 === 0) view.viewProjection[12] = random();
  }
  for (const version of ['before', 'after']) {
    const key = JSON.stringify(views.map(view => [...view.viewProjection,
      ...(version === 'before' ? [view.viewport.x, view.viewport.y] : []), view.viewport.width, view.viewport.height]));
    strictEqual(functions[version](views, states[version]), key !== previous[version]);
    previous[version] = key;
  }
}
const originResults = [];
for (const version of ['before', 'after']) {
  const cache = state();
  const view = { viewProjection: Array.from({ length: 16 }, (_, i) => i % 5 === 0 ? 1 : 0), viewport: { x: 0, y: 0, width: 512, height: 512 } };
  let changes = 0;
  for (let frame = 0; frame < 10000; frame++) { view.viewport.x = frame; view.viewport.y = -frame; changes += Number(functions[version]([view], cache)); }
  originResults.push({ version, frames: 10000, invalidations: changes, cachedBytes: cache.viewState.byteLength });
}
await writeFile('research/vt-comparison/viewport-origin-comparison.json', JSON.stringify({
  sourceHashes: Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, createHash('sha256').update(value).digest('hex')])),
  oracleCases: 10000, originResults,
  note: 'Actual view-comparison body checked against independently serialized relevant inputs. Exercises zero/multiple views, replacements, translations and each dimension. Origin-only invalidation counts are deterministic; not a renderer frame-time benchmark.',
}, null, 2) + '\n');
