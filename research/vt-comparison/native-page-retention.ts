import { readVirtualTexturePage, type DecodedVirtualTexturePage } from '../../packages/renderer-webgl/src/virtual-texture/browser-page-source';
import { parseVirtualTextureManifest } from '../../packages/renderer-webgl/src/virtual-texture/manifest';
import { createKtx2Fixture } from '../../tests/replacement/support/ktx2-fixture';
const held: DecodedVirtualTexturePage[] = [];
const bodies: WeakRef<ArrayBuffer>[] = [];
const originalFetch = globalThis.fetch;
export async function runRetention() {
  for (const [pageEncoding, vk] of [['ktx2-etc2', 152], ['ktx2-astc-6x6', 166], ['ktx2-astc-8x8', 172],
    ['ktx2-bc1', 134], ['ktx2-bc3', 138], ['ktx2-bc7', 146]] as const) {
    const fixture = createKtx2Fixture(vk, 144, 144, 1);
    const padded = new Uint8Array(fixture.byteLength + 1024 * 1024); padded.set(fixture);
    globalThis.fetch = async () => {
      const response = new Response(padded.buffer);
      const arrayBuffer = response.arrayBuffer.bind(response);
      response.arrayBuffer = async () => { const bytes = await arrayBuffer(); bodies.push(new WeakRef(bytes)); return bytes; };
      return response;
    };
    const manifest = parseVirtualTextureManifest({ contractVersion: 2, pageEncoding,
      pageSize: 128, borderTexels: 8, virtualSize: [128, 128], pages: { uriTemplate: '{page}.ktx2' } });
    const page = await readVirtualTexturePage('https://fixture.invalid/index.json', manifest,
      { mip: 0, x: 0, y: 0 }, new AbortController().signal);
    if (!page) throw new Error('Missing page');
    held.push(page);
  }
  globalThis.fetch = originalFetch;
  return {};
}
export function finishRetention() {
  const liveBodies = bodies.filter(body => body.deref() !== undefined).length;
  const results = held.map(page => {
    if (page.kind === 'image') throw new Error('Expected native page');
    return { name: page.kind, blockBytes: page.blocks.byteLength, backingBytes: page.blocks.buffer.byteLength };
  });
  return { results, liveBodies, heldPages: held.length,
    note: 'Six decoded native pages remain strongly held across runner-forced GC. WeakRefs track response arrayBuffers, without dereferencing before GC. Local synthetic responses contain 1 MiB trailing data each. No GPU storage is involved.' };
}
export function cleanupRetention() { globalThis.fetch = originalFetch; for (const page of held) page.close(); held.length = 0; }
