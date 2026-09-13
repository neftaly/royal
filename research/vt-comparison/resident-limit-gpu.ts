import { mesh, orthographicCamera, planeGeometry, scene, unlitMaterial, virtualTexture } from '../../packages/renderer-core/src/index';
import { createRendererRoot } from '../../packages/renderer-webgl/src/index';
import { createKtx2Fixture } from '../../tests/replacement/support/ktx2-fixture';

const pause = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const colors = [[255, 0, 0], [0, 0, 255], [0, 255, 0], [255, 255, 0]] as const;
// Recolor the helper's valid LDR void-extent test blocks. No codec or production encoder.
export const coloredPage = (vk: number, color: readonly number[]) => {
  const bytes = createKtx2Fixture(vk, 144, 144, 1);
  const view = new DataView(bytes.buffer);
  const start = Number(view.getBigUint64(80, true)), length = Number(view.getBigUint64(88, true));
  for (let block = start; block < start + length; block += 16) {
    for (let channel = 0; channel < 3; channel++) view.setUint16(block + 8 + channel * 2, color[channel]! * 257, true);
  }
  return bytes;
};

export async function runResidentLimitGpu() {
  const coarse = new URLSearchParams(location.search).has('coarse');
  const nativeFetch = globalThis.fetch;
  const results = [];
  for (const [vk, pageEncoding, pageBytes] of [[166, 'ktx2-astc-6x6', 9216], [172, 'ktx2-astc-8x8', 5184]] as const)
    for (const limit of ['bytes', 'slots']) for (const limitedFirst of [false, true]) {
      const pages = colors.map(color => coloredPage(vk, color));
      const reads: string[] = [];
      globalThis.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        if (!url.pathname.startsWith('/resident-limit-fixture/')) return nativeFetch(input, init);
        reads.push(url.pathname);
        const limited = url.pathname.includes('/limited/');
        if (url.pathname.endsWith('.json')) return new Response(JSON.stringify({ contractVersion: 2,
          pageEncoding, pageSize: 128, borderTexels: 8, virtualSize: coarse ? [512, 256] : [256, 128], mipCount: coarse ? 2 : 1,
          ...(limit === 'bytes' ? { physicalByteBudget: pageBytes * (limited ? 1 : 2) } : { physicalSlots: limited ? 1 : 2 }),
          pages: { uriTemplate: '{mip}-{x}-{y}.ktx2' } }));
        const match = /\/([01])-([01])-0\.ktx2$/.exec(url.pathname);
        if (!match) throw new Error(`Unexpected fixture page: ${url.pathname}`);
        if (Number(match[1]) !== (coarse ? 1 : 0)) throw new Error('Expected capacity-limited coarse demand');
        return new Response(pages[Number(match[2]) + (limited ? 0 : 2)]!.slice().buffer as ArrayBuffer,
          { headers: { 'content-type': 'image/ktx2' } });
      };
      const canvas = document.createElement('canvas'); document.body.append(canvas);
      const root = createRendererRoot(canvas, { antialias: false });
      const gl = canvas.getContext('webgl2')!;
      const coarseTables = new Map<WebGLTexture, Uint8Array>();
      if (coarse) {
        const upload = gl.texSubImage2D.bind(gl);
        gl.texSubImage2D = ((...args: unknown[]) => {
          if (args.length === 9 && args[1] === 1 && args[8] instanceof Uint8Array)
            coarseTables.set(gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture, args[8]);
          Reflect.apply(upload, gl, args);
        }) as typeof gl.texSubImage2D;
        canvas.addEventListener('webglcontextlost', () => coarseTables.clear());
      }
      const checkCoarseTables = () => {
        if (!coarse) return;
        if (coarseTables.size !== 2) throw new Error('Missing coarse table upload');
        const previous = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
        const framebuffer = gl.createFramebuffer(), actual = new Uint8Array(8);
        try {
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
          for (const [texture, expected] of coarseTables) {
            gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 1);
            if (gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Coarse table readback incomplete');
            gl.readPixels(0, 0, 2, 1, gl.RGBA, gl.UNSIGNED_BYTE, actual);
            if (expected.length !== actual.length || actual.some((value, index) => value !== expected[index]))
              throw new Error(`Stale coarse GPU table: actual ${actual}; expected ${expected}`);
          }
        } finally { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous); gl.deleteFramebuffer(framebuffer); }
      };
      const limited = virtualTexture('/resident-limit-fixture/limited/index.json');
      const neighbor = virtualTexture('/resident-limit-fixture/neighbor/index.json');
      const show = (x: number, includeNeighbor = true) => root.setScene(scene({ camera: orthographicCamera({ left: -1, right: 1,
        bottom: -1, top: 1, position: [0, 0, 3] }), clearColor: [0, 0, 0, 1],
        nodes: (includeNeighbor ? limitedFirst ? [limited, neighbor] : [neighbor, limited] : [limited]).map(texture => mesh({ geometry: planeGeometry(2),
          material: unlitMaterial({ texture }), transform: texture === limited
            ? { position: [x, .5, 0], scale: [4, .45, 1] } : { position: [0, -.5, 0], scale: [1, .45, 1] } })),
      }));
      const phases = [];
      const sample = (x: number, y: number, color: readonly number[]) => {
        const pixel = new Uint8Array(4); gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        if (pixel[3] !== 255 || color.some((value, channel) => Math.abs(pixel[channel]! - value) > 3))
          throw new Error(`Wrong page pixel at ${x},${y}: ${pixel} expected ${color}`);
        return [...pixel];
      };
      try {
        if (!gl.getExtension('WEBGL_compressed_texture_astc')) throw new Error('Host ASTC required');
        root.setSize({ cssWidth: 256, cssHeight: 256, pixelRatio: 1 });
        show(2, false); // Allocate the pool before its neighbor is known.
        for (let frame = 0; root.getVirtualTextureAssetSnapshot(limited).residentPages !== 1; frame++) {
          if (frame === 300) throw new Error('Initial native page did not settle');
          root.invalidate(); root.flushInvalidated(); await pause();
          if (root.getSnapshot().lastFrameFailure) throw new Error(root.getSnapshot().lastFrameFailure);
        }
        let uploads = 0;
        for (const restored of [false, true]) {
          if (restored) {
            const loss = gl.getExtension('WEBGL_lose_context')!;
            const event = (name: string, action: () => void) => new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error(`Timed out: ${name}`)), 5000);
              canvas.addEventListener(name, value => { value.preventDefault(); clearTimeout(timeout); resolve(); }, { once: true }); action();
            });
            await event('webglcontextlost', () => loss.loseContext());
            await new Promise(resolve => setTimeout(resolve, 50));
            await event('webglcontextrestored', () => loss.restoreContext());
          }
          for (const [index, x] of [2, -2, 2].entries()) {
            show(x); uploads += index === 0 ? 3 : 1;
            let settled = false;
            for (let frame = 0; frame < 300; frame++) {
              root.invalidate(); root.flushInvalidated(); await pause();
              const state = root.getSnapshot();
              if (state.lastFrameFailure) throw new Error(state.lastFrameFailure);
              const vt = state.resources.virtualTextures;
              if (vt.uploadedPages >= uploads && vt.pendingPages === 0 && vt.unresidentPages === 0) { settled = true; break; }
            }
            if (!settled) throw new Error(`Capped page replacement did not settle: ${JSON.stringify({
              runtime: root.getSnapshot().resources.virtualTextures,
              limited: root.getVirtualTextureAssetSnapshot(limited), neighbor: root.getVirtualTextureAssetSnapshot(neighbor),
            })}`);
            root.invalidate(); root.flushInvalidated();
            const vt = root.getSnapshot().resources.virtualTextures;
            if (root.getVirtualTextureAssetSnapshot(limited).residentPages !== 1 || root.getVirtualTextureAssetSnapshot(neighbor).residentPages !== 2
              || vt.atlasPools !== 1 || vt.failedPages !== 0 || vt.pendingPageBytes !== 0 || vt.uploadedPages !== uploads)
              throw new Error(`Residency ceiling or neighboring storage changed: ${JSON.stringify(vt)}`);
            const pixels = [sample(128, 192, colors[x > 0 ? 0 : 1]), sample(64, 64, colors[2]), sample(192, 64, colors[3])];
            checkCoarseTables();
            if (gl.getError() !== gl.NO_ERROR) throw new Error('Replacement generated a GL error');
            phases.push({ restored, x, pixels, residentPages: vt.residentPages, uploadedPages: vt.uploadedPages });
          }
        }
        const final = root.getSnapshot().resources.virtualTextures;
        for (let frame = 0; frame < 100; frame++) { root.invalidate(); root.flushInvalidated(); }
        if (reads.length !== 12 || root.getSnapshot().resources.virtualTextures.uploadedPages !== 10) throw new Error('Settled pages were reread or reuploaded');
        results.push({ name: pageEncoding, minFilter: `${limit}-${limitedFirst}`, phases, reads, final, screenshot: canvas.toDataURL() });
      } finally {
        globalThis.fetch = nativeFetch; root.dispose(); canvas.remove(); gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
      if (root.getSnapshot().resources.persistentGpu.retainedBytes !== 0) throw new Error('Disposed root retained GPU budget');
    }
  return { results, note: 'Headless host-GPU correctness matrix, not a timing benchmark. Valid constant-color ASTC blocks, real shared atlas uploads, colored neighboring pages, capped replacement and context restoration. Each case disposes its root.' };
}
