import { createCameraViewResource, imageTexture, mesh, perspectiveCamera, planeGeometry, scene, triangleGeometry, unlitMaterial, virtualTexture } from '../../packages/renderer-core/src/index.ts';
import { createRendererRoot } from '../../packages/renderer-webgl/src/index.ts';

const base = '/research/vt-comparison/generated/';
const pause = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const stats = (values: Float64Array) => {
  const sorted = values.slice().sort();
  return { median: sorted[sorted.length >> 1], p95: sorted[Math.floor(sorted.length * .95)], max: sorted[sorted.length - 1] };
};
const heap = () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
const denseGeometry = () => {
  const positions = [], uvs = [], indices = [];
  for (let y = 0; y <= 100; y++) for (let x = 0; x <= 100; x++) {
    positions.push(x / 50 - 1, y / 50 - 1, 0); uvs.push(x / 100, 1 - y / 100);
  }
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
    const i = y * 101 + x; indices.push(i, i + 1, i + 102, i, i + 102, i + 101);
  }
  return triangleGeometry({ positions, textureCoordinates: uvs, indices });
};

export async function runSceneBenchmarks() {
  const params = new URLSearchParams(location.search);
  const cases = params.get('case')?.split(',') ?? ['zoom', 'oblique', 'hidden', 'raster', 'svg', 'astc-6x6', 'astc-8x8'];
  const results = [];
  for (const name of cases) for (const minFilter of ['linear-mipmap-nearest', 'linear-mipmap-linear'] as const) {
    const canvas = document.createElement('canvas');
    document.querySelector('#canvases')!.append(canvas);
    const root = createRendererRoot(canvas, { antialias: false, persistentGpuByteBudget: 64 * 1024 * 1024 });
    const gl = canvas.getContext('webgl2')!;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const astc = name.startsWith('astc');
    const supported = !astc || gl.getExtension('WEBGL_compressed_texture_astc') !== null;
    const sampler = { minFilter, magFilter: 'linear' as const };
    const texture = name === 'raster' || name === 'svg'
      ? imageTexture({ src: base + (name === 'svg' ? 'artwork.svg' : 'artwork.png'), sampler })
      : virtualTexture({ manifestUri: base + (astc ? name : 'image') + '/manifest.json', sampler });
    const camera = createCameraViewResource(perspectiveCamera({ position: [0, 0, 4] }));
    const geometry = name === 'overdraw' ? triangleGeometry({
      positions: [-1,-1,0, 1,-1,0, 1,1,0, -1,1,0],
      textureCoordinates: [0,1, 1,1, 1,0, 0,0],
      indices: Array.from({ length: 60000 }, (_, i) => [0,1,2,0,2,3][i % 6]!),
    }) : name === 'hidden' || name === 'dense' ? denseGeometry() : planeGeometry(2);
    const artwork = mesh({ geometry, material: unlitMaterial({ texture }),
      ...(name === 'oblique' ? { transform: { rotation: [0, 1.15, 0] as const } } : {}) });
    const nodes = name === 'hidden' || name === 'overdraw'
      ? [mesh({ geometry: planeGeometry(3), material: unlitMaterial({ color: [0.2, .3, .4, 1] }), transform: { position: [0, 0, .5] } }), artwork]
      : [artwork];
    performance.clearResourceTimings();
    const heapBefore = heap();
    const start = performance.now();
    let firstPresentedMs: number | undefined;
    let readyMs: number | undefined;
    try {
      root.setSize({ cssWidth: 512, cssHeight: 512, pixelRatio: 1 });
      root.setScene(scene({ camera, nodes, clearColor: [0, 0, 0, 1] }));
      for (let i = 0; i < 600; i++) {
        root.flushInvalidated();
        const state = root.getSnapshot();
        if (state.lastFrameFailure) throw new Error(state.lastFrameFailure);
        const vt = state.resources.virtualTextures;
        if (firstPresentedMs === undefined && vt.residentPages > 0) firstPresentedMs = performance.now() - start;
        if ((vt.residentPages > 0 && vt.pendingPages === 0 && vt.unresidentPages === 0)
          || (!supported && i > 20)) { readyMs = performance.now() - start; break; }
        await pause();
      }
      if (readyMs === undefined) throw new Error(`Scene did not settle: ${name} ${JSON.stringify(root.getSnapshot())}`);
      const steady = root.getSnapshot();
      const beforeRequests = steady.resources.virtualTextures.pageRequests;
      const submitMs = new Float64Array(90), intervalMs = new Float64Array(90);
      let previous = performance.now(), peakAtlasBytes = 0, peakDecodedBytes = 0, maxMissing = 0;
      for (let i = -15; i < 90; i++) {
        await pause();
        const now = performance.now();
        if (i >= 0) intervalMs[i] = now - previous;
        previous = now;
        const t = (i + 15) / 12;
        camera.position[2] = name === 'zoom' || name === 'svg' ? 2.8 + 2 * Math.sin(t) : 4 + .3 * Math.sin(t);
        camera.position[0] = .08 * Math.cos(t);
        const begin = performance.now(); camera.commit(); root.flushInvalidated();
        if (i >= 0) submitMs[i] = performance.now() - begin;
        // Snapshots are deliberately outside the submission timer. Their cost
        // remains included in frame intervals and aggregate GC measurements.
        const state = root.getSnapshot();
        if (state.lastFrameFailure) throw new Error(state.lastFrameFailure);
        peakAtlasBytes = Math.max(peakAtlasBytes, state.resources.virtualTextures.atlasBytes);
        peakDecodedBytes = Math.max(peakDecodedBytes, state.resources.virtualTextures.automaticDecodedBytes);
        maxMissing = Math.max(maxMissing, state.resources.virtualTextures.unresidentPages);
      }
      camera.position[0] = 0; camera.position[2] = 4; camera.commit();
      for (let i = 0; i < 300; i++) {
        root.flushInvalidated(); await pause();
        const vt = root.getSnapshot().resources.virtualTextures;
        if (vt.pendingPages === 0 && vt.unresidentPages === 0) break;
      }
      root.invalidate(); root.flushInvalidated();
      const pixel = new Uint8Array(4); gl.readPixels(200, 200, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      if (gl.getError() !== gl.NO_ERROR) throw new Error(`GL error in ${name}`);
      const final = root.getSnapshot();
      if (supported && final.resources.virtualTextures.failedPages > 0) throw new Error(`Page failure in ${name}`);
      if (supported && final.resources.virtualTextures.unresidentPages > 0) throw new Error(`Unsettled detail in ${name}`);
      if (!supported && final.resources.virtualTextures.pageRequests > 0) throw new Error('Unsupported ASTC fetched pages');
      const requests = performance.getEntriesByType('resource').filter(e => e.name.includes('/generated/')) as PerformanceResourceTiming[];
      results.push({ name, minFilter, renderer, supported, firstPresentedMs, readyMs,
        submissionMs: stats(submitMs), frameIntervalMs: stats(intervalMs),
        movedPageRequests: final.resources.virtualTextures.pageRequests - beforeRequests,
        peakAtlasBytes, peakDecodedBytes, maxMissing,
        transport: { requests: requests.length, transferredBytes: requests.reduce((s, e) => s + e.transferSize, 0), bodyBytes: requests.reduce((s, e) => s + e.encodedBodySize, 0) },
        heapBefore, heapLive: heap(), pixel: [...pixel], screenshot: canvas.toDataURL('image/png'), final: final.resources.virtualTextures });
      console.info(`VT scene complete: ${name} ${minFilter}`);
    } finally { root.dispose(); canvas.remove(); gl.getExtension('WEBGL_lose_context')?.loseContext(); }
  }
  return { userAgent: navigator.userAgent, results, note: '512x512 real renderer scenes; rAF intervals include host scheduling and cold diagnostics. Local HTTP transport; no mobile claims.' };
}
