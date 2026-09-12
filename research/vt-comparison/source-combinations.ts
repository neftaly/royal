import { gltf, orthographicCamera, scene } from '../../packages/renderer-core/src/index.ts';
import { createRendererRoot } from '../../packages/renderer-webgl/src/index.ts';
import { staticTexturedTriangleGlb } from '../../tests/replacement/support/static-glb.ts';
import { createKtx2Fixture } from '../../tests/replacement/support/ktx2-fixture.ts';

/** Actual glTF worker -> source planner -> decoder -> ordinary/VT rendering. */
export async function runSourceCombinations() {
  const results = [];
  const nativeFetch = globalThis.fetch;
  for (const vk of [166, 172]) for (const name of ['svg', 'webp', 'png', 'png-svg']) for (const supported of [true, false]) {
    const urls: string[] = [];
    const blobUrl = (blob: Blob) => { const url = URL.createObjectURL(blob); urls.push(url); return url; };
    const art = new OffscreenCanvas(512, 512);
    const context = art.getContext('2d')!; context.fillStyle = 'blue'; context.fillRect(0, 0, 512, 512);
    const raster = blobUrl(await art.convertToBlob({ type: name === 'webp' ? 'image/webp' : 'image/png' }));
    const vector = blobUrl(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><path fill="blue" d="M0 0h512v512H0z"/></svg>'], { type: 'image/svg+xml' }));
    const astc = blobUrl(new Blob([createKtx2Fixture(vk, 32, 32, 6) as Uint8Array<ArrayBuffer>], { type: 'image/ktx2' }));
    const reads: string[] = [];
    globalThis.fetch = (input, init) => {
      const uri = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if ([raster, vector, astc].includes(uri)) reads.push(uri === raster ? 'raster' : uri === vector ? 'svg' : 'astc');
      return nativeFetch(input, init);
    };
    const svg = name.includes('svg');
    const bytes = staticTexturedTriangleGlb(undefined, raster, document => {
      document.nodes = [{ mesh: 0 }]; document.scenes = [{ nodes: [0] }];
      document.images = [{ uri: raster, mimeType: name === 'webp' ? 'image/webp' : 'image/png' },
        { uri: vector, mimeType: 'image/svg+xml' }, { uri: astc, mimeType: 'image/ktx2' }];
      document.extensionsUsed = ['KHR_materials_unlit', 'EXT_texture_astc', ...(svg ? ['GS_texture_svg'] : []), ...(name === 'webp' ? ['EXT_texture_webp'] : [])];
      document.extensionsRequired = name === 'svg' ? ['GS_texture_svg'] : name === 'webp' ? ['EXT_texture_webp'] : [];
      document.samplers = [{ minFilter: 9987, magFilter: 9729, wrapS: 33071, wrapT: 33071 }];
      document.textures = [{ ...(name === 'png' || name === 'png-svg' ? { source: 0 } : {}), sampler: 0,
        extensions: { EXT_texture_astc: { source: 2 }, ...(svg ? { GS_texture_svg: { source: 1 } } : {}),
          ...(name === 'webp' ? { EXT_texture_webp: { source: 0 } } : {}) } }];
      document.materials = [{ extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }];
    });
    const src = blobUrl(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'model/gltf-binary' }));
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const gl = canvas.getContext('webgl2', { antialias: false })!;
    const getExtension = gl.getExtension.bind(gl);
    if (!getExtension('WEBGL_compressed_texture_astc')) throw new Error('Host ASTC LDR required for the supported branch');
    if (!supported) gl.getExtension = ((extension: string) => extension === 'WEBGL_compressed_texture_astc' ? null : getExtension(extension)) as typeof gl.getExtension;
    const root = createRendererRoot(canvas, { antialias: false });
    const pixel = new Uint8Array(4);
    const target = supported && !svg ? [255, 0, 0] : [0, 0, 255];
    const expectedReads = supported ? svg ? ['astc', 'svg'] : ['astc'] : name === 'svg' ? ['svg'] : svg ? ['raster', 'svg'] : ['raster'];
    let frames = 0;
    try {
      root.setSize({ cssWidth: 256, cssHeight: 256, pixelRatio: 1 });
      root.setScene(scene({ camera: orthographicCamera({ left: -1.1, right: 1.1, top: 1.1, bottom: -1.1, position: [0, 0, 3] }), nodes: [gltf(src)], clearColor: [0, 0, 0, 1] }));
      for (; frames < 600; frames++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        root.invalidate(); root.flushInvalidated();
        const snapshot = root.getSnapshot();
        if (snapshot.lastFrameFailure) throw new Error(snapshot.lastFrameFailure);
        gl.readPixels(128, 110, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const vt = snapshot.resources.virtualTextures;
        if (target.every((v, i) => Math.abs(v - pixel[i]!) < 3) && reads.length >= expectedReads.length && vt.pendingPages === 0 && vt.unresidentPages === 0) break;
      }
      if (frames === 600 || gl.getError() !== gl.NO_ERROR) throw new Error(`${name}/${supported} did not render ${target}: ${pixel}, ${JSON.stringify(root.getSnapshot())}`);
      if (reads.join() !== expectedReads.join()) throw new Error(`${name}/${supported}: unexpected reads ${reads}; expected ${expectedReads}`);
      results.push({ name: `${name}-${vk}`, minFilter: supported ? 'astc' : 'unsupported', frames, reads, pixel: [...pixel], screenshot: canvas.toDataURL(), final: root.getSnapshot().resources.virtualTextures });
      console.log(`VT scene complete: ${name} ${vk} ASTC ${supported}`);
    } finally { root.dispose(); canvas.remove(); urls.forEach(URL.revokeObjectURL); globalThis.fetch = nativeFetch; }
  }
  return { results, note: 'ASTC 6x6/8x8 complete mip pyramids; forced unsupported capability uses the same host GPU. SVG/PNG/WebP authority is blue; native alternative is red to expose unintended substitution.' };
}
