import { SvgRasterCache } from '../../packages/renderer-webgl/src/virtual-texture/svg-raster-cache.ts';
import { gltf, orthographicCamera, scene } from '../../packages/renderer-core/src/index.ts';
import { createRendererRoot } from '../../packages/renderer-webgl/src/index.ts';
import { staticTexturedTriangleGlb } from '../../tests/replacement/support/static-glb.ts';
import { createKtx2Fixture } from '../../tests/replacement/support/ktx2-fixture.ts';

/** Actual glTF worker -> source planner -> decoder -> ordinary/VT rendering. */
export async function runSourceCombinations() {
  const results = [];
  const demandAudit = new URLSearchParams(location.search).has('demand-audit');
  const largeRasterAudit = new URLSearchParams(location.search).has('large-raster');
  const aspect = new URLSearchParams(location.search).get('aspect');
  if (aspect !== null && (!largeRasterAudit || !['wide', 'tall'].includes(aspect))) throw new Error('Aspect audit requires large-raster and wide or tall');
  const lateBitmapAudit = new URLSearchParams(location.search).has('late-bitmap');
  const failureAudit = new URLSearchParams(location.search).get('failure');
  const recoveryAudit = new URLSearchParams(location.search).has('recover');
  if (recoveryAudit && failureAudit === null) throw new Error('Recovery audit requires a failure mode');
  if (failureAudit !== null && !['transport', 'invalid'].includes(failureAudit)) throw new Error('Unknown source failure mode');
  if (Number(demandAudit) + Number(lateBitmapAudit) + Number(failureAudit !== null) + Number(largeRasterAudit) > 1) throw new Error('Select one source audit mode');
  const nativeFetch = globalThis.fetch;
  for (const vk of demandAudit ? [172] : [166, 172]) for (const name of largeRasterAudit ? ['png-preview', 'jpeg-preview'] : lateBitmapAudit || failureAudit ? ['png-preview', 'jpeg-preview', 'jpeg-metadata-preview', 'webp-preview', 'avif-preview'] : demandAudit ? ['svg', 'png-preview', 'webp-preview'] : ['svg', 'webp', 'avif', 'png', 'jpeg', 'png-svg', 'png-preview', 'jpeg-preview', 'jpeg-metadata-preview', 'webp-preview', 'avif-preview']) for (const supported of demandAudit || lateBitmapAudit || failureAudit || largeRasterAudit ? [true] : [true, false]) {
    const rasterPreview = name.endsWith('-preview');
    const jpeg = name.startsWith('jpeg');
    const webp = name.startsWith('webp');
    const avif = name.startsWith('avif');
    const rasterExtension = avif ? 'EXT_texture_avif' : webp ? 'EXT_texture_webp' : undefined;
    const rasterMime = avif ? 'image/avif' : webp ? 'image/webp' : jpeg ? 'image/jpeg' : 'image/png';
    const urls: string[] = [];
    const blobUrl = (blob: Blob) => { const url = URL.createObjectURL(blob); urls.push(url); return url; };
    const fullSize = largeRasterAudit ? 4096 : ((webp || jpeg) && rasterPreview) || avif ? 1024 : 512;
    const fullWidth = aspect === 'wide' ? 8192 : fullSize;
    const fullHeight = aspect === 'tall' ? 8192 : fullSize;
    const art = new OffscreenCanvas(fullWidth, fullHeight);
    const context = art.getContext('2d')!; context.fillStyle = 'blue'; context.fillRect(0, 0, fullWidth, fullHeight);
    let rasterBlob = avif ? await (await nativeFetch('/research/vt-comparison/fixtures/blue-1024.avif')).blob() : await art.convertToBlob({ type: rasterMime });
    if (rasterBlob.type !== rasterMime) throw new Error(`Browser did not encode ${rasterMime}`);
    if (name === 'jpeg-metadata-preview') {
      // A legal APP15 segment pushes the original frame header past the 16 KiB
      // fast read, while remaining within the bounded 128 KiB JPEG fallback.
      const metadata = new Uint8Array(24 * 1024);
      metadata.set([0xff, 0xef, (metadata.length - 2) >> 8, (metadata.length - 2) & 255]);
      const magic = new Uint8Array(await rasterBlob.slice(0, 2).arrayBuffer());
      if (magic[0] !== 0xff || magic[1] !== 0xd8) throw new Error('Expected JPEG start marker');
      rasterBlob = new Blob([magic, metadata, rasterBlob.slice(2)], { type: rasterMime });
    }
    const raster = blobUrl(rasterBlob);
    const vector = blobUrl(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><path fill="blue" d="M0 0h512v512H0z"/></svg>'], { type: 'image/svg+xml' }));
    const astcBytes = createKtx2Fixture(vk, aspect === 'tall' ? 16 : 32, aspect === 'wide' ? 16 : 32, 6) as Uint8Array<ArrayBuffer>;
    const astc = blobUrl(new Blob([astcBytes], { type: 'image/ktx2' }));
    const reads: string[] = [];
    let injectFailure = failureAudit !== null;
    globalThis.fetch = (input, init) => {
      const uri = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if ([raster, vector, astc].includes(uri)) reads.push(uri === raster ? 'raster' : uri === vector ? 'svg' : 'astc');
      if (injectFailure && uri === raster) return Promise.resolve(failureAudit === 'transport'
        ? new Response('Fixture unavailable', { status: 404 })
        : new Response(new Uint8Array([0, 1, 2, 3]), { headers: { 'content-type': rasterMime } }));
      return nativeFetch(input, init);
    };
    const svg = name.includes('svg');
    const bytes = staticTexturedTriangleGlb(undefined, raster, document => {
      document.nodes = [{ mesh: 0 }]; document.scenes = [{ nodes: [0] }];
      document.images = [{ uri: raster, mimeType: rasterMime },
        { uri: vector, mimeType: 'image/svg+xml' }, { uri: astc, mimeType: 'image/ktx2' }];
      document.extensionsUsed = ['KHR_materials_unlit', 'EXT_texture_astc', ...(svg ? ['GS_texture_svg'] : []), ...(rasterExtension ? [rasterExtension] : [])];
      document.extensionsRequired = name === 'svg' ? ['GS_texture_svg'] : rasterExtension ? [rasterExtension] : [];
      document.samplers = [{ minFilter: 9987, magFilter: 9729, wrapS: 33071, wrapT: 33071 }];
      document.textures = [{ ...(name.startsWith('png') || jpeg ? { source: 0 } : {}), sampler: 0,
        ...(rasterPreview ? { extras: { royal: { astcPreview: { width: fullWidth, height: fullHeight } } } } : {}),
        extensions: { EXT_texture_astc: { source: 2 }, ...(svg ? { GS_texture_svg: { source: 1 } } : {}),
          ...(rasterExtension ? { [rasterExtension]: { source: 0 } } : {}) } }];
      document.materials = [{ extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }];
    });
    const src = blobUrl(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'model/gltf-binary' }));
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const gl = canvas.getContext('webgl2', { antialias: false })!;
    const getExtension = gl.getExtension.bind(gl);
    if (!getExtension('WEBGL_compressed_texture_astc')) throw new Error('Host ASTC LDR required for the supported branch');
    if (!supported) gl.getExtension = ((extension: string) => extension === 'WEBGL_compressed_texture_astc' ? null : getExtension(extension)) as typeof gl.getExtension;
    const nativeBitmap = globalThis.createImageBitmap;
    let releaseBitmap: (() => void) | undefined;
    const bitmapGate = lateBitmapAudit ? new Promise<void>(resolve => { releaseBitmap = resolve; }) : undefined;
    const bitmapCloses: number[] = [];
    const decodedBitmaps: { width: number; height: number }[] = [];
    if (lateBitmapAudit || largeRasterAudit) globalThis.createImageBitmap = ((...args: Parameters<typeof nativeBitmap>) => {
      const pending = Reflect.apply(nativeBitmap, globalThis, args) as Promise<ImageBitmap>;
      if (!(args[0] instanceof Blob) || args[0].type !== rasterMime) return pending;
      return pending.then(async bitmap => {
        if (largeRasterAudit) { decodedBitmaps.push({ width: bitmap.width, height: bitmap.height }); return bitmap; }
        const index = bitmapCloses.length; bitmapCloses.push(0);
        const close = bitmap.close.bind(bitmap);
        bitmap.close = () => { bitmapCloses[index] = bitmapCloses[index]! + 1; close(); };
        if (index === 0) await bitmapGate;
        return bitmap;
      });
    }) as typeof nativeBitmap;
    const root = createRendererRoot(canvas, { antialias: false });
    const pixel = new Uint8Array(4);
    const restoreContext = async () => {
      const loss = gl.getExtension('WEBGL_lose_context')!;
      const contextEvent = (name: string, action: () => void) => new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), 5000);
        canvas.addEventListener(name, event => { event.preventDefault(); clearTimeout(timeout); resolve(); }, { once: true });
        action();
      });
      await contextEvent('webglcontextlost', () => loss.loseContext());
      // Restore after the loss event has completed, not inside its microtask.
      await new Promise(resolve => setTimeout(resolve, 50));
      await contextEvent('webglcontextrestored', () => loss.restoreContext());
    };
    const target = supported && !svg && !rasterPreview ? [255, 0, 0] : [0, 0, 255];
    const expectedReads = supported ? svg ? ['astc', 'svg'] : rasterPreview ? ['astc', 'raster'] : ['astc'] : name === 'svg' ? ['svg'] : svg ? ['raster', 'svg'] : ['raster'];
    let frames = 0;
    const phases: { name: string; atlasBytes: number }[] = [];
    try {
      root.setSize({ cssWidth: 256, cssHeight: 256, pixelRatio: 1 });
      let node = gltf(src);
      const show = (half: number) => root.setScene(scene({ camera: orthographicCamera({ left: -half, right: half, top: half, bottom: -half, position: [0, 0, 3] }), nodes: [node], clearColor: [0, 0, 0, 1] }));
      if (rasterPreview && supported) {
        show(16); // 16 projected texels: the 32px native preview is sufficient.
        let presented = false;
        for (let attempt = 0; attempt < 300; attempt++) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          root.invalidate(); root.flushInvalidated();
          gl.readPixels(128, 128, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          if (pixel[0]! > 250 && pixel[2]! < 3) { presented = true; break; }
        }
        if (!presented || reads.join() !== 'astc' || root.getSnapshot().resources.virtualTextures.atlasBytes !== 0) {
          throw new Error(`Premature detail or missing native preview: ${name} ${reads} ${pixel}`);
        }
      }
      // 64 projected texels still fit one coarsest 128px VT page, but exceed
      // the native 32px preview. This must trigger authoritative refinement.
      const previewBudget = failureAudit ? root.getSnapshot().resources.virtualTextures.automaticDecodedBytes : 0;
      show(rasterPreview ? 4 : 1.1);
      if (failureAudit) {
        for (let frame = 0; frame < 180; frame++) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          show(frame % 2 ? 1.1 : 4);
          root.invalidate(); root.flushInvalidated();
          if (root.getSnapshot().lastFrameFailure) throw new Error('Authority failure reached the frame');
        }
        gl.readPixels(128, 128, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const final = root.getSnapshot().resources.virtualTextures;
        if (reads.join() !== 'astc,raster' || pixel[0]! < 250 || pixel[2]! > 3 || final.pendingPages
          || final.atlasBytes || final.automaticDecodedBytes > astcBytes.byteLength || gl.getError() !== gl.NO_ERROR) {
          throw new Error(`Authority failure lost preview, retried or retained budget: ${name} ${reads} pixel=${pixel} previewBudget=${previewBudget} ${JSON.stringify(final)}`);
        }
        await restoreContext();
        for (let frame = 0; frame < 180; frame++) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          show(frame % 2 ? 1.1 : 4);
          root.invalidate(); root.flushInvalidated();
          if (root.getSnapshot().lastFrameFailure) throw new Error('Failed-authority restoration reached the frame');
        }
        gl.readPixels(128, 128, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const restored = root.getSnapshot().resources.virtualTextures;
        if (reads.join() !== 'astc,raster' || pixel[0]! < 250 || pixel[2]! > 3 || restored.pendingPages || restored.atlasBytes
          || restored.automaticDecodedBytes !== final.automaticDecodedBytes || gl.getError() !== gl.NO_ERROR) throw new Error('Failed-authority restoration lost preview or retried detail');
        let recovered: typeof restored | undefined;
        if (recoveryAudit) {
          injectFailure = false;
          node = gltf({ src, version: 1 });
          show(4);
          for (let attempt = 0; attempt < 600; attempt++) {
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
            root.invalidate(); root.flushInvalidated();
            const state = root.getSnapshot();
            frames++;
            if (state.lastFrameFailure) throw new Error('Versioned recovery reached the frame');
            gl.readPixels(128, 128, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            const vt = state.resources.virtualTextures;
            if (pixel[2]! > 250 && pixel[0]! < 3 && vt.failedPages === 0 && vt.pendingPages === 0 && vt.unresidentPages === 0) { recovered = vt; break; }
          }
          if (recovered === undefined || recovered.residentPages === 0 || reads.join() !== 'astc,raster,astc,raster'
            || gl.getError() !== gl.NO_ERROR) throw new Error(`Versioned authority did not recover: ${name} ${reads} ${pixel}`);
        }
        results.push({ name: `${name}-${vk}`, minFilter: failureAudit, frames: 360 + frames, recoveryFrames: frames, reads, previewBudget, nativeSourceBytes: astcBytes.byteLength, pixel: [...pixel], beforeRestore: final, afterRestore: restored, final: recovered ?? restored, recovered, screenshot: canvas.toDataURL() });
        continue;
      }
      if (lateBitmapAudit) {
        const tick = async () => {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          root.invalidate(); root.flushInvalidated();
          const state = root.getSnapshot();
          if (state.lastFrameFailure || state.resources.virtualTextures.failedPages) throw new Error('Late bitmap frame failed');
          gl.readPixels(128, 128, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          return state.resources.virtualTextures;
        };
        for (let attempt = 0; attempt < 300 && bitmapCloses.length === 0; attempt++) await tick();
        const reserved = root.getSnapshot().resources.virtualTextures.automaticDecodedBytes;
        if (bitmapCloses.length !== 1 || reserved <= 0) throw new Error('Full raster did not reach the bitmap gate with a reservation');
        root.setScene(scene({ camera: orthographicCamera({ left: -1, right: 1, top: 1, bottom: -1, position: [0, 0, 3] }), nodes: [] }));
        const removed = await tick();
        if (removed.automaticDecodedBytes || removed.automaticResources || removed.atlasBytes || removed.pendingPages) throw new Error('Removed preview retained VT ownership');
        show(4);
        let replacementReady = false;
        for (let attempt = 0; attempt < 600; attempt++) {
          const state = await tick();
          if (bitmapCloses.at(1) !== undefined && pixel[2]! > 250 && pixel[0]! < 3 && state.pendingPages === 0 && state.unresidentPages === 0) { replacementReady = true; break; }
        }
        if (!replacementReady || bitmapCloses.some(count => count !== 0)) throw new Error('Replacement did not render while the old bitmap was held');
        const replacement = root.getSnapshot().resources.virtualTextures;
        releaseBitmap!();
        for (let attempt = 0; attempt < 60; attempt++) await tick();
        const final = root.getSnapshot().resources.virtualTextures;
        if (bitmapCloses.at(0) !== 1 || bitmapCloses.at(1) !== 0 || pixel[2]! < 250 || pixel[0]! > 3
          || final.automaticDecodedBytes !== replacement.automaticDecodedBytes || final.residentPages !== replacement.residentPages
          || final.pageRequests !== replacement.pageRequests || gl.getError() !== gl.NO_ERROR) throw new Error('Late bitmap disturbed the replacement');
        root.setScene(scene({ camera: orthographicCamera({ left: -1, right: 1, top: 1, bottom: -1, position: [0, 0, 3] }), nodes: [] }));
        const cleared = await tick();
        if (bitmapCloses.at(1) !== 1 || cleared.automaticDecodedBytes || cleared.automaticResources || cleared.atlasBytes) throw new Error('Replacement bitmap was not released');
        if (reads.join() !== 'astc,raster,astc,raster') throw new Error(`Unexpected replacement reads: ${reads}`);
        results.push({ name: `${name}-${vk}`, minFilter: 'late-bitmap', reserved, reads, bitmapCloses, replacement, final: cleared });
        continue;
      }
      for (; frames < 600; frames++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        root.invalidate(); root.flushInvalidated();
        const snapshot = root.getSnapshot();
        if (snapshot.lastFrameFailure) throw new Error(snapshot.lastFrameFailure);
        gl.readPixels(128, 128, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const vt = snapshot.resources.virtualTextures;
        if (target.every((v, i) => Math.abs(v - pixel[i]!) < 3) && reads.length >= expectedReads.length && vt.pendingPages === 0 && vt.unresidentPages === 0) break;
      }
      if (frames === 600 || gl.getError() !== gl.NO_ERROR) throw new Error(`${name}/${supported} did not render ${target}: ${pixel}, ${JSON.stringify(root.getSnapshot())}`);
      if (rasterPreview && supported) {
        const settle = async (condition: () => boolean = () => true) => {
          for (let attempt = 0; attempt < 600; attempt++) {
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
            root.invalidate(); root.flushInvalidated();
            const state = root.getSnapshot();
            if (state.lastFrameFailure) throw new Error(state.lastFrameFailure);
            gl.readPixels(canvas.width / 2, canvas.height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            if (pixel[2]! > 250 && pixel[0]! < 3 && state.resources.virtualTextures.pendingPages === 0
              && state.resources.virtualTextures.unresidentPages === 0 && condition()) return;
          }
          throw new Error(`Refinement/restoration did not settle: ${name}`);
        };
        const coarseBytes = root.getSnapshot().resources.virtualTextures.atlasBytes;
        phases.push({ name: 'coarse-authority', atlasBytes: coarseBytes });
        if (webp || avif || jpeg || largeRasterAudit) {
          root.setSize({ cssWidth: 1024, cssHeight: 1024, pixelRatio: 1 }); show(1.1);
          await settle(() => root.getSnapshot().resources.virtualTextures.desiredPages > 1);
          const grown = root.getSnapshot().resources.virtualTextures.atlasBytes;
          if (grown <= coarseBytes) throw new Error('Expected atlas growth');
          phases.push({ name: 'grown', atlasBytes: grown });
          show(64);
          await settle(() => root.getSnapshot().resources.virtualTextures.atlasBytes < grown);
          phases.push({ name: 'shrunk', atlasBytes: root.getSnapshot().resources.virtualTextures.atlasBytes });
        }
        await restoreContext();
        await settle();
        phases.push({ name: 'restored', atlasBytes: root.getSnapshot().resources.virtualTextures.atlasBytes });
      }
      if (largeRasterAudit) {
        const bitmap = decodedBitmaps[0];
        const vt = root.getSnapshot().resources.virtualTextures;
        if (decodedBitmaps.length !== 1 || bitmap === undefined || bitmap.width >= fullWidth || bitmap.height >= fullHeight
          || (aspect === null ? bitmap.width !== bitmap.height
            : Math.abs(bitmap.width / fullWidth - bitmap.height / fullHeight) > 1 / Math.min(fullWidth, fullHeight))
          || vt.automaticDecodedBytes > 64 * 1024 * 1024 || vt.failedPages
          || vt.automaticDecodedBytes <= bitmap.width * bitmap.height * 4
          || vt.automaticDecodedBytes > bitmap.width * bitmap.height * 4 + astcBytes.byteLength) {
          throw new Error(`Large authority did not fit its retained budget: ${JSON.stringify({ decodedBitmaps, vt })}`);
        }
      }
      let demandAllocations: { frames: number; arrays: number; pageObjects: number; cacheProbes: number; note: string } | undefined;
      if (demandAudit) {
        root.setSize({ cssWidth: 512, cssHeight: 512, pixelRatio: 1 });
        const from = Array.from;
        const has = SvgRasterCache.prototype.has;
        let arrays = 0, pageObjects = 0, cacheProbes = 0;
        SvgRasterCache.prototype.has = function (this: SvgRasterCache, key: object): boolean {
          cacheProbes++; return has.call(this, key);
        };
        Array.from = ((...args: Parameters<typeof from>) => {
          const output = Reflect.apply(from, Array, args);
          const first = output[0];
          if (first !== null && typeof first === 'object' && 'mip' in first && 'x' in first && 'y' in first) {
            arrays++; pageObjects += output.length;
          }
          return output;
        }) as typeof from;
        try {
          for (let frame = 0; frame < 360; frame++) {
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
            show(1.05 + .1 * Math.sin(frame / 30));
            root.invalidate(); root.flushInvalidated();
          }
        } finally { Array.from = from; SvgRasterCache.prototype.has = has; }
        gl.readPixels(256, 256, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        if (pixel[2]! < 250 || pixel[0]! > 3 || root.getSnapshot().lastFrameFailure) {
          throw new Error(`Demand audit lost authoritative pixels: ${name}`);
        }
        demandAllocations = { frames: 360, arrays, pageObjects, cacheProbes,
          note: 'Instrumented Array.from page-list outputs and decoded SVG cache probes during moving-camera updates; counts include asynchronous page work, timings are not a performance comparison.' };
      }
      if (reads.join() !== expectedReads.join()) throw new Error(`${name}/${supported}: unexpected reads ${reads}; expected ${expectedReads}`);
      results.push({ name: `${name}-${vk}`, minFilter: supported ? 'astc' : 'unsupported', frames, phases, reads, demandAllocations, ...(largeRasterAudit ? { sourceSize: aspect === null ? fullSize : { width: fullWidth, height: fullHeight }, decodedBitmaps } : {}), pixel: [...pixel], screenshot: canvas.toDataURL(), final: root.getSnapshot().resources.virtualTextures });
      console.log(`VT scene complete: ${name} ${vk} ASTC ${supported}`);
    } finally { releaseBitmap?.(); root.dispose(); canvas.remove(); urls.forEach(URL.revokeObjectURL); globalThis.fetch = nativeFetch; globalThis.createImageBitmap = nativeBitmap; }
  }
  return { results, note: failureAudit ? 'Valid ASTC previews with failed full raster transport or invalid image bytes; 180 demand-changing frames before and after context loss check preview survival, one detail read and released reservations.' : lateBitmapAudit ? 'Real browser raster bitmaps are held after decode. Removal releases VT claims; a replacement of the same glTF renders before the old bitmap is delivered. Old and replacement bitmaps must each close exactly once.' : 'ASTC 6x6/8x8 complete mip pyramids; forced unsupported capability uses the same host GPU. SVG/PNG/JPEG/WebP/AVIF authority is blue; native alternative is red to expose unintended substitution.' };
}
