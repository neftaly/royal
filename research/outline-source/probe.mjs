/** Native pixel oracle; software-browser timings are diagnostic, not device targets. */
export async function runOutlineSourceProbe(renderer, core, Index, scan, count = 269) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:384px;height:384px;position:fixed;left:0;top:0;z-index:9999';
  document.body.append(canvas);
  const binary = new Uint8Array(60);
  new Float32Array(binary.buffer, 0, 12).set([-0.4,-0.4,0, 0.4,-0.4,0, 0.4,0.4,0, -0.4,0.4,0]);
  new Uint16Array(binary.buffer, 48, 6).set([0,1,2, 0,2,3]);
  const gltf = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: 60, uri: `data:application/octet-stream;base64,${btoa(String.fromCharCode(...binary))}` }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 48 }, { buffer: 0, byteOffset: 48, byteLength: 12 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-0.4,-0.4,0], max: [0.4,0.4,0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      { bufferView: 1, byteOffset: 6, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    extensionsUsed: ['KHR_materials_unlit'],
    materials: [0, 1].map((i) => ({ extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorFactor: i ? [0.2,0.6,0.3,1] : [0.4,0.2,0.6,1] } })),
    meshes: [{ primitives: [0, 1].map((i) => ({ attributes: { POSITION: 0 }, indices: i + 1, material: i })) }],
    nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
  };
  const src = URL.createObjectURL(new Blob([JSON.stringify(gltf)], { type: 'model/gltf+json' }));
  const root = renderer.createRendererRoot(canvas);
  const camera = core.createCameraViewResource(core.perspectiveCamera({ position: [0,0,32] }));
  const transforms = Array.from({ length: Math.max(1, count) }, (_, i) => ({ position: [(i % 24) - 11.5, Math.floor(i / 24) - 10.5, 0] }));
  const nodes = transforms.map((transform) => core.gltf({ src, transform }));
  const outlineNodes = transforms.slice(0, count).map((transform) => core.outlineGltf({
    src, transform, material: core.edgeMaterial({ color: [1,0.4,0.1,1], widthCssPixels: 2 }),
  }));
  const original = Index.prototype.matches;
  let index;
  let scans = 0;
  const reference = function(surfaces, requested) {
    const output = [];
    for (let surfaceIndex = 0; surfaceIndex < surfaces.length; surfaceIndex++) {
      scans++;
      const kind = scan(surfaces[surfaceIndex], requested);
      if (kind !== null) output.push({ surfaceIndex, memberIndex: kind === 'automatic-member' ? 0 : -1 });
    }
    return output;
  };
  const indexed = function(surfaces, requested) { index = this; return original.call(this, surfaces, requested); };
  const wait = async (predicate) => {
    const until = performance.now() + 20000;
    while (!predicate()) {
      if (performance.now() > until) throw new Error('Outline fixture did not settle');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const draw = () => { root.invalidate(); root.flushInvalidated(); };
  const pixels = () => {
    const gl = canvas.getContext('webgl2');
    const bytes = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('Native outline WebGL error');
    return bytes;
  };
  try {
    root.setSize({ cssHeight: 384, cssWidth: 384, pixelRatio: 1 });
    root.setScene(core.scene({ camera, clearColor: [0,0,0,1], nodes }));
    await wait(() => root.getGltfAssetSnapshot(nodes[0].asset).status === 'ready');
    draw();
    Index.prototype.matches = indexed;
    root.setOverlay(core.sceneOverlay({ nodes: outlineNodes }));
    await wait(() => { draw(); return count === 0 || index !== undefined; });
    const report = [];
    let outlinePixels = 0;
    for (let frame = 0; frame < 4; frame++) {
      camera.position[0] = Math.sin(frame) * 0.25;
      camera.commit();
      Index.prototype.matches = reference;
      const before = performance.now();
      draw();
      const scanMs = performance.now() - before;
      const expected = pixels();
      Index.prototype.matches = indexed;
      const indexedBefore = performance.now();
      draw();
      const indexedMs = performance.now() - indexedBefore;
      const actual = pixels();
      outlinePixels = 0;
      for (let i = 0; i < actual.length; i += 4) {
        if (actual[i] > actual[i + 1] + 30 && actual[i + 1] > actual[i + 2] + 20) outlinePixels++;
      }
      if (count > 0 && outlinePixels < 10) throw new Error("The outline draw did not produce visible outline pixels");
      if (expected.some((value, i) => value !== actual[i])) throw new Error(`Outline pixel mismatch at frame ${frame}`);
      report.push({ scanMs, indexedMs });
    }
    if (count > 0 && (scans === 0 || index === undefined)) throw new Error('The probe did not intercept the renderer source index; import the current Vite module generation');
    if (root.getSnapshot().lastFrameFailure !== undefined) throw new Error('Renderer failed');
    return { count, frames: report.length, outlinePixels, pixelMismatches: 0, scanSurfaceComparisons: scans, index: index?.snapshot(), timings: report };
  } finally {
    Index.prototype.matches = original;
    root.dispose();
    canvas.remove();
    URL.revokeObjectURL(src);
  }
}
