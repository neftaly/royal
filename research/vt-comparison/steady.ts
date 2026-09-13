import { createKtx2Fixture } from '../../tests/replacement/support/ktx2-fixture.ts';
import { createCameraViewResource, imageTexture, mesh, perspectiveCamera, planeGeometry, scene, unlitMaterial, virtualTexture } from '../../packages/renderer-core/src/index.ts';
import { createRendererRoot } from '../../packages/renderer-webgl/src/index.ts';

const params = new URLSearchParams(location.search);
const kind = params.get('case') ?? 'svg';
const moving = params.get('motion') === 'move';
const copies = Math.max(1, Math.min(16, Math.floor(Number(params.get('copies'))) || 1));
const budgetMiB = Math.max(16, Math.min(256, Math.floor(Number(params.get('budget'))) || 64));
const frameCount = Math.max(120, Math.min(1200, Math.floor(Number(params.get('frames'))) || 600));
const canvas = document.createElement('canvas'); document.body.append(canvas);
const root = createRendererRoot(canvas, { antialias: false, persistentGpuByteBudget: budgetMiB * 1024 * 1024 });
const gl = canvas.getContext('webgl2')!;
const tableUploads = { calls: 0, bytes: 0 };
if (params.has('count-table-uploads')) {
  let active: number = gl.TEXTURE0;
  const activate = gl.activeTexture.bind(gl), upload = gl.texSubImage2D.bind(gl);
  gl.activeTexture = unit => { active = unit; activate(unit); };
  gl.texSubImage2D = ((...args: unknown[]) => {
    if (active === gl.TEXTURE5 && args.length === 9 && args[8] instanceof Uint8Array) {
      tableUploads.calls++; tableUploads.bytes += args[8].byteLength;
    }
    Reflect.apply(upload, gl, args);
  }) as typeof gl.texSubImage2D;
}
const camera = createCameraViewResource(perspectiveCamera({ position: [0, 0, 4] }));
const sampler = { minFilter: 'linear-mipmap-linear', magFilter: 'linear', wrapS: 'clamp-to-edge', wrapT: 'clamp-to-edge' } as const;
const base = '/research/vt-comparison/generated/';
const mixed = kind === 'mixed';
const nativeFirst = params.has('native-first');
const astc = params.get('astc') === '6x6' ? 'astc-6x6' : 'astc-8x8';
const nativePadding = params.has('native-padding');
let paddedPageReads = 0;
const failAutomatic = mixed && params.has('fail-automatic');
const failNative = mixed && params.has('fail-native');
if (failNative && failAutomatic) throw new Error('Choose one failure class');
if (nativePadding && failNative) throw new Error('Choose padded valid pages or failed pages');
if (failNative && astc !== 'astc-8x8') throw new Error('Failure fixtures require ASTC 8x8');
let nativeFailures = 0;
const automaticFailureMode = params.get('fail-automatic') === 'decode' ? 'decode' : 'transport';
const automaticCount = nativeFirst ? Math.floor(copies / 2) : Math.ceil(copies / 2);
const originalFetch = globalThis.fetch;
const delayedClass = mixed ? params.get('gate-source') : null;
if (delayedClass && ((delayedClass !== 'svg' && delayedClass !== 'native') || copies !== 16 || failNative || failAutomatic || nativePadding))
  throw new Error('Source gating requires 16 healthy mixed sources');
let sourceGate: Promise<void> | undefined, gatedReads = 0, gateResidentPages = 0;
let automaticFailures = 0;
if (failAutomatic || failNative || nativePadding || delayedClass) globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if ((delayedClass === 'svg' && url.pathname === base + 'artwork.svg')
    || (delayedClass === 'native' && url.pathname === base + astc + '/manifest.json')) {
    gatedReads++;
    await (sourceGate ??= new Promise<void>((resolve, reject) => {
      let attempts = 0;
      const check = () => {
        const resident = root.getSnapshot().resources.virtualTextures.residentPages;
        if (resident >= (copies / 2) * 21) { gateResidentPages = resident; resolve(); }
        else if (++attempts >= 600) reject(new Error('Other source class did not become resident before gate release'));
        else requestAnimationFrame(check);
      };
      check();
    }));
    if (params.has('stagger-source')) await new Promise(resolve =>
      setTimeout(resolve, Number(url.searchParams.get('copy') ?? 0) * 50));
  }
  if (failAutomatic && url.pathname === base + 'artwork.svg') {
    automaticFailures++;
    return automaticFailureMode === 'decode'
      ? new Response('<svg><', { headers: { 'content-type': 'image/svg+xml' } })
      : new Response('fixture failure', { status: 503 });
  }
  const response = await originalFetch(input, init);
  if (nativePadding && url.pathname.includes(`/${astc}/`) && url.pathname.endsWith('.ktx2')) {
    const bytes = await response.arrayBuffer();
    const padded = new Uint8Array(bytes.byteLength + 1024 * 1024);
    padded.set(new Uint8Array(bytes)); paddedPageReads++;
    return new Response(padded.buffer, { headers: { 'content-type': 'image/ktx2' } });
  }
  if (failNative && url.pathname.includes('/astc-8x8/') && url.pathname.endsWith('.ktx2')) {
    nativeFailures++;
    const bytes = await response.arrayBuffer();
    const defect = params.get('fail-native');
    if (defect === 'format' || defect === 'width' || defect === 'height' || defect === 'mips') {
      return new Response(createKtx2Fixture(defect === 'format' ? 166 : 172,
        defect === 'width' ? 72 : 144, defect === 'height' ? 72 : 144, defect === 'mips' ? 2 : 1).buffer as ArrayBuffer,
        { headers: { 'content-type': 'image/ktx2' } });
    }
    if (defect === 'color-space') {
      const header = new DataView(bytes);
      header.setUint32(12, 171, true);
      header.setUint8(header.getUint32(48, true) + 14, 1);
      return new Response(bytes, { headers: { 'content-type': 'image/ktx2' } });
    }
    return new Response(bytes.slice(0, bytes.byteLength - 16), { headers: { 'content-type': 'image/ktx2' } });
  }
  return response;
};
if (mixed && copies < 2) throw new Error('Mixed VT requires at least two resources');
const textures = Array.from({ length: copies }, (_, index) => {
  const sourceKind = mixed ? (index % 2 === (nativeFirst ? 0 : 1) ? 'astc' : 'svg') : kind;
  return sourceKind === 'svg' || sourceKind === 'raster' ? imageTexture({ src: base + (sourceKind === 'svg' ? 'artwork.svg' : 'artwork.png') + (copies > 1 ? `?copy=${index}` : ''), sampler })
    : virtualTexture({ manifestUri: base + (sourceKind === 'astc' ? astc : 'image') + '/manifest.json' + (copies > 1 ? `?copy=${index}` : ''), sampler });
});
const submissions = new Float64Array(frameCount), intervals = new Float64Array(frameCount);
const pause = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const pose = (frame: number) => {
  camera.position[0] = .06 * Math.sin(frame * Math.PI / 60);
  camera.position[2] = 4 + .15 * Math.cos(frame * Math.PI / 60);
  camera.commit();
};
const stats = (values: Float64Array) => {
  const sorted = values.slice().sort();
  return { median: sorted[sorted.length >> 1], p95: sorted[Math.floor(sorted.length * .95)], max: sorted[sorted.length - 1] };
};
let before: ReturnType<typeof root.getSnapshot>['resources']['virtualTextures'];
let beforeContextLoss: typeof before | undefined;

export async function prepareSteadyVT() {
  root.setSize({ cssWidth: 512, cssHeight: 512, pixelRatio: 1 });
  root.setScene(scene({ camera, nodes: textures.map((texture, index) => mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture }),
    ...((failAutomatic || failNative) ? { transform: { position: [(index % 2 === (nativeFirst ? 0 : 1)) === failNative ? 1.2 : 0, 0, 0] as const, scale: [0.5, 0.5, 0.5] as const } } : {}),
  })), clearColor: [0, 0, 0, 1] }));
  const settle = async (requireNoUnresident = false) => {
    for (let attempt = 0; attempt < 600; attempt++) {
      root.invalidate(); root.flushInvalidated(); await pause();
      const state = root.getSnapshot();
      if (state.lastFrameFailure) throw new Error(state.lastFrameFailure);
      const vt = state.resources.virtualTextures;
      if (delayedClass && (gateResidentPages === 0 || gatedReads < copies / 2 || vt.desiredPages !== copies * 21 || vt.automaticWaiting !== 0)) continue;
      if (params.has('require-full-demand') && vt.admittedPages !== vt.desiredPages) continue;
      if (vt.residentPages > 0 && vt.pendingPages === 0 && (vt.unresidentPages === 0 || (!requireNoUnresident && failNative && vt.unresidentPages === vt.failedPages))) return;
    }
    throw new Error(`Warm-up did not settle: ${kind}: ${JSON.stringify({
      resources: root.getSnapshot().resources,
      assets: textures.map(texture => texture.kind === 'asset' ? root.getTextureAssetSnapshot(texture) : root.getVirtualTextureAssetSnapshot(texture)),
    })}`);
  };
  await settle();
  if (params.has('restore')) {
    await settle(true);
    beforeContextLoss = root.getSnapshot().resources.virtualTextures;
    const loss = gl.getExtension('WEBGL_lose_context');
    if (!loss) throw new Error('Context-loss extension unavailable');
    const event = (name: string, action: () => void) => new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), 5000);
      canvas.addEventListener(name, event => { event.preventDefault(); clearTimeout(timeout); resolve(); }, { once: true });
      action();
    });
    await event('webglcontextlost', () => loss.loseContext());
    await new Promise(resolve => setTimeout(resolve, 50));
    await event('webglcontextrestored', () => loss.restoreContext());
    await settle();
  }
  for (let frame = 0; frame < 120; frame++) { await pause(); pose(frame); root.flushInvalidated(); }
  pose(0); await settle();
  before = root.getSnapshot().resources.virtualTextures;
  if (mixed && before.atlasPools !== (failAutomatic || failNative ? 1 : 2)) throw new Error(`Mixed VT allocated unexpected pools: ${JSON.stringify(before)}`);
  if (failAutomatic && (before.automaticWaiting !== 0 || before.automaticIneligible !== automaticCount))
    throw new Error('Failed automatic sources retained pending reservations');
}

export function runSteadyVT(): Promise<object> {
  return new Promise((resolve, reject) => {
    let frame = 0, previous = performance.now();
    const tick = (now: number) => {
      try {
        intervals[frame] = now - previous; previous = now;
        const start = performance.now();
        if (moving) pose(frame); else root.invalidate();
        root.flushInvalidated();
        submissions[frame] = performance.now() - start;
        if (++frame < frameCount) requestAnimationFrame(tick); else resolve({});
      } catch (error) { reject(error); }
    };
    requestAnimationFrame(tick);
  });
}

export function finishSteadyVT() {
  // Profiling and GC may outlive the default drawing buffer; redraw outside measurement.
  root.invalidate(); root.flushInvalidated();
  const state = root.getSnapshot();
  if (state.lastFrameFailure || (!failNative && state.resources.virtualTextures.failedPages > 0)) throw new Error('Steady rendering failed');
  if (failNative && (nativeFailures === 0 || state.resources.virtualTextures.failedPages !== nativeFailures
    || state.resources.virtualTextures.atlasPools !== 1 || state.resources.virtualTextures.unresidentPages !== 0))
    throw new Error('Failed native pages retained unusable atlas demand');
  if (nativePadding && paddedPageReads === 0) throw new Error('No padded native pages were read');
  const pixel = new Uint8Array(4); gl.readPixels(256, 256, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  if (pixel[0]! < 250 || pixel[1]! < 250 || pixel[2]! < 250) throw new Error('Steady fixture lost its white center');
  const automaticErrors = failAutomatic ? textures.flatMap(texture => texture.kind === 'asset' ? [root.getTextureAssetSnapshot(texture)] : []) : undefined;
  if (automaticErrors?.some(snapshot => snapshot.status !== 'error')) throw new Error('Expected terminal automatic-source errors');
  if (failAutomatic && automaticFailures !== automaticCount) throw new Error('Failed automatic sources retried transport');
  if (gl.getError() !== gl.NO_ERROR) throw new Error('Steady rendering generated a GL error');
  return { results: [{ name: `steady-${kind}`, minFilter: moving ? 'moving' : 'fixed', copies, budgetMiB, ...(mixed ? { nativeFirst } : {}), frames: frameCount,
    submissionMs: stats(submissions), frameIntervalMs: stats(intervals), before,
    fullDemandRequired: params.has('require-full-demand'),
    ...(delayedClass ? { delayedClass, gatedReads, gateResidentPages, staggered: params.has('stagger-source') } : {}),
    ...(params.has('count-table-uploads') ? { tableUploads } : {}),
    ...(beforeContextLoss === undefined ? {} : { beforeContextLoss }),
    ...(failAutomatic ? { automaticFailures, automaticFailureMode, automaticErrors } : {}),
    ...(failNative ? { nativeFailures, nativeFailureMode: params.get('fail-native') || 'truncated' } : {}),
    ...(nativePadding ? { paddedPageReads, astc, paddingBytesPerPage: 1024 * 1024 } : {}),
    final: state.resources.virtualTextures, pixel: [...pixel], screenshot: canvas.toDataURL() }],
    note: 'Warm-up, snapshots, pixel readback and screenshots are outside the measurement window. Measured frames use camera resource commits or explicit invalidation; One reusable rAF callback and timing calls remain harness overhead. CPU/GPU source owners remain alive through heap measurement.' };
}

export function cleanupSteadyVT() { globalThis.fetch = originalFetch; root.dispose(); canvas.remove(); gl.getExtension('WEBGL_lose_context')?.loseContext(); }
