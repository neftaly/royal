# Royal TODO

Deferred after the July 2026 renderer close-out. These are separate follow-up
slices, not release blockers for the current branch.

## Root decomposition

Reduce `packages/renderer-webgl/src/root.ts` only along ownership boundaries
that delete orchestration or state. Do not create callback wrappers around the
root.

Completed in the current worktree:

- `VirtualTextureRuntimeShell` owns manifest/generated-source lifetime,
  auto-VT source registration, resource/request identity, frame-demand
  publication and fairness, governor leases/wakeups, diagnostics, and
  context-loss reset. The pure demand model and GPU arena remain sibling
  authorities.
- `PreparedGltfRuntime` owns state/node/generation identity, preparation
  scheduling, retryable prepared-event ordering, CPU and image-demand leases,
  shared-view LOD state, packet topology, and ready/error packet patching.

Remaining:

1. Extract frame batching/surface execution once it can directly compose the
   packet, instance, target, program, geometry, lighting, IBL, and texture
   arenas without root callbacks.

Keep the functional core / imperative shell split: frame planning, LOD, demand,
and admission stay pure where possible; browser, WebGL, scheduling, and cleanup
remain explicit imperative ownership.

## Validation

1. Re-run physical iPad Safari and Quest 2 checks when those devices are next
   available; they are explicitly deferred and do not block desktop work.
   Cover context loss, camera pan, close/far VT convergence, SVG/raster parity,
   window resize, and memory-pressure eviction.
2. Measure cold/warm glTF load, a 4,096-instance scene, capacity growth, and
   steady heap behavior before adding performance limits.
