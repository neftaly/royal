(() => {
  if (window.__royalZoomProbe?.running) return 'already running';
  const canvas = document.querySelector('canvas');
  if (!canvas || !window.__royalExamplesRendererBenchmarkSnapshot) throw new Error('Renderer not ready');
  canvas.scrollIntoView();
  const gl = canvas.getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const report = window.__royalZoomProbe = {
    running: true, startedAt: new Date().toISOString(), userAgent: navigator.userAgent,
    gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    source: window.__ROYAL_EXAMPLES_SOURCE__, pixelRatio: devicePixelRatio,
    canvas: { width: canvas.width, height: canvas.height }, runs: [],
  };
  const snapshot = () => window.__royalExamplesRendererBenchmarkSnapshot().virtualTexturing;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const zoom = async (name, deltaY) => {
    const before = snapshot();
    const distanceBefore = canvas.dataset.vtDistance;
    const rect = canvas.getBoundingClientRect();
    const start = performance.now();
    const run = { name, deltaY, before, distanceBefore, frames: 0, samples: [] };
    report.runs.push(run);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY, deltaMode: 0,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
      bubbles: true, cancelable: true }));
    let previous = start;
    run.maxFrameGapMs = 0;
    for (;;) {
      await new Promise(requestAnimationFrame);
      const now = performance.now();
      run.frames++;
      run.maxFrameGapMs = Math.max(run.maxFrameGapMs, now - previous);
      previous = now;
      const vt = snapshot();
      const ms = now - start;
      if (vt.pageRequests > before.pageRequests) run.firstRequestMs ??= ms;
      if (vt.uploadedPages > before.uploadedPages) run.firstUploadMs ??= ms;
      run.samples.push({ ms, desiredPages: vt.desiredPages, admittedPages: vt.admittedPages,
        unresidentPages: vt.unresidentPages, pendingPages: vt.pendingPages,
        uploadedPages: vt.uploadedPages, atlasBytes: vt.atlasBytes });
      if (vt.desiredPages === vt.admittedPages && vt.pendingPages === 0 && vt.unresidentPages === 0) {
        run.settledMs = ms; run.after = vt; run.distanceAfter = canvas.dataset.vtDistance; return;
      }
      if (ms > 15000) throw new Error(`${name} did not settle within 15s`);
    }
  };
  void (async () => {
    await zoom('cold zoom in', -500);
    for (let i=1; i<=3; i++) {
      await zoom(`rapid zoom out ${i}`, 500);
      await sleep(250);
      await zoom(`rapid zoom in ${i}`, -500);
    }
    await zoom('zoom out before idle', 500);
    await sleep(35000);
    await zoom('zoom in after 35s idle', -500);
  })().catch(error => {report.error=String(error);}).finally(() => {
    report.running=false; report.finishedAt=new Date().toISOString();
  });
  return 'started';
})()
