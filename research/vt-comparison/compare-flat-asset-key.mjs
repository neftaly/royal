import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { strictEqual } from 'node:assert';
import ts from '@typescript/typescript6';
const before = await readFile(process.env.VT_KEY_BASELINE ?? '/tmp/royal-vt-before-flat-asset-key.ts', 'utf8');
const start = before.indexOf('const versionIdentity ='), end = before.indexOf('export const automaticVirtualTextureAssetKey');
if (start < 0 || end < start) throw new Error('Missing key source');
const replacement = `export const virtualTextureAssetKey = (asset: VirtualTextureAssetRef): string => {
  const sampler = canonicalTextureSampler(asset);
  return JSON.stringify([
    asset.contentKey === undefined ? "manifest" : typeof asset.contentKey,
    asset.contentKey === undefined ? asset.manifestUri : asset.contentKey,
    typeof asset.version, asset.version,
    asset.colorSpace ?? "srgb",
    sampler.magFilter, sampler.minFilter, sampler.wrapS, sampler.wrapT,
  ]);
};

`;
const after = before.slice(0, start) + replacement + before.slice(end);
await writeFile('/tmp/royal-vt-before-flat-asset-key.ts', before);
await writeFile('/tmp/royal-vt-flat-asset-key.ts', after);
const sampler = await readFile('packages/renderer-webgl/src/texture/sampler.ts', 'utf8');
const compile = source => {
  const js = ts.transpileModule((sampler + '\n' + source).replaceAll('export ', ''),
    { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText;
  return new Function(js.replace('export {};', '') + ';return virtualTextureAssetKey;')();
};
const functions = { before: compile(before.slice(start, end)), after: compile(replacement) };
const values = [undefined, 0, '0', '', 1, 'manifest', 'unversioned', '["content","string",null]', 'x\u0000y', '"\\\n🦊'];
const samplers = [undefined, {}, { minFilter: 'linear-mipmap-linear', magFilter: 'linear', wrapS: 'clamp-to-edge', wrapT: 'clamp-to-edge' },
  { minFilter: 'nearest' }, { wrapS: 'repeat', wrapT: 'mirrored-repeat', magFilter: 'nearest' }];
const oldToNew = new Map(), newToOld = new Map(); let cases = 0;
for (const manifestUri of ['/map.json', '0', 'manifest', 'https://x.test/"\\\n.json']) for (const contentKey of values)
 for (const version of values) for (const sampler of samplers) for (const colorSpace of [undefined, 'srgb', 'linear']) {
  const asset = { manifestUri, contentKey, version, sampler, colorSpace };
  const a = functions.before(asset), b = functions.after(asset);
  if (oldToNew.has(a)) strictEqual(oldToNew.get(a), b);
  if (newToOld.has(b)) strictEqual(newToOld.get(b), a);
  oldToNew.set(a, b); newToOld.set(b, a); cases++;
 }
const assets = Array.from({ length: 16 }, (_, i) => ({ manifestUri: `https://example.test/maps/${i}/manifest.json`,
  contentKey: i % 3 ? undefined : i, version: i % 2 ? '1' : undefined, sampler: samplers[i % samplers.length] }));
const results = []; let checksum = 0;
for (const fn of Object.values(functions)) for (let i = 0; i < 20000; i++) checksum += fn(assets[i % assets.length]).length;
for (let round = 0; round < 8; round++) for (const version of round % 2 ? ['after', 'before'] : ['before', 'after']) {
  global.gc?.(); const start = performance.now();
  for (let i = 0; i < 200000; i++) checksum += functions[version](assets[i % assets.length]).length;
  results.push({ version, round, elapsedMs: performance.now() - start });
}
await writeFile('research/vt-comparison/flat-asset-key-cpu.json', JSON.stringify({ cases, identityClasses: oldToNew.size,
  iterations: 200000, warmupIterations: 20000, checksum, results,
  sourceHashes: Object.fromEntries(Object.entries({ before, after, sampler }).map(([k, v]) => [k, createHash('sha256').update(v).digest('hex')])),
  note: 'Actual transpiled key and sampler functions. Bidirectional identity-class oracle permits new internal key strings but forbids merges/splits of sampled existing identities. Synthetic key-only CPU measurement, not a renderer benchmark.',
}, null, 2) + '\n');
