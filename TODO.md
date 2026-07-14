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
- `WebGlRenderClockOwner` owns invalidation coalescing, scheduled-generation
  cancellation, context interruption/resume, external-clock arbitration, and
  scheduled-render failure routing. The root retains frame execution and frame
  publication.
- `WebGlFramePublicationOwner` owns frame numbering, immediate subscription,
  serialized frame publication, render-failure delivery, observer isolation,
  and disposal. The root still decides the exact frame-advance and publication
  points around fallible teardown.
- `WebGlCanvasViewportOwner` owns backing-buffer sizing, ResizeObserver and DPR
  media-query lifetime, listener rebinding, invalidation, construction rollback,
  and disposal.
- `ResourceArenaSideEffectDebtOwner` owns ordered acquire/release side effects,
  exact-step retries, re-entrant debt ordering, drain exclusion, and terminal
  acquisition cancellation after semantic arena disposal.
- `ScenePlanTransactionOwner` owns authoritative plan generations, manifest
  diffing, scene-light compilation, planning counters, and retryable topology,
  render-object-ref, and bulk-instance reconciliation.
- `ResourceCapacityWakeOwner` owns CPU wake coalescing, persistent-GPU wake
  suppression, durable-capacity routing, fair preparation-peer wake order, and
  terminal cancellation on disposal.
- `GltfMaterialPreparationArena` owns prepared surface-material caches, reverse
  image-readiness invalidation, batch-class identity, texture-slot
  normalization, and material-variant resolution.
- `WebGlContextCapabilityOwner` owns negotiated context attributes, restore
  validation, extension discovery, and immutable numeric capability snapshots.
- `GeometryRecipeRegistry` owns retained CPU recipes, direct/glTF semantic
  identity, local-bounds caching, and transient packet reverse lookup.
- `SurfaceLightResolver` owns scene/studio and glTF light-set resolution,
  upload-readiness projection, transforms, and stable glTF light-scope identity.
- `GltfPacketSelectionOwner` owns shared-view node/material LOD observation,
  visibility workspaces, and retained per-view packet selection.
- `normalizeWebGlRootOptions` is the single pure defaulting and validation
  boundary used by both root construction and React Canvas semantic identity.

The remaining root is the deliberate composition shell: construction rollback
and context wiring, exact frame-transaction ordering, cross-owner resource
delta application, and teardown failure precedence. Extract it further only
when a new authority can own state or delete coupling; callback façades around
those transactions do not count.

Keep the functional core / imperative shell split: frame planning, LOD, demand,
and admission stay pure where possible; browser, WebGL, scheduling, and cleanup
remain explicit imperative ownership.

## Package release

Royal is ready for application development inside this workspace, but the
packages remain private. The initial pre-release version is `0.0.1`. Before
registry publication:

1. Add the root AGPL license text, remove `private`, and add an explicit publish
   workflow.

`pnpm check:package-consumer` now packs all three packages, rejects source and
build-metadata leakage, installs the tarballs into a clean React app,
typechecks the public React API, and imports every documented entrypoint.
CI runs both the built-entrypoint and packed-consumer gates.

## Validation

1. Complete the remaining physical iPad Safari and Quest 2 checks; they do not
   block desktop work. The July 14 pass now covers iPad VT convergence,
   animated instancing, and the SVG ordinary-texture fallback, plus Quest VT,
   instancing, SVG generated VT, camera drag, and real immersive WebXR. The XR
   report gate requires successful activation and physical session frames rather
   than accepting window RAFs; Quest XR currently measures `47.5ms` p95 and logs
   one framebuffer-multisample `GL_INVALID_OPERATION` warning during setup.
   Still cover context loss, camera pan, SVG/raster parity, window
   resize/orientation, and memory-pressure eviction.
