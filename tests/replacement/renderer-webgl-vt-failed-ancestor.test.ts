import { afterEach, expect, it, vi } from 'vitest';
import { mesh, perspectiveCamera, planeGeometry, scene, unlitMaterial, virtualTexture } from '@royal/renderer-core';
import { identityMat4 } from '../../packages/renderer-webgl/src/math/mat4';
import { createBrowserVirtualTextureRuntime } from '../../packages/renderer-webgl/src/virtual-texture/runtime';
import { prepareCanonicalSurfaceScene } from '../../packages/renderer-webgl/src/surface/scene-lowering';
import { PersistentGpuBudgetOwner } from '../../packages/renderer-webgl/src/resource/persistent-gpu-budget';
import { fakeGl } from './support/canvas-root-harness';
import { createKtx2Fixture } from './support/ktx2-fixture';
import { waitFor } from './support/wait-for';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it.each([['image', 0], ['ktx2-astc-6x6', 166], ['ktx2-astc-8x8', 172]] as const)(
  'loads healthy %s children after a failed ancestor without retrying on zoom changes', async (pageEncoding, vk) => {
    vi.stubGlobal('document', { baseURI: 'https://fixture.invalid/' });
    const reads: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo) => {
      const uri = String(input);
      if (uri.endsWith('.json')) return new Response(JSON.stringify({ contractVersion: 2, pageSize: 128,
        borderTexels: 8, virtualSize: [256, 256], mipCount: 2, pageEncoding,
        pages: { uriTemplate: '{mip}-{x}-{y}.page' } }));
      reads.push(uri);
      return uri.endsWith('1-0-0.page') ? new Response('Missing parent', { status: 404 })
        : new Response(vk ? createKtx2Fixture(vk, 144, 144).buffer as ArrayBuffer : new Uint8Array([1]));
    }));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 144, height: 144, close: vi.fn() })));
    const gl = fakeGl();
    Object.assign(gl, { getExtension: vi.fn(() => ({ getSupportedProfiles: () => ['ldr'] })), compressedTexSubImage2D: vi.fn() });
    const budget = new PersistentGpuBudgetOwner(), runtime = createBrowserVirtualTextureRuntime(gl, vi.fn(), budget);
    const matrix = identityMat4();
    const view = { view: matrix, viewProjection: matrix, viewport: { x: 0, y: 0, width: 1024, height: 1024 } };
    try {
      runtime.setScene(prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}), nodes: [mesh({
        geometry: planeGeometry(2), material: unlitMaterial({ texture: virtualTexture('https://fixture.invalid/manifest.json') }),
      })] })));
      await waitFor(() => {
        runtime.update([view]);
        expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 4, failedPages: 1, pendingPages: 0, unresidentPages: 1 });
      });
      expect(reads).toHaveLength(5);
      expect(reads[0]).toContain('1-0-0.page');
      for (let frame = 0; frame < 100; frame++) {
        view.viewport.width = view.viewport.height = frame % 2 ? 1024 : 1;
        runtime.update([view]);
      }
      expect(reads).toHaveLength(5);
      expect(runtime.runtimeSnapshot()).toMatchObject({ residentPages: 4, failedPages: 1, pendingPages: 0, unresidentPages: 1 });
    } finally { runtime.dispose(); }
    expect(budget.snapshot().retainedBytes).toBe(0);
  },
);
