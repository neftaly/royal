import { mesh, orthographicCamera, planeGeometry, scene, unlitMaterial, virtualTexture } from '../../packages/renderer-core/src/index';
import { createRendererRoot } from '../../packages/renderer-webgl/src/index';
import { coloredPage } from './resident-limit-gpu';

export async function runNativeIdentityGpu() {
  const originalFetch = globalThis.fetch, results = [];
  const colors = [[255, 0, 0], [255, 0, 0], [0, 0, 255], [0, 255, 0], [255, 255, 0]] as const;
  const pause = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  for (const [vk, pageEncoding] of [[166, 'ktx2-astc-6x6'], [172, 'ktx2-astc-8x8']] as const) for (const reversed of [false, true]) {
    const pages = colors.map(color => coloredPage(vk, color)), reads: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const match = /^\/native-identity\/([0-4])\//.exec(url.pathname);
      if (!match) return originalFetch(input, init);
      reads.push(url.pathname);
      return new Response(url.pathname.endsWith('.json') ? JSON.stringify({ contractVersion: 2, pageEncoding,
        pageSize: 128, borderTexels: 8, virtualSize: [128, 128], physicalSlots: 1, pages: { uriTemplate: '{page}.ktx2' } })
        : pages[Number(match[1])]!.buffer as ArrayBuffer);
    };
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const root = createRendererRoot(canvas, { antialias: false });
    const gl = canvas.getContext('webgl2')!;
    const assets = [
      virtualTexture({ manifestUri: '/native-identity/0/index.json', contentKey: 'shared', version: 0 }),
      virtualTexture({ manifestUri: '/native-identity/1/index.json', contentKey: 'shared', version: 0,
        sampler: { minFilter: 'linear-mipmap-linear', magFilter: 'linear', wrapS: 'clamp-to-edge', wrapT: 'clamp-to-edge' } }),
      virtualTexture({ manifestUri: '/native-identity/2/index.json', contentKey: 'shared', version: '0' }),
      virtualTexture({ manifestUri: '/native-identity/3/index.json', contentKey: 0, version: 0 }),
      virtualTexture({ manifestUri: '/native-identity/4/index.json', contentKey: '0', version: 0 }),
    ];
    const geometry = planeGeometry(2), phases: { name: string; pixels: number[][]; residentPages: number; uploadedPages: number; reads: number }[] = [];
    const show = (indices: number[]) => root.setScene(scene({ camera: orthographicCamera({ left: -1, right: 1,
      bottom: -1, top: 1, position: [0, 0, 3] }), clearColor: [0, 0, 0, 1],
      nodes: (reversed ? indices.slice().reverse() : indices).map(index => mesh({ geometry,
        material: unlitMaterial({ texture: assets[index]! }), transform: { position: [-.8 + index * .4, 0, 0], scale: [.18, .5, 1] } })),
    }));
    const check = async (name: string, indices: number[], expectedResident: number, expectedReads: number) => {
      let settled = false;
      for (let frame = 0; frame < 300; frame++) {
        root.invalidate(); root.flushInvalidated(); await pause();
        const state = root.getSnapshot();
        if (state.lastFrameFailure) throw new Error(state.lastFrameFailure);
        if (state.resources.virtualTextures.pendingPages === 0 && indices.every(index => {
          const asset = root.getVirtualTextureAssetSnapshot(assets[index]!);
          return asset.status === 'ready' && asset.residentPages === 1;
        })) {
          settled = true; break;
        }
      }
      if (!settled) throw new Error('Identity fixture did not settle');
      root.invalidate(); root.flushInvalidated();
      const final = root.getSnapshot().resources.virtualTextures;
      if (final.residentPages !== expectedResident || final.atlasPools !== 1 || final.unresidentPages !== 0
        || final.failedPages !== 0 || final.pendingPageBytes !== 0 || reads.length !== expectedReads)
        throw new Error(`Identity sharing changed during ${name}: ${JSON.stringify({ final, reads })}`);
      const pixels = colors.map((color, index) => {
        const pixel = new Uint8Array(4); gl.readPixels(Math.round((.2 + index * .4) * 128), 128, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const expected = indices.includes(index) ? color : [0, 0, 0];
        if (pixel[3] !== 255 || expected.some((value, channel) => Math.abs(pixel[channel]! - value) > 3))
          throw new Error(`Wrong identity color at ${index}: ${pixel}`);
        return [...pixel];
      });
      if (gl.getError() !== gl.NO_ERROR) throw new Error('Identity fixture GL error');
      phases.push({ name, pixels, residentPages: final.residentPages, uploadedPages: final.uploadedPages, reads: reads.length });
    };
    try {
      if (!gl.getExtension('WEBGL_compressed_texture_astc')) throw new Error('Host ASTC required');
      root.setSize({ cssWidth: 256, cssHeight: 256, pixelRatio: 1 });
      show([0, 1, 2, 3, 4]); await check('all', [0, 1, 2, 3, 4], 4, 8);
      show([1, 2, 3, 4]); await check('one-alias', [1, 2, 3, 4], 4, 8);
      show([2, 3, 4]); await check('no-alias', [2, 3, 4], 3, 8);
      show([0, 1, 2, 3, 4]); await check('readded', [0, 1, 2, 3, 4], 4, 10);
      const loss = gl.getExtension('WEBGL_lose_context')!;
      const event = (name: string, action: () => void) => new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Timed out: ${name}`)), 5000);
        canvas.addEventListener(name, value => { value.preventDefault(); clearTimeout(timeout); resolve(); }, { once: true }); action();
      });
      await event('webglcontextlost', () => loss.loseContext());
      await new Promise(resolve => setTimeout(resolve, 50));
      await event('webglcontextrestored', () => loss.restoreContext());
      await check('restored', [0, 1, 2, 3, 4], 4, 14);
      if (root.getSnapshot().resources.virtualTextures.uploadedPages !== 9) throw new Error('Unexpected identity upload count');
      const unusedAlias = reversed ? '/native-identity/0/' : '/native-identity/1/';
      if (reads.some(uri => uri.startsWith(unusedAlias))) throw new Error('Equivalent alias was fetched separately');
      results.push({ name: pageEncoding, minFilter: String(reversed), phases, reads, screenshot: canvas.toDataURL() });
    } finally { globalThis.fetch = originalFetch; root.dispose(); canvas.remove(); gl.getExtension('WEBGL_lose_context')?.loseContext(); }
    if (root.getSnapshot().resources.persistentGpu.retainedBytes !== 0) throw new Error('Identity fixture retained GPU budget after disposal');
  }
  return { results, note: 'Headless host-GPU identity correctness: content aliases and default samplers share, typed versions/content keys remain distinct, removal/re-add and context restoration preserve colors and bounded reads. No timing claim.' };
}
