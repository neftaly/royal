import { imageTexture, mesh, perspectiveCamera, planeGeometry, scene, unlitMaterial } from '../../packages/renderer-core/src/index.ts';
import { createRendererRoot } from '../../packages/renderer-webgl/src/index.ts';

const params = new URLSearchParams(location.search);
const kind = params.get('case') === 'raster' ? 'raster' : 'svg';
const delayed = params.has('delay');
const reuse = params.has('reuse');
const canvas = document.createElement('canvas'); document.body.append(canvas);
const root = createRendererRoot(canvas, { antialias: false, persistentGpuByteBudget: 64 * 1024 * 1024 });
const gl = canvas.getContext('webgl2')!;
const camera = perspectiveCamera({ position: [0, 0, 4] });
const geometry = planeGeometry(2);
const sampler = { minFilter: 'linear-mipmap-linear', magFilter: 'linear', wrapS: 'clamp-to-edge', wrapT: 'clamp-to-edge' } as const;
const nativeFetch = globalThis.fetch;
let serial = 0, activeReads = 0, abortedReads = 0, completed = 0, earlyReplacements = 0;
globalThis.fetch = async (input, init) => {
  const uri = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!uri.includes('vtLifecycle=')) return nativeFetch(input, init);
  activeReads++;
  const aborted = () => { abortedReads++; };
  init?.signal?.addEventListener('abort', aborted, { once: true });
  try {
    if (delayed) await new Promise(resolve => setTimeout(resolve, 100));
    return await nativeFetch(input, init);
  }
  finally { activeReads--; init?.signal?.removeEventListener('abort', aborted); }
};
const tick = async () => { root.invalidate(); root.flushInvalidated(); await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); };
const state = () => {
  const snapshot = root.getSnapshot();
  if (snapshot.lastFrameFailure || snapshot.resources.virtualTextures.failedPages) throw new Error('Lifecycle frame failed');
  return snapshot.resources.virtualTextures;
};
async function cycle(early: boolean) {
  const src = `/research/vt-comparison/generated/artwork.${kind === 'svg' ? 'svg' : 'png'}?vtLifecycle=${reuse ? 0 : ++serial}`;
  root.setScene(scene({ camera, nodes: [mesh({ geometry, material: unlitMaterial({ texture: imageTexture({ src, sampler }) }) })] }));
  if (early) {
    await tick();
    if (delayed) {
      for (let frame = 0; frame < 120 && activeReads === 0; frame++) await tick();
      if (activeReads === 0) throw new Error('Delayed lifecycle read did not start');
    }
    earlyReplacements++;
  }
  else {
    let settled = false;
    for (let frame = 0; frame < 600; frame++) {
      await tick(); const vt = state();
      if (vt.residentPages > 0 && vt.pendingPages === 0 && vt.unresidentPages === 0) { settled = true; break; }
    }
    if (!settled) throw new Error('Lifecycle texture did not become resident');
    completed++;
  }
  root.setScene(scene({ camera, nodes: [] }));
  let released = false;
  for (let frame = 0; frame < 600; frame++) {
    await tick(); const vt = state();
    if (activeReads === 0 && vt.atlasBytes === 0 && vt.residentPages === 0 && vt.pendingPages === 0
      && vt.automaticResources === 0 && vt.automaticDecodedBytes === 0) { released = true; break; }
  }
  if (!released) throw new Error('Lifecycle resource remained claimed after scene removal');
  await tick(); await tick();
  if (gl.getError() !== gl.NO_ERROR) throw new Error('Lifecycle GL error');
}
export async function prepareLifecycle() {
  root.setSize({ cssWidth: 512, cssHeight: 512, pixelRatio: 1 });
  for (let i = 0; i < 4; i++) await cycle(i % 2 === 1);
  completed = earlyReplacements = abortedReads = 0;
}
export async function runLifecycle() {
  for (let i = 0; i < 8; i++) await cycle(i % 4 === 3);
  if (delayed && abortedReads === 0) throw new Error('Delayed lifecycle fixture did not exercise source cancellation');
  return {};
}
export function finishLifecycle() {
  return { results: [{ name: `lifecycle-${kind}`, minFilter: 'linear-mipmap-linear', completed, earlyReplacements, abortedReads, activeReads, delayed, reuse, final: state() }],
    note: 'One live root repeatedly loads source URLs (unique by default, fixed with reuse=1) and removes its scene. Six resident loads and two early replacements per window; forced-GC samples occur with an empty scene. Early replacement is not a guaranteed transport abort. Fetch counts end at response headers, not body consumption. Snapshot/GL checks are intentional lifecycle harness overhead, not frame timing measurements.' };
}
export function cleanupLifecycle() { root.dispose(); canvas.remove(); gl.getExtension('WEBGL_lose_context')?.loseContext(); globalThis.fetch = nativeFetch; }
