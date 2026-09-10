import { captureImage } from "../../packages/renderer-webgl/src/capture";
import { createRendererRoot } from '../../packages/renderer-webgl/src/index';
import { directionalLight, gltf, orthographicCamera, prefilteredEnvironment, scene } from '../../packages/renderer-core/src/index';
import { staticTriangleDocument, staticTriangleGlb } from '../../tests/replacement/support/static-glb';

export const run = async () => {
  const canvas = document.createElement('canvas');
  const root = createRendererRoot(canvas, { alpha: true, antialias: true });
  const fixtureDocument = staticTriangleDocument();
  fixtureDocument.extensionsRequired = ['KHR_lights_punctual'];
  fixtureDocument.extensionsUsed = ['KHR_lights_punctual'];
  delete (fixtureDocument.materials as Array<Record<string, unknown>>)[0]!.extensions;
  fixtureDocument.extensions = { KHR_lights_punctual: { lights: [{ type: 'directional' }] } };
  const nodes = fixtureDocument.nodes as Array<Record<string, unknown>>;
  nodes[0]!.children = [1, 2, 3];
  nodes.push({ extensions: { KHR_lights_punctual: { light: 0 } } }, { extensions: { KHR_lights_punctual: { light: 0 } } });
  const bytes = staticTriangleGlb(fixtureDocument);
  const src = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'model/gltf-binary' }));
  const results = [];
  try {
    for (const pixelRatio of [1, 2]) {
      root.setSize({ cssWidth: 60, cssHeight: 60, pixelRatio });
      root.setScene(scene({
        camera: orthographicCamera({ left: -2, right: 2, top: 2, bottom: -2, position: [1, 2, 6] }),
        nodes: [
          ...Array.from({ length: 3 }, () => directionalLight({ direction: [0, 0, -1], illuminanceLux: 1 })),
          gltf({ src, importLights: false }),
        ],
        clearColor: [0, 0, 0, 0],
      }));
      const capture = await captureImage(root, { timeoutMs: 15000 });
      const bitmap = await createImageBitmap(capture.blob);
      const output = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = output.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let painted = 0;
      for (let offset = 3; offset < pixels.length; offset += 4) if (pixels[offset]! > 0) painted++;
      if (painted === 0 || painted === bitmap.width * bitmap.height) throw new Error('Capture lost model pixels or transparent background');
      if (bitmap.width !== 60 * pixelRatio || bitmap.height !== 60 * pixelRatio) throw new Error('Incorrect capture dimensions');
      results.push({ pixelRatio, width: bitmap.width, height: bitmap.height, painted, pngBytes: capture.blob.size, timings: capture.timings });
      bitmap.close();
    }
    root.setSize({ cssWidth: 16 * 96 / 25.4, cssHeight: 16 * 96 / 25.4, pixelRatio: 1 });
    root.setScene(scene({
      camera: orthographicCamera({ left: -0.008, right: 0.008, top: 0.008, bottom: -0.008, position: [0, 0, 10], near: 0.0001, far: 30 }),
      nodes: [
        directionalLight({ direction: [0, -4, -5], illuminanceLux: 2.4 }),
        directionalLight({ direction: [0, 4, -3], illuminanceLux: 0.35 }),
        gltf({ src: '/__onboarding-assets/die/die.gltf', transform: {
          position: [0, 0, 0.008], rotation: [Math.PI, 0, Math.PI / 2], scale: [0.016, 0.016, 0.016],
        } }),
      ],
      environment: prefilteredEnvironment({ src: '/__onboarding-ambient.ktx' }),
      clearColor: [0, 0, 0, 0], toneMapping: 'linear-clamp', exposureEv100: -Math.log2(1.2),
    }));
    const catalog = await captureImage(root, { timeoutMs: 30000 });
    const bitmap = await createImageBitmap(catalog.blob);
    const output = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = output.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let painted = 0;
    for (let offset = 3; offset < pixels.length; offset += 4) if (pixels[offset]! > 0) painted++;
    const pixelHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(pixels)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    bitmap.close();
    if (painted === 0) throw new Error('Catalog capture is blank');
    return { triangle: results, classicDie: { pixelHash, rgbaBase64: btoa(String.fromCharCode(...pixels)), pngBase64: btoa(String.fromCharCode(...new Uint8Array(await catalog.blob.arrayBuffer()))), width: output.width, height: output.height, painted, pngBytes: catalog.blob.size, timings: catalog.timings, resources: root.getSnapshot().resources } };

  } finally {
    root.dispose();
    URL.revokeObjectURL(src);
  }
};
