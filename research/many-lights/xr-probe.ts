import { createRendererRoot } from '../../packages/renderer-webgl/src/index';
import { createWebXrSessionRenderer, type XrSession, type XrFrame } from '../../packages/renderer-webgl/src/xr';
import { boxGeometry, directionalLight, mesh, perspectiveCamera, pointLight, scene, standardMaterial } from '../../packages/renderer-core/src/index';

type FrameCallback = (time: number, frame: XrFrame) => void;
type FrameSession = XrSession & { end(): Promise<void>; visibilityState: string; requestAnimationFrame(callback: FrameCallback): number };

/** Invoked with a real user gesture in the connected headset's research tab. */
export const runXrProbe = async ({ counts = [4, 16, 64, 128, 256, 512], durationMs = 3000, scale = 1 } = {}) => {
  const xr = (navigator as Navigator & { xr?: { requestSession(mode: string): Promise<FrameSession> } }).xr;
  if (xr === undefined) throw new Error('WebXR unavailable');
  let requestExpired = false;
  const pendingSession = xr.requestSession('immersive-vr');
  void pendingSession.then(session => { if (requestExpired) void session.end(); }, () => {});
  let requestTimeout: ReturnType<typeof setTimeout> | undefined;
  const session = await Promise.race([
    pendingSession,
    new Promise<never>((_, reject) => { requestTimeout = setTimeout(() => {
      requestExpired = true;
      reject(new Error('Immersive session request timed out; check headset tracking and prompts'));
    }, 30000); }),
  ]).finally(() => clearTimeout(requestTimeout));
  const canvas = document.createElement('canvas'); document.body.append(canvas);
  const root = createRendererRoot(canvas, { antialias: true });
  const shape = mesh({ geometry: boxGeometry(1.5), transform: { position: [0, 0, -2] }, material: standardMaterial({ color: [0.7, 0.4, 0.2, 1], roughness: 0.6 }) });
  let renderer: Awaited<ReturnType<typeof createWebXrSessionRenderer>> | undefined;
  const results: unknown[] = [];
  const percentile = (values: number[], p: number) => values.slice().sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];
  try {
    renderer = await createWebXrSessionRenderer(root, session, { referenceSpacePreference: ['viewer'], preferredFrameRate: 72, webGlLayer: { framebufferScaleFactor: scale } });
    for (const local of [false, true]) for (const count of counts) {
      root.setScene(scene({ camera: perspectiveCamera({}), nodes: [shape, ...Array.from({ length: count }, () => local
        ? pointLight({ position: [0, 1, 0], intensityCandela: 4 / count })
        : directionalLight({ direction: [0, -0.6, -0.8], illuminanceLux: 1 / count }))] }));
      const intervals: number[] = [], submissions: number[] = [];
      let previous: number | undefined, started: number | undefined, frames = 0;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('XR frame delivery timed out')), 30000);
        const onFrame: FrameCallback = (time, frame) => {
          try {
            started ??= time;
            const begin = performance.now();
            if (renderer!.renderFrame(frame)) frames++;
            const end = performance.now();
            if (time-started > 500 && previous !== undefined) { intervals.push(time-previous); submissions.push(end-begin); }
            previous = time;
            if (root.getSnapshot().lastFrameFailure) throw new Error(root.getSnapshot().lastFrameFailure);
            if (time-started < durationMs+500) session.requestAnimationFrame(onFrame);
            else { clearTimeout(timeout); resolve(); }
          } catch (error) { clearTimeout(timeout); reject(error); }
        };
        session.requestAnimationFrame(onFrame);
      });
      if (frames === 0 || intervals.length === 0) throw new Error('No measurable XR frames');
      results.push({ kind: local ? 'point' : 'directional', count, frames, visibility: session.visibilityState,
        intervalMs: { median: percentile(intervals,0.5), p95: percentile(intervals,0.95) },
        submissionMs: { median: percentile(submissions,0.5), p95: percentile(submissions,0.95) },
        resources: root.getSnapshot().resources });
    }
    return { date: new Date().toISOString(), scale, width: renderer.layer.framebufferWidth, height: renderer.layer.framebufferHeight, results };
  } finally { renderer?.dispose(); root.dispose(); canvas.remove(); await session.end(); }
};
