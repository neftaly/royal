import { collectVirtualTextureDemand, createVirtualTextureDemandWorkspace, resetVirtualTextureDemand } from '../../packages/renderer-webgl/src/virtual-texture/demand.ts';
import { parseVirtualTextureManifest } from '../../packages/renderer-webgl/src/virtual-texture/manifest.ts';
import { identityMat4 } from '../../packages/renderer-webgl/src/math/mat4.ts';

// Isolated demand cost: excludes rendering, source decode, network and upload.
export function runDemandBenchmark(iterations = 120) {
  const manifest = parseVirtualTextureManifest({ contractVersion: 2, virtualSize: [16384, 16384], pageSize: 128, borderTexels: 2, pages: { uriTemplate: '{mip}/{x}/{y}.png' } });
  const sampler = { minFilter: 'linear-mipmap-linear', magFilter: 'linear', wrapS: 'clamp-to-edge', wrapT: 'clamp-to-edge' } as const;
  const views = [{ viewProjection: identityMat4(), viewport: { x: 0, y: 0, width: 1024, height: 1024 } }];
  const results = [];
  for (const triangles of [2, 200, 20000]) {
    // Coincident triangles deliberately model worst-case overdraw. Every layer
    // shares UVs, so demand should stay constant while CPU work increases.
    const indices = new Uint32Array(triangles * 3);
    for (let i = 0; i < indices.length; i++) indices[i] = [0, 1, 2, 0, 2, 3][i % 6]!;
    const bounds = { min: [-0.5, -0.5, 0], max: [0.5, 0.5, 0] } as const;
    const surfaces = [{ model: identityMat4(), worldBounds: bounds,
      textureCoordinates: { row0: [1, 0, 0, 0], row1: [0, 1, 0, 0] } as const,
      geometry: { bounds, key: 'overdraw', indices,
        positions: new Float32Array([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0]),
        textureCoordinates0: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]) } }];
    for (const ancestors of ['coarsest', 'all'] as const) {
      const workspace = createVirtualTextureDemandWorkspace(512, ancestors);
      const samples = new Float64Array(iterations);
      for (let i = -20; i < iterations; i++) {
        const start = performance.now();
        resetVirtualTextureDemand(workspace);
        collectVirtualTextureDemand(workspace, manifest, surfaces, views, sampler);
        if (i >= 0) samples[i] = performance.now() - start;
      }
      samples.sort();
      results.push({ triangles, ancestors, pages: workspace.count, overflow: workspace.overflow,
        medianMs: samples[Math.floor(iterations / 2)], p95Ms: samples[Math.floor(iterations * .95)] });
    }
  }
  return { iterations, results };
}
