import { captureImage } from '../../packages/renderer-webgl/src/capture';
import { createRendererRoot } from '../../packages/renderer-webgl/src/index';
import { boxGeometry, createGltfInstanceTransforms, gltf, gltfInstances, mesh, orthographicCamera, pointLight, scene, standardMaterial } from '../../packages/renderer-core/src/index';
import type { RenderObjectRefObject } from '../../packages/renderer-core/src/render-object';
import { staticTriangleGlb, staticTriangleDocument } from '../../tests/replacement/support/static-glb';

/** Actual asynchronous GLB preparation and retained imported-light pose updates. */
export const runImports = async () => {
  const canvas = document.createElement('canvas'); document.body.append(canvas);
  const root = createRendererRoot(canvas, { antialias: true, alpha: true });
  const camera = orthographicCamera({ left: -1, right: 1, bottom: -1, top: 1, position: [0, 0, 4] });
  const shape = mesh({ geometry: boxGeometry(1), material: standardMaterial({ color: [0.7, 0.4, 0.2, 1], roughness: 0.6 }) });
  const urls: string[] = [];
  const asset = (nodes: number, intensity: number) => {
    const bytes = staticTriangleGlb({ ...staticTriangleDocument(), extensionsRequired: [], extensionsUsed: ['KHR_lights_punctual', 'KHR_materials_unlit'],
      extensions: { KHR_lights_punctual: { lights: [{ type: 'point', intensity }] } },
      nodes: [{ mesh: 0, translation: [100, 100, 100] }, ...Array.from({ length: nodes }, () => ({ translation: [0, 0, 2], extensions: { KHR_lights_punctual: { light: 0 } } }))],
      scenes: [{ nodes: Array.from({ length: nodes + 1 }, (_, i) => i) }], scene: 0,
    });
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'model/gltf-binary' })); urls.push(url); return url;
  };
  const read = async () => {
    const capture = await captureImage(root, { timeoutMs: 30000 });
    const bitmap = await createImageBitmap(capture.blob), target = document.createElement('canvas');
    target.width = bitmap.width; target.height = bitmap.height;
    const ctx = target.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
    return ctx.getImageData(0, 0, target.width, target.height).data;
  };
  const reference = async (x = 0, z = 2) => {
    root.setScene(scene({ camera, nodes: [shape, pointLight({ position: [x, 0, z], intensityCandela: 8 })] })); return read();
  };
  const results: unknown[] = [];
  const check = async (label: string, expected: Uint8ClampedArray) => {
    const actual = await read(); let difference = 0;
    for (let i = 0; i < expected.length; i++) difference = Math.max(difference, Math.abs(expected[i]! - actual[i]!));
    if (difference > 2) throw new Error(JSON.stringify({ label, difference, snapshot: root.getSnapshot() }));
    results.push({ label, maxDifference: difference, resources: root.getSnapshot().resources });
  };
  try {
    root.setSize({ cssWidth: 96, cssHeight: 96, pixelRatio: 1 });
    const base = await reference(), moved = await reference(1), rotated = await reference(2 * Math.sin(0.3), 2 * Math.cos(0.3));
    const ref: RenderObjectRefObject = { current: null };
    const src = asset(512, 8 / 512);
    root.setScene(scene({ camera, nodes: [shape, gltf({ src, ref })] }));
    await check('512 imported point lights', base);
    ref.current!.position.x = 1; await check('512 imported lights move with object handle', moved);
    ref.current!.setTransform({ position: [0, 0, 0], rotation: [0, 0.3, 0] });
    await check('512 imported lights rotate with object handle', rotated);
    root.setScene(scene({ camera, nodes: [shape, gltf({ src, importLights: false }), pointLight({ position: [0, 0, 2], intensityCandela: 8 })] }));
    await check('importLights false returns to small path', base);
    for (const count of [256, 512]) {
      const instances = createGltfInstanceTransforms({ count });
      root.setScene(scene({ camera, nodes: [shape, gltfInstances({ src: asset(1, 8 / count), instances })] }));
      await check(`${count} imported instance lights`, base);
      for (let index = 0; index < count; index++) instances.positions[index * 3] = 1;
      instances.commitPose(); await check(`${count} imported instance lights move in bulk`, moved);
    }
    return { date: new Date().toISOString(), results };
  } finally { root.dispose(); canvas.remove(); for (const url of urls) URL.revokeObjectURL(url); }
};
