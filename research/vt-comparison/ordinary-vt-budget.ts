import { imageTexture, mesh, perspectiveCamera, planeGeometry, scene, unlitMaterial, virtualTexture } from '../../packages/renderer-core/src/index';
import { createRendererRoot } from '../../packages/renderer-webgl/src/index';

const canvas = document.createElement('canvas'); document.body.append(canvas);
const gl = canvas.getContext('webgl2', { antialias: false })!;
const extension = gl.getExtension.bind(gl);
gl.getExtension = ((name: string) => name === 'WEBGL_compressed_texture_astc' ? null : extension(name)) as typeof gl.getExtension;
const originalFetch = globalThis.fetch;
let release!: () => void;
const gate = new Promise<void>(resolve => { release = resolve; });
globalThis.fetch = async (input, init) => {
  if (String(input).includes('/budget-native.json')) {
    await gate;
    return new Response(JSON.stringify({ contractVersion: 2, pageSize: 128, borderTexels: 8,
      virtualSize: [256, 256], pageEncoding: 'ktx2-astc-8x8', pages: { uriTemplate: '{mip}-{x}-{y}.ktx2' } }));
  }
  return originalFetch(input, init);
};
const root = createRendererRoot(canvas, { antialias: false, persistentGpuByteBudget: 64 * 1024 * 1024 });
let uri: string, raster: ReturnType<typeof imageTexture>, native: ReturnType<typeof virtualTexture>;
let before: object;
const settle = async (predicate: () => boolean) => {
  for (let frame = 0; frame < 600; frame++) {
    root.invalidate(); root.flushInvalidated();
    if (root.getSnapshot().lastFrameFailure) throw new Error(root.getSnapshot().lastFrameFailure!);
    if (predicate()) return;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  throw new Error(JSON.stringify({ raster: root.getTextureAssetSnapshot(raster), vt: root.getSnapshot().resources.virtualTextures }));
};
export async function prepare() {
  const source = document.createElement('canvas'); source.width = source.height = 2048;
  const context = source.getContext('2d')!; context.fillStyle = '#ff0000'; context.fillRect(0, 0, 2048, 2048);
  uri = URL.createObjectURL(await new Promise<Blob>(resolve => source.toBlob(blob => resolve(blob!), 'image/png')));
  source.width = source.height = 1;
  raster = imageTexture(uri); native = virtualTexture('/budget-native.json');
  root.setSize({ cssWidth: 512, cssHeight: 512, pixelRatio: 1 });
  root.setScene(scene({ camera: perspectiveCamera({ position: [0, 0, 4] }), nodes: [
    mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: raster }) }),
    mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: native }), transform: { position: [10, 0, 0] } }),
  ] }));
  await settle(() => {
    const state = root.getTextureAssetSnapshot(raster);
    return state.status === 'ready' && state.width < 2048 && root.getSnapshot().resources.virtualTextures.residentPages > 0;
  });
  before = { raster: root.getTextureAssetSnapshot(raster), vt: root.getSnapshot().resources.virtualTextures };
}
export async function run() {
  release();
  await settle(() => {
    const state = root.getTextureAssetSnapshot(raster), vt = root.getSnapshot().resources.virtualTextures;
    return root.getVirtualTextureAssetSnapshot(native).status === 'unsupported'
      && state.status === 'ready' && state.width === 2048 && vt.residentPages > 0 && vt.pendingPages === 0;
  });
  const pixel = new Uint8Array(4); gl.readPixels(256, 256, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  if (pixel[0]! < 250 || pixel[1]! > 2 || pixel[2]! > 2 || gl.getError() !== gl.NO_ERROR) throw new Error(`Bad restored raster pixel: ${pixel}`);
  return { before, after: { raster: root.getTextureAssetSnapshot(raster), vt: root.getSnapshot().resources.virtualTextures }, pixel: [...pixel],
    note: 'ASTC support deliberately hidden; manifest held until fitted PNG has automatic VT residency. Verifies transport independence, lease release, full-size re-decode and GPU publication.' };
}
export function cleanup() { release(); root.dispose(); URL.revokeObjectURL(uri); globalThis.fetch = originalFetch; }
