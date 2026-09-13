import { gltf, orthographicCamera, scene } from '../../packages/renderer-core/src/index.ts';
import { createRendererRoot } from '../../packages/renderer-webgl/src/index.ts';
import { staticTexturedTriangleGlb } from '../../tests/replacement/support/static-glb.ts';
import { createKtx2Fixture } from '../../tests/replacement/support/ktx2-fixture.ts';

/** Real bitmap admission: one fitted 4096px authority fits, two do not. */
export async function runLargeContention() {
  const results = [];
  const simultaneous = new URLSearchParams(location.search).has('simultaneous');
  const reverse = simultaneous && new URLSearchParams(location.search).has('reverse');
  const restore = new URLSearchParams(location.search).has('restore');
  const art = new OffscreenCanvas(4096, 4096);
  const context = art.getContext('2d')!;
  context.fillStyle = 'blue'; context.fillRect(0, 0, 4096, 4096);
  const png = await art.convertToBlob({ type: 'image/png' });
  const nativeFetch = globalThis.fetch;
  for (const vk of [166, 172]) {
    const urls: string[] = [], reads: string[] = [];
    const labels = new Map<string, string>();
    const url = (blob: Blob, label?: string) => {
      const uri = URL.createObjectURL(blob); urls.push(uri);
      if (label) labels.set(uri, label);
      return uri;
    };
    const nodes = ['a', 'b'].map((label, index) => {
      const raster = url(png, `${label}-raster`);
      const astc = url(new Blob([createKtx2Fixture(vk, 32, 32, 6) as Uint8Array<ArrayBuffer>], { type: 'image/ktx2' }), `${label}-astc`);
      const bytes = staticTexturedTriangleGlb(undefined, raster, document => {
        document.nodes = [{ mesh: 0 }]; document.scenes = [{ nodes: [0] }];
        document.images = [{ uri: raster, mimeType: 'image/png' }, { uri: astc, mimeType: 'image/ktx2' }];
        document.extensionsUsed = ['KHR_materials_unlit', 'EXT_texture_astc'];
        document.samplers = [{ minFilter: 9987, magFilter: 9729, wrapS: 33071, wrapT: 33071 }];
        document.textures = [{ source: 0, sampler: 0, extensions: { EXT_texture_astc: { source: 1 } },
          extras: { royal: { astcPreview: { width: 4096, height: 4096 } } } }];
        document.materials = [{ extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }];
      });
      return gltf({ src: url(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'model/gltf-binary' })),
        transform: { position: [index === 0 ? -1.5 : 1.5, 0, 0] } });
    });
    let released = false, oversubscribed = false;
    globalThis.fetch = (input, init) => {
      const uri = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const label = labels.get(uri); if (label) reads.push(label);
      if (!released && reads.filter(read => read.endsWith('-raster')).length > 1) oversubscribed = true;
      return nativeFetch(input, init);
    };
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const gl = canvas.getContext('webgl2', { antialias: false })!;
    if (!gl.getExtension('WEBGL_compressed_texture_astc')) throw new Error('Host ASTC required');
    const root = createRendererRoot(canvas, { antialias: false });
    const left = new Uint8Array(4), right = new Uint8Array(4);
    const camera = orthographicCamera({ left: -4, right: 4, top: 4, bottom: -4, position: [0, 0, 3] });
    const show = (selected: typeof nodes) => root.setScene(scene({ camera, nodes: selected, clearColor: [0, 0, 0, 1] }));
    const tick = async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      root.invalidate(); root.flushInvalidated();
      gl.readPixels(80, 128, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, left);
      gl.readPixels(176, 128, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, right);
      const state = root.getSnapshot(), vt = state.resources.virtualTextures;
      if (oversubscribed || state.lastFrameFailure || gl.getError() !== gl.NO_ERROR || vt.failedPages
        || vt.automaticDecodedBytes > 64 * 1024 * 1024) throw new Error(`Contention frame failed: ${JSON.stringify(state)}`);
      return vt;
    };
    const settle = async (ready: (state: Awaited<ReturnType<typeof tick>>) => boolean) => {
      for (let frame = 0; frame < 600; frame++) {
        const state = await tick(); if (ready(state)) return state;
      }
      throw new Error(`Contention did not settle: ${reads}; left=${left}; right=${right}`);
    };
    try {
      root.setSize({ cssWidth: 256, cssHeight: 256, pixelRatio: 1 });
      const blue = (pixel: Uint8Array) => pixel[2]! > 250 && pixel[0]! < 3;
      const red = (pixel: Uint8Array) => pixel[0]! > 250 && pixel[2]! < 3;
      const arrival = reverse ? nodes.slice().reverse() : nodes;
      show(simultaneous ? arrival : [nodes[0]!]);
      const first = await settle(vt => vt.pendingPages === 0 && (simultaneous
        ? vt.automaticResources === 2 && ((blue(left) && red(right)) || (red(left) && blue(right)))
        : blue(left) && vt.unresidentPages === 0));
      const winner = blue(left) ? 0 : 1;
      const authority = winner === 0 ? left : right, preview = winner === 0 ? right : left;
      const firstLabel = winner === 0 ? 'a' : 'b', secondLabel = winner === 0 ? 'b' : 'a';
      if (first.automaticDecodedBytes <= 32 * 1024 * 1024
        || (!simultaneous && reads.join() !== 'a-astc,a-raster')) throw new Error('First authority did not occupy more than half the budget');
      show(arrival);
      await settle(vt => red(preview) && vt.automaticResources === 2);
      let waiting = first;
      for (let frame = 0; frame < 120; frame++) waiting = await tick();
      if (reads.length !== 3 || reads.filter(read => read === 'a-astc').length !== 1
        || reads.filter(read => read === 'b-astc').length !== 1 || !reads.includes(`${firstLabel}-raster`)
        || !red(preview) || !blue(authority) || waiting.pendingPages) throw new Error('Denied authority read early or lost usable coverage');
      let restored: typeof waiting | undefined;
      if (restore) {
        const loss = gl.getExtension('WEBGL_lose_context')!;
        const event = (name: string, action: () => void) => new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), 5000);
          canvas.addEventListener(name, event => { event.preventDefault(); clearTimeout(timeout); resolve(); }, { once: true });
          action();
        });
        await event('webglcontextlost', () => loss.loseContext());
        await new Promise(resolve => setTimeout(resolve, 50));
        await event('webglcontextrestored', () => loss.restoreContext());
        await settle(vt => blue(authority) && red(preview) && vt.pendingPages === 0);
        for (let frame = 0; frame < 120; frame++) restored = await tick();
        if (reads.length !== 3 || !blue(authority) || !red(preview)
          || restored!.automaticDecodedBytes !== waiting.automaticDecodedBytes
          || restored!.automaticResources !== 2 || restored!.residentPages !== waiting.residentPages
          || restored!.pendingPages) throw new Error('Context restoration bypassed contention or lost retained coverage');
      }
      released = true;
      show([nodes[1 - winner]!]);
      const promoted = await settle(vt => blue(preview) && vt.pendingPages === 0 && vt.unresidentPages === 0);
      const nativeBytes = vk === 166 ? 832 : 384;
      if (reads.at(3) !== `${secondLabel}-raster` || reads.at(4) !== undefined || promoted.automaticResources !== 1
        || promoted.automaticDecodedBytes !== waiting.automaticDecodedBytes - nativeBytes) throw new Error('Released capacity did not promote the waiting authority');
      const pixel = [...preview];
      show([]);
      const cleared = await tick();
      if (cleared.automaticDecodedBytes || cleared.automaticResources || cleared.atlasBytes || cleared.pendingPages) throw new Error('Final removal retained ownership');
      results.push({ name: `large-contention-${vk}`, minFilter: simultaneous ? 'simultaneous' : 'astc', reverse, reads, winner: firstLabel, first, waiting, restored, promoted, cleared, pixel });
    } finally { root.dispose(); canvas.remove(); urls.forEach(URL.revokeObjectURL); globalThis.fetch = nativeFetch; }
  }
  return { results, note: 'Two independent 4096px PNG authorities share one root. The second keeps its native preview for 120 frames without a detail read, then promotes after the first is removed. Retained accounting is checked every frame; this is not a peak browser-process memory measurement.' };
}
