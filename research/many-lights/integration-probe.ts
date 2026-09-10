import { captureImage } from '../../packages/renderer-webgl/src/capture';
import { createRendererRoot } from '../../packages/renderer-webgl/src/index';
import { boxGeometry, directionalLight, mesh, orthographicCamera, pointLight, spotLight, scene, standardMaterial } from '../../packages/renderer-core/src/index';

export const runIntegration = async ({ mixedCopies = [1, 64, 128, 2, 128], rootFactory = createRendererRoot, captureFactory = captureImage, onSmallReady }: { mixedCopies?: number[], rootFactory?: typeof createRendererRoot, captureFactory?: typeof captureImage, onSmallReady?: () => void } = {}) => {
  const canvas = document.createElement('canvas'); document.body.append(canvas);
  const root = rootFactory(canvas, { alpha: true, antialias: true });
  const shape = mesh({ geometry: boxGeometry(1), material: standardMaterial({ color: [0.7, 0.4, 0.2, 1], roughness: 0.6 }) });
  const camera = orthographicCamera({ left: -1, right: 1, bottom: -1, top: 1, position: [0, 0, 4] });
  const input = (count: number, local: boolean) => scene({ camera, clearColor: [0, 0, 0, 0],
    nodes: [shape, ...Array.from({ length: count }, () => local
      ? pointLight({ position: [1, 2, 4], intensityCandela: 8 / count })
      : directionalLight({ direction: [0, -0.6, -0.8], illuminanceLux: 1 / count }))] });
  const read = async () => {
    const result = await captureFactory(root, { timeoutMs: 30000 });
    const bitmap = await createImageBitmap(result.blob);
    const target = document.createElement('canvas'); target.width = bitmap.width; target.height = bitmap.height;
    const ctx = target.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
    return { pixels: ctx.getImageData(0, 0, target.width, target.height).data, timings: result.timings };
  };
  const results = [];
  try {
    root.setSize({ cssWidth: 96, cssHeight: 96, pixelRatio: 1 });
    for (const local of [false, true]) {
      root.setScene(input(1, local)); const reference = (await read()).pixels;
      const painted = Array.from(reference).filter((value, index) => index % 4 === 3 && value > 0).length;
      if (painted === 0 || painted === 96 * 96) throw new Error(JSON.stringify({error:'Baseline lost geometry or alpha',painted,snapshot:root.getSnapshot()}));
      if (!local) onSmallReady?.();
      for (const count of [5, 9, 256, 512, 1]) {
        root.setScene(input(count, local)); const result = await read();
        let maxDifference = 0;
        for (let i = 0; i < reference.length; i++) maxDifference = Math.max(maxDifference, Math.abs(reference[i]! - result.pixels[i]!));
        if (maxDifference > 2) throw new Error(JSON.stringify({ local, count, maxDifference, snapshot: root.getSnapshot() }));
        results.push({ local, count, maxDifference, painted, timings: result.timings, resources: root.getSnapshot().resources });
      }
    }
    for (const alpha of [1, 0.45]) {
      const surfaces = [
        mesh({ geometry: boxGeometry(0.6), transform: { position: [-0.18, 0, 0.2] }, material: standardMaterial({ color: [0.7, 0.4, 0.2, alpha], metallic: 0.3, roughness: 0.4 }) }),
        mesh({ geometry: boxGeometry(0.6), transform: { position: [0.18, 0, -0.5] }, material: standardMaterial({ color: [0.2, 0.4, 0.7, alpha], roughness: 0.7 }) }),
      ];
      let reference: Uint8ClampedArray | undefined;
      for (const copies of mixedCopies) {
        const lights = Array.from({ length: copies }, () => [
          directionalLight({ direction: [0, 0, -1], color: [0.8, 0.5, 0.3, 1], illuminanceLux: 0.6 / copies }),
          pointLight({ position: [-1, 1, 2], range: 5, intensityCandela: 4 / copies }),
          pointLight({ position: [1, -1, 2], intensityCandela: 2 / copies }),
          spotLight({ position: [0, 0, 2], direction: [0, 0, -1], range: 4, innerConeAngle: 0.2, outerConeAngle: 0.7, intensityCandela: 3 / copies }),
        ]).flat();
        root.setScene(scene({ camera, clearColor: [0, 0, 0, 0], nodes: [...surfaces, ...lights] }));
        const value = await read(); reference ??= value.pixels;
        let maxDifference = 0;
        for (let i = 0; i < reference.length; i++) maxDifference = Math.max(maxDifference, Math.abs(reference[i]! - value.pixels[i]!));
        if (maxDifference > 2) {
          const again = await read();
          let retryDifference = 0;
          for (let i = 0; i < reference.length; i++) retryDifference = Math.max(retryDifference, Math.abs(reference[i]! - again.pixels[i]!));
          const summary = (pixels: Uint8ClampedArray) => ({ center: Array.from(pixels.slice((48 * 96 + 48) * 4, (48 * 96 + 48) * 4 + 4)), nonzero: pixels.filter((v, i) => i % 4 === 3 && v > 0).length });
          throw new Error(JSON.stringify({ kind: 'mixed-composition', alpha, copies, maxDifference, retryDifference, reference: summary(reference), actual: summary(value.pixels), snapshot: root.getSnapshot() }));
        }
        results.push({ kind: 'mixed-composition', alpha, count: copies * 4, maxDifference, timings: value.timings });
      }
    }
    root.setScene(input(512, false)); const beforeLoss = (await read()).pixels;
    const gl = canvas.getContext('webgl2')!;
    const extension = gl.getExtension('WEBGL_lose_context');
    if (extension !== null) {
      const lost = new Promise<void>(resolve => canvas.addEventListener('webglcontextlost', () => resolve(), { once: true }));
      extension.loseContext(); await lost;
      const restored = new Promise<void>(resolve => canvas.addEventListener('webglcontextrestored', () => resolve(), { once: true }));
      await new Promise(resolve => setTimeout(resolve, 100));
      extension.restoreContext();
      await Promise.race([restored, new Promise((_, reject) => setTimeout(() => reject(new Error("Context restoration timed out")), 10000))]);
      const afterLoss = (await read()).pixels;
      let maxDifference = 0;
      for (let i = 0; i < beforeLoss.length; i++) maxDifference = Math.max(maxDifference, Math.abs(beforeLoss[i]! - afterLoss[i]!));
      if (maxDifference > 2) throw new Error(JSON.stringify({ contextRestored: true, maxDifference }));
      results.push({ contextRestored: true, maxDifference, generation: root.getLifecycleSnapshot().generation });
    }
    return { results };
  } finally { root.dispose(); canvas.remove(); }
};
