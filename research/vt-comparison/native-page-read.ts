import { readVirtualTexturePage } from '../../packages/renderer-webgl/src/virtual-texture/browser-page-source';
import { parseVirtualTextureManifest } from '../../packages/renderer-webgl/src/virtual-texture/manifest';
import { parseKtx2Native } from '../../packages/renderer-webgl/src/texture/ktx2-native';
import { createKtx2Fixture } from '../../tests/replacement/support/ktx2-fixture';

const fixtures = ([['ktx2-etc2', 152], ['ktx2-astc-6x6', 166], ['ktx2-astc-8x8', 172],
  ['ktx2-bc1', 134], ['ktx2-bc3', 138], ['ktx2-bc7', 146]] as const).map(([pageEncoding, vk]) => ({
  pageEncoding, bytes: createKtx2Fixture(vk, 144, 144, 1),
  manifest: parseVirtualTextureManifest({ contractVersion: 2, pageEncoding, pageSize: 128,
    borderTexels: 8, virtualSize: [128, 128], pages: { uriTemplate: '{page}.ktx2' } }),
}));
const params = new URLSearchParams(location.search);
const parserOnly = params.has('parser');
const http = params.has('http');
const concurrency = params.has('parallel') ? 4 : 1;
if (concurrency > 1 && (!http || parserOnly)) throw new Error('Parallel mode requires HTTP reads');
if (http && parserOnly) throw new Error('Choose HTTP reads or isolated parsing');
const batchPages = parserOnly ? 10000 : 100;
const originalFetch = globalThis.fetch;
const signal = new AbortController().signal;
const page = { mip: 0, x: 0, y: 0 };
let active = fixtures[0]!;
let reads = 0;
const results: { name: string; round: number; pages: number; containerBytes: number; blockBytes: number; elapsedMs: number }[] = [];
const read = async () => {
  const decoded = await readVirtualTexturePage('https://fixture.invalid/index.json', active.manifest, page, signal);
  if (!decoded || decoded.kind === 'image' || decoded.colorSpace !== 'srgb') throw new Error('Native read did not preserve storage');
  const bytes = decoded.blocks.byteLength;
  decoded.close();
  return bytes;
};
export async function prepareNativeReads() {
  globalThis.fetch = async (_input, init) => {
    reads++;
    return http ? originalFetch(`/research/vt-comparison/generated/native-read/${active.pageEncoding}.ktx2`, { ...init, cache: 'no-store' })
      : new Response(active.bytes.buffer as ArrayBuffer);
  };
  for (const fixture of fixtures) {
    active = fixture;
    const parsed = parseKtx2Native(fixture.bytes);
    if (parsed.levels[0]!.blocks.buffer !== fixture.bytes.buffer) throw new Error('Parser copied block storage');
    if (parserOnly) for (let i = 0; i < batchPages; i++) parseKtx2Native(fixture.bytes);
    else for (let i = 0; i < 100; i++) await read();
  }
  reads = 0;
}
export async function runNativeReads() {
  for (let round = 0; round < 8; round++) {
    const order = round % 2 ? [...fixtures].reverse() : fixtures;
    for (const fixture of order) {
      active = fixture;
      let bytes = 0;
      const start = performance.now();
      if (parserOnly) {
        for (let i = 0; i < batchPages; i++) bytes += parseKtx2Native(fixture.bytes).levels[0]!.blocks.byteLength;
      } else if (concurrency > 1) {
        for (let i = 0; i < batchPages; i += concurrency) {
          const batch = await Promise.all(Array.from({ length: concurrency }, () => read()));
          for (const size of batch) bytes += size;
        }
      } else for (let i = 0; i < batchPages; i++) bytes += await read();
      results.push({ name: fixture.pageEncoding, round, pages: batchPages, containerBytes: fixture.bytes.byteLength,
        blockBytes: bytes / batchPages, elapsedMs: performance.now() - start });
    }
  }
  return {};
}
export function finishNativeReads() {
  if (reads !== (parserOnly ? 0 : 4800)) throw new Error(`Unexpected page reads: ${reads}`);
  return { results, reads, parserOnly, http, concurrency, note: parserOnly
    ? 'Warm synchronous KTX2 parser on retained input bytes; eight alternating format-order rounds. No Response, body copy, source contract, asynchronous scheduling, GPU upload or transcoding. Returned block lengths are consumed.'
    : http ? 'Localhost HTTP reads in batches of the reported concurrency with cache no-store, including body handling and native source validation. Eight alternating format-order rounds. Warm JS and server filesystem cache; no GPU uploads or runtime queue. Not remote-network latency or concurrent VT throughput.'
    : 'Warm JS code, fresh Response and body buffer per read; in-memory transport, native parser and source-contract validation, with close. Eight alternating format-order rounds. No network, GPU upload, runtime queue, transcoding, or raster decoding is measured. Structural native fixtures are not a rendered quality comparison.' };
}
export function cleanupNativeReads() { globalThis.fetch = originalFetch; }
