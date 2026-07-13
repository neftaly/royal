# Royal TODO

Deferred after the July 2026 renderer close-out. These are separate follow-up
slices, not release blockers for the current branch.

## Root decomposition

Reduce `packages/renderer-webgl/src/root.ts` only along ownership boundaries
that delete orchestration or state. Do not create callback wrappers around the
root.

1. Extract the virtual-texture runtime shell: manifest/source lifetime, demand
   publication, request coordination, budget wakeups, and diagnostics. Keep the
   existing pure demand model and GPU arena as sibling authorities.
2. Extract prepared-glTF runtime ownership: prepared-event publication,
   generation checks, CPU leases, image-demand coordination, and packet patching.
3. Extract frame batching/surface execution once it can directly compose the
   packet, instance, target, program, geometry, lighting, IBL, and texture
   arenas without root callbacks.

Keep the functional core / imperative shell split: frame planning, LOD, demand,
and admission stay pure where possible; browser, WebGL, scheduling, and cleanup
remain explicit imperative ownership.

## Validation

1. Re-run physical iPad Safari and Quest 2 checks after lifecycle or texture
   demand changes. Cover context loss, camera pan, close/far VT convergence,
   SVG/raster parity, window resize, and memory-pressure eviction.
2. Measure cold/warm glTF load, a 4,096-instance scene, capacity growth, and
   steady heap behavior before adding performance limits.
