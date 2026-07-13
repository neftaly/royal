# Royal Rendering Wishlist

Status reviewed: 2026-07-14

This file contains only rendering work that has not been built. The
[repository TODO](../../TODO.md) is authoritative for near-term work and
validation.

## Production Asset Manifests

Add one backend-facing asset manifest contract for production scenes rather
than expanding loader-specific behavior into the streaming system. It should
describe:

- Bounds that can be read without decoding the full asset.
- Texture variants, formats, dimensions, color space, hashes, and byte ranges.
- Offline LOD and meshlet bounds, cone data, material keys, and geometry ranges.
- Binary metadata when representative JSON manifests miss the parse target.

Keep normal asset declarations in the public API. Variant selection, meshlets,
and ranged streaming remain backend decisions.

Targets:

- Parse 100,000 meshlet records in less than 20 ms.
- Submit no more than 1.5 times the triangles implied by the screen-error
  target.
- Keep LOD churn below 5% during small camera steps.
- Demonstrate materially lower transfer and GPU memory than decoded RGBA
  fallback assets.

## Conservative CPU Occlusion

Prototype generic packet-bounds occlusion after manifest bounds exist. Start
with screen-space rectangles or coarse static occluder boxes; false positives
may draw extra objects, but false negatives must never hide visible geometry.

Do not expose BVH, `occluder`, or `culled` controls on public render nodes.

Target: under 2 ms for 2,000 occludees and 200 occluders at 1080p, with a
measured end-to-end draw or frame-time improvement.

## WebGPU Visibility Research

Keep the following WebGPU-first until a complete prototype demonstrates a
frame-time win:

1. Opaque depth production and depth-pyramid generation.
2. GPU occlusion against generic packet or meshlet bounds.
3. One-frame-late conservative visibility.
4. Indirect draw compaction and large meshlet tables in storage buffers.

Targets:

- Depth pyramid below 0.5 ms at 1080p.
- Occlusion below 1 ms for 50,000 candidate bounds.
- At least 25% GPU frame-time reduction on an occlusion stress scene.
- No visible popping during normal camera motion.

Avoid per-object WebGL2 readback and do not couple visibility to glTF.

## Deferred Rendering Research

Research deferred rendering only after a representative scene proves that its
lighting win exceeds G-buffer bandwidth, transparency fallback, and
post-processing costs. Keep G-buffer formats and backend strategy names out of
the public scene API.

Do not add a public material graph or public `ForwardPlus`, `Deferred`, or
`HiZ` pass types solely for this experiment.

## Public API Constraints

- Keep scenes, passes, assets, lights, and materials declarative.
- Keep extension names and backend algorithms private.
- Prefer one asset-manifest contract over specialized texture, terrain, glTF,
  or meshlet node APIs.
- Surface selected variants, visibility counts, LOD choices, and budget misses
  through diagnostics and benchmark rows.
- Do not add WebGL1 emulations for advanced streaming, deferred rendering, or
  GPU occlusion.
