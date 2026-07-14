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
- `GltfFrameBatchArena` owns packet-submission grouping, reusable draw-batch
  storage, transform signatures, instance-buffer uploads, and stale-batch
  release.
- `SurfaceExecutionArena` owns direct/glTF shader selection, material and
  sampler planning, ordinary/virtual texture binding, transmission-target
  copies, lighting and IBL binding, scoped blend/cull state, and final
  single/instanced geometry submission. Diagnostics and wakeups drain as data
  at frame teardown rather than calling back into the root.

Keep the functional core / imperative shell split: frame planning, LOD, demand,
and admission stay pure where possible; browser, WebGL, scheduling, and cleanup
remain explicit imperative ownership.

## Package release

Royal is ready for application development inside this workspace, but the
packages remain private and versioned `0.0.0`. Before registry publication:

1. Choose the initial package version, add the root AGPL license text and release
   notes, remove `private`, and add an explicit publish workflow.

`pnpm check:package-consumer` now packs all three packages, rejects source and
build-metadata leakage, installs the tarballs into a clean React app,
typechecks the public React API, and imports every documented entrypoint.

## Validation

1. Re-run physical iPad Safari and Quest 2 checks when those devices are next
   available; they are explicitly deferred and do not block desktop work.
   Cover context loss, camera pan, close/far VT convergence, SVG/raster parity,
   window resize, and memory-pressure eviction.
