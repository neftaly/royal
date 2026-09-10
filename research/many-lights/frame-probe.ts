import { createRendererRoot } from '../../packages/renderer-webgl/src/index';
import { captureImage } from '../../packages/renderer-webgl/src/capture';
import { boxGeometry, directionalLight, mesh, orthographicCamera, pointLight, scene, standardMaterial } from '../../packages/renderer-core/src/index';
import type { RenderObjectRefObject } from '../../packages/renderer-core/src/render-object';

const stats = (values: number[]) => {
  const ordered = values.slice().sort((a, b) => a - b);
  return { median: ordered[Math.floor(ordered.length / 2)], p95: ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95))], samples: values.length };
};

/** End-to-end RAF pacing with an animated opaque object; not a GPU timer query. */
export const runFrames = async ({ sizes = [512, 1024], counts = [4, 16, 64, 128, 256, 512], durationMs = 3000, antialias = true } = {}) => {
  const canvas = document.createElement('canvas'); document.body.append(canvas);
  const root = createRendererRoot(canvas, { antialias });
  const ref: RenderObjectRefObject = { current: null };
  const shape = mesh({ geometry: boxGeometry(1.5), material: standardMaterial({ color: [0.7, 0.4, 0.2, 1], roughness: 0.6 }), ref });
  const camera = orthographicCamera({ left: -1, right: 1, bottom: -1, top: 1, position: [0, 0, 4] });
  const results = [];
  const raf = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
  try {
    for (const size of sizes) for (const local of [false, true]) for (const count of counts) {
      document.querySelector('#status')?.replaceChildren(`Frames ${size} ${local ? 'point' : 'directional'} ${count}`);
      root.setSize({ cssWidth: size, cssHeight: size, pixelRatio: 1 });
      root.setScene(scene({ camera, nodes: [shape, ...Array.from({ length: count }, () => local
        ? pointLight({ position: [0, 1, 3], intensityCandela: 4 / count })
        : directionalLight({ direction: [0, -0.6, -0.8], illuminanceLux: 1 / count }))] }));
      await captureImage(root, { timeoutMs: 30000 });
      const intervals: number[] = [], submissions: number[] = [];
      const started = performance.now(); let previous: number | undefined; let frame = 0;
      while (performance.now() - started < durationMs + 500) {
        const time = await raf();
        const begin = performance.now();
        ref.current!.rotation.y = Math.sin(frame++ * 0.025) * 0.5;
        root.flushInvalidated();
        const end = performance.now();
        if (end - started >= 500 && previous !== undefined) { intervals.push(time - previous); submissions.push(end - begin); }
        previous = time;
        if (root.getSnapshot().lastFrameFailure) throw new Error(root.getSnapshot().lastFrameFailure);
      }
      results.push({ size, kind: local ? 'point' : 'directional', count, intervalMs: stats(intervals), submissionMs: stats(submissions), resources: root.getSnapshot().resources });
    }
    return { date: new Date().toISOString(), userAgent: navigator.userAgent, antialias, results };
  } finally { root.dispose(); canvas.remove(); }
};
