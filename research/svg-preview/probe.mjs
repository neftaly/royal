/** Run through the literal root pnpm dev server with the public renderer/core modules. */
export async function runSvgPreviewProbe(renderer, core, mode = 'refine') {
  const failDetail = mode === 'fail' || mode === 'fail-restore';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:384px;height:384px;position:fixed;left:0;top:0;z-index:9999';
  document.body.append(canvas);
  const reads = [];
  let release;
  let detailSignal;
  const gate = new Promise((resolve) => { release = resolve; });
  const root = renderer.createRendererRoot(canvas, {}, {
    gltfResourceReader: async (resource, signal) => {
      reads.push(resource.uri);
      if (resource.uri.endsWith('.svg')) {
        detailSignal = signal;
        await Promise.race([
          gate,
          new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })),
        ]);
        if (failDetail) throw new Error('Injected optional SVG detail failure');
      }
      const response = await fetch(resource.uri, { signal });
      if (!response.ok) throw new Error(`Fixture read failed: ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  });
  const wait = async (predicate, label) => {
    const deadline = performance.now() + 20000;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error(`Timed out: ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const snapshot = () => root.getSnapshot();
  const capture = () => {
    root.invalidate();
    root.flushInvalidated();
    const gl = canvas.getContext('webgl2');
    const bytes = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    let colored = 0;
    for (let i = 0; i < bytes.length; i += 4) if (Math.max(bytes[i], bytes[i + 1], bytes[i + 2]) - Math.min(bytes[i], bytes[i + 1], bytes[i + 2]) > 15) colored++;
    if (gl.getError() !== gl.NO_ERROR) throw new Error('Native WebGL error');
    if (colored < 100) throw new Error(`Expected complete colored preview, got ${colored} pixels`);
    return { colored, bytes };
  };
  try {
    const model = core.gltf({ src: '/fixtures/gltf-svg-texture/ghostscript-tiger-card.gltf' });
    root.setSize({ cssHeight: 384, cssWidth: 384, pixelRatio: 1 });
    root.setScene(core.scene({
      camera: core.perspectiveCamera({ position: [0, 0, 0.4] }),
      clearColor: [0, 0, 0, 1], nodes: [model],
    }));
    await wait(() => detailSignal !== undefined && snapshot().resources.virtualTextures.residentPages > 0, 'preview coverage while SVG read is held');
    const preview = capture();
    const initial = snapshot();
    if (mode === 'dispose') {
      root.dispose();
      await wait(() => detailSignal.aborted, 'last-claim cancellation');
      return { mode, previewPixels: preview.colored, aborted: true, reads };
    }
    release();
    await wait(() => {
      const vt = snapshot().resources.virtualTextures;
      return vt.pendingPages === 0 && (failDetail ? vt.failedPages > 0 : vt.residentPages > 1);
    }, 'detail settlement');
    const final = capture();
    const settled = snapshot();
    if (settled.lastFrameFailure !== undefined || settled.resources.persistentGpu.deniedClaims !== 0) throw new Error('Unexpected renderer failure or denial');
    if (failDetail && preview.bytes.some((value, index) => value !== final.bytes[index])) throw new Error('Detail failure changed usable preview pixels');
    if (mode === 'restore' || mode === 'fail-restore') {
      const extension = canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
      if (extension === null) throw new Error('Context restoration probe unavailable');
      extension.loseContext();
      await wait(() => snapshot().context.phase !== 'active', 'context loss');
      extension.restoreContext();
      await wait(() => snapshot().context.phase === 'active' && snapshot().resources.virtualTextures.residentPages > 0, 'restored coarse coverage');
      const restored = capture();
      if (failDetail && preview.bytes.some((value, index) => value !== restored.bytes[index])) throw new Error('Restoration changed usable preview pixels');
    }
    return {
      mode, previewPixels: preview.colored, finalPixels: final.colored, reads,
      initial: initial.resources.virtualTextures, final: settled.resources.virtualTextures,
      context: snapshot().context,
      restored: snapshot().resources.virtualTextures,
    };
  } finally {
    release();
    root.dispose();
    canvas.remove();
  }
}
