import { mesh, orthographicCamera, planeGeometry, scene, unlitMaterial, virtualTexture, type RenderObjectRefObject } from '../../packages/renderer-core/src/index';
import { createRendererRoot } from '../../packages/renderer-webgl/src/index';
import { coloredPage } from './resident-limit-gpu';

const params = new URLSearchParams(location.search);
const six = params.get('astc') === '6x6';
const pageEncoding = six ? 'ktx2-astc-6x6' : 'ktx2-astc-8x8';
const paddingBytes = params.has('padding') ? 1024 * 1024 : 0;
const evictionsPerWindow = params.has('long') ? 128 : 32;
const light = params.has('light');
let measuring = false, physicalUploads = 0, initialFrame = 0;
const colors = [[255, 0, 0], [0, 0, 255], [0, 255, 0], [255, 255, 0]] as const;
const pages = colors.map(color => {
  const source = coloredPage(six ? 166 : 172, color);
  const bytes = new Uint8Array(source.byteLength + paddingBytes); bytes.set(source); return bytes;
});
const nativeFetch = globalThis.fetch;
const bodies: (WeakRef<ArrayBuffer> | undefined)[] = new Array(32);
let pageReads = 0, neighborReads = 0, completed = 0, targetUploads = 3;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (!url.pathname.startsWith('/resident-eviction/')) return nativeFetch(input, init);
  const limited = url.pathname.includes('/limited/');
  if (url.pathname.endsWith('.json')) return new Response(JSON.stringify({ contractVersion: 2,
    pageEncoding, pageSize: 128, borderTexels: 8, virtualSize: [256, 128], mipCount: 1,
    physicalSlots: limited ? 1 : 2, pages: { uriTemplate: '{mip}-{x}-{y}.ktx2' } }));
  const match = /\/0-([01])-0\.ktx2$/.exec(url.pathname);
  if (!match) throw new Error(`Unexpected page: ${url.pathname}`);
  const response = new Response(pages[Number(match[1]) + (limited ? 0 : 2)]!.buffer as ArrayBuffer);
  const read = response.arrayBuffer.bind(response);
  response.arrayBuffer = async () => {
    const bytes = await read(); bodies[pageReads++ % bodies.length] = new WeakRef(bytes);
    if (!limited) neighborReads++;
    return bytes;
  };
  return response;
};
const canvas = document.createElement('canvas'); document.body.append(canvas);
const root = createRendererRoot(canvas, { antialias: false });
const gl = canvas.getContext('webgl2')!;
const upload = gl.compressedTexSubImage2D;
gl.compressedTexSubImage2D = ((...args: Parameters<typeof upload>) => {
  Reflect.apply(upload, gl, args); physicalUploads++;
}) as typeof upload;
const limited = virtualTexture('/resident-eviction/limited/index.json');
const neighbor = virtualTexture('/resident-eviction/neighbor/index.json');
const ref: RenderObjectRefObject = { current: null };
const pause = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const state = () => {
  const snapshot = root.getSnapshot();
  if (snapshot.lastFrameFailure) throw new Error(snapshot.lastFrameFailure);
  return snapshot.resources.virtualTextures;
};
const verify = (vt: ReturnType<typeof state>) => {
  if (vt.uploadedPages !== targetUploads || physicalUploads !== targetUploads || vt.failedPages !== 0
    || vt.pendingPages !== 0 || vt.unresidentPages !== 0 || vt.pendingPageBytes !== 0 || vt.atlasPools !== 1
    || root.getVirtualTextureAssetSnapshot(limited).residentPages !== 1 || root.getVirtualTextureAssetSnapshot(neighbor).residentPages !== 2)
    throw new Error(`Capped eviction failed: ${JSON.stringify(vt)}`);
};
async function settle() {
  for (let frame = 0; frame < 300; frame++) {
    root.invalidate(); root.flushInvalidated(); await pause();
    if (light && measuring) {
      if (physicalUploads > targetUploads) throw new Error('Unexpected physical upload');
      if (physicalUploads === targetUploads) return;
      continue;
    }
    const vt = state();
    if (vt.uploadedPages >= targetUploads && vt.pendingPages === 0 && vt.unresidentPages === 0) {
      verify(vt);
      return;
    }
  }
  throw new Error(`Eviction did not settle: ${JSON.stringify(state())}`);
}
async function pan() {
  ref.current!.position.x *= -1;
  targetUploads++;
  await settle();
}
export async function prepareEviction() {
  if (!gl.getExtension('WEBGL_compressed_texture_astc')) throw new Error('Host ASTC required');
  root.setSize({ cssWidth: 256, cssHeight: 256, pixelRatio: 1 });
  const geometry = planeGeometry(2);
  root.setScene(scene({ camera: orthographicCamera({ left: -1, right: 1, top: 1, bottom: -1, position: [0, 0, 3] }),
    nodes: [mesh({ geometry, material: unlitMaterial({ texture: limited }), ref, transform: { position: [2, .5, 0], scale: [4, .45, 1] } }),
      mesh({ geometry, material: unlitMaterial({ texture: neighbor }), transform: { position: [0, -.5, 0], scale: [1, .45, 1] } })], clearColor: [0, 0, 0, 1] }));
  await settle();
  for (let i = 0; i < 32; i++) await pan();
  initialFrame = root.getSnapshot().frame;
}
export async function runEviction() {
  measuring = true;
  try { for (let i = 0; i < evictionsPerWindow; i++) { await pan(); completed++; } }
  finally { measuring = false; }
  return {};
}
export function finishEviction() {
  const renderedFrames = root.getSnapshot().frame - initialFrame;
  root.invalidate(); root.flushInvalidated();
  const final = state(); verify(final);
  const pixels = [[128, 192], [64, 64], [192, 64]].map(([x, y], index) => {
    const pixel = new Uint8Array(4); gl.readPixels(x!, y!, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const color = colors[index === 0 ? 0 : index + 1]!;
    if (pixel[3] !== 255 || color.some((value, channel) => Math.abs(pixel[channel]! - value) > 3)) throw new Error(`Wrong retained page color: ${pixel}`);
    return [...pixel];
  });
  const liveBodies = bodies.filter(body => body?.deref() !== undefined).length;
  if (pageReads !== targetUploads || neighborReads !== 2 || gl.getError() !== gl.NO_ERROR) throw new Error('Unexpected reread or GL error');
  return { results: [{ name: pageEncoding, minFilter: 'capped-eviction', completed, evictionsPerWindow, renderedFrames, light, physicalUploads, pageReads, neighborReads, paddingBytes,
    liveBodies, trackedBodies: bodies.length, final, pixels }],
    note: '32 warm-up evictions, then the reported evictionsPerWindow, using one scene and an imperative transform ref. Light mode waits for physical upload counts during measurement; full snapshot checks still run at warm-up and finish. Both modes wrap uploads and keep a bounded WeakRef ring. Fixtures, fetch wrappers, promises, snapshots and rAF add harness overhead. No timing claim or unbounded region-visit claim.' };
}
export function cleanupEviction() {
  globalThis.fetch = nativeFetch; root.dispose(); canvas.remove(); gl.getExtension('WEBGL_lose_context')?.loseContext();
  if (root.getSnapshot().resources.persistentGpu.retainedBytes !== 0) throw new Error('Disposed eviction fixture retained GPU budget');
}
