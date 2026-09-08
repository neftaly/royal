/** Deterministic native VT lifecycle stress fixture; no application assets needed. */
export async function runVtSoak(renderer, core, { cycles = 3, dwellMs = 6000, budgetMiB = 16, sharedPool = false } = {}) {
  const canvas = document.querySelector('canvas');
  const report = window.probe = { info: { cycles, dwellMs, budgetMiB, sharedPool, userAgent: navigator.userAgent }, samples: [], phases: [], errors: [], done: false };
  const urls = [];
  const onError = event => report.errors.push(String(event.message ?? event.reason));
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onError);
  const root = renderer.createRendererRoot(canvas, { persistentGpuByteBudget: budgetMiB * 1024 * 1024 });
  window.probeRoot = root;
  root.setSize({ cssWidth: 768, cssHeight: 768, pixelRatio: 2 });
  const assets = (sharedPool ? [128, 128] : [128, 256]).map((pageSize, index) => {
    const page = document.createElement('canvas');
    page.width = page.height = pageSize + 4;
    const context = page.getContext('2d');
    context.fillStyle = index ? '#30cc70' : '#e85040';
    context.fillRect(0, 0, page.width, page.height);
    context.fillStyle = '#111';
    context.font = `${pageSize / 8}px sans-serif`;
    context.fillText(`Pool ${index + 1}`, 10, pageSize / 2);
    const uri = URL.createObjectURL(new Blob([JSON.stringify({
      contractVersion: 2, pageSize, borderTexels: 2, virtualSize: [4096, 4096],
      pages: { uriTemplate: page.toDataURL() + '#{page}' },
    })], { type: 'application/json' }));
    urls.push(uri);
    return core.virtualTexture(uri);
  });
  const makeNodes = (which) => which.map(index => core.mesh({
    geometry: core.planeGeometry(2), material: core.unlitMaterial({ texture: assets[index] }),
    transform: { position: [which.length === 1 ? 0 : index ? 0.8 : -0.8, 0, 0] },
  }));
  const started = performance.now();
  let phase = 'initial';
  let maxGap = 0;
  let previous = started;
  let raf;
  const tick = time => { maxGap = Math.max(maxGap, time - previous); previous = time; raf = requestAnimationFrame(tick); };
  raf = requestAnimationFrame(tick);
  const sample = () => {
    const s = root.getSnapshot();
    const value = { ms: performance.now() - started, phase, frame: s.frame,
      vt: s.resources.virtualTextures, gpu: s.resources.persistentGpu, context: s.context,
      assets: assets.map(asset => root.getVirtualTextureAssetSnapshot(asset)), failure: s.lastFrameFailure, maxGap };
    report.samples.push(value);
    if (value.gpu.retainedBytes > value.gpu.budgetBytes) report.errors.push('Root budget exceeded');
    for (const asset of value.assets) if (asset.error && !report.errors.includes(asset.error)) report.errors.push(asset.error);
    if (value.vt.failedPages || value.vt.atlasGrowthFailures || value.context.interruptions) report.errors.push('Page, migration, or context failure');
    if (value.failure) report.errors.push(String(value.failure));
    document.querySelector('pre').textContent = JSON.stringify({ phase, ...value.vt }, null, 2);
    return value;
  };
  const interval = setInterval(sample, 500);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let visible = [];
  const set = (name, which, extent, pan = 0) => {
    if (visible.length > 0) {
      const end = sample();
      for (const index of visible) if (end.assets[index].residentPages === 0) report.errors.push(`${phase}: pool ${index} has no coverage`);
    }
    visible = which;
    phase = name;
    report.phases.push({ name, ms: performance.now() - started });
    root.setScene(core.scene({ clearColor: [0.04, 0.04, 0.04, 1],
      camera: core.orthographicCamera({ left: -extent, right: extent, bottom: -extent, top: extent, position: [pan, 0, 3] }),
      nodes: makeNodes(which),
    }));
  };
  try {
    for (let cycle = 0; cycle < cycles; cycle++) {
      set(`${cycle}:first-only`, [0], 0.6);
      await sleep(dwellMs);
      set(`${cycle}:both`, [0, 1], 0.9);
      await sleep(dwellMs);
      set(`${cycle}:pan`, [0, 1], 0.6, 0.5);
      await sleep(dwellMs);
      set(`${cycle}:overview`, [0, 1], 4);
      await sleep(dwellMs);
      // Reverse which pool arrives first after clearing the scene.
      set(`${cycle}:empty`, [], 1);
      await sleep(500);
      sample();
      set(`${cycle}:second-only`, [1], 0.6);
      await sleep(dwellMs);
      set(`${cycle}:reverse-both`, [1, 0], 0.9);
      await sleep(dwellMs);
    }
    if (!report.samples.some(s => s.vt.atlasPools === (sharedPool ? 1 : 2) && s.assets.every(asset => asset.residentPages > 0))) report.errors.push('Fixture did not populate both textures');
    set('final-empty', [], 1);
    await sleep(1000);
    const empty = sample();
    if (empty.vt.atlasBytes !== 0 || empty.vt.pendingPages !== 0 || empty.gpu.retainedBytes !== 0) report.errors.push('VT resources retained after scene removal');
    const frame = empty.frame;
    await sleep(2500);
    report.idleFrameDelta = sample().frame - frame;
    if (report.idleFrameDelta !== 0) report.errors.push('Empty renderer did not settle');
  } catch (error) {
    report.errors.push(String(error));
  } finally {
    clearInterval(interval);
    cancelAnimationFrame(raf);
    root.dispose();
    report.disposedGpu = root.getSnapshot().resources.persistentGpu;
    if (report.disposedGpu.retainedBytes !== 0) report.errors.push('GPU claims retained after disposal');
    urls.forEach(url => URL.revokeObjectURL(url));
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onError);
    report.done = true;
  }
  return report;
}
