# Automatic Renderer-Owned LOD And Impostor Policy

Date: 2026-06-29

Status: research-only. This is not an example, package API, route, or renderer
commitment.

## Position

The next prototype stage should treat dynamic mesh LOD, billboards, and
octahedral impostors as renderer-owned representation choices. Apps should not
author `DynamicImpostorNode`, billboard nodes, per-object switch distances, page
cache handles, shader defines, or backend feature flags.

The public scene remains ordinary asset instances. The renderer consumes asset
manifests, material resources, camera packets, and visibility packets, then
emits private draw/residency decisions.

## Inputs

The automatic policy consumes asset and frame facts:

- Source mesh rows: asset id, mesh refs, material refs, bounds, animation flags,
  nonuniform-scale support, triangle counts, and geometric/silhouette error
  metrics per representation candidate.
- Impostor atlas rows: octahedral or billboard kind, texture refs, direction
  count, page groups, alpha/depth/normal metadata, padding, and fallback
  compatibility.
- Texture residency budgets: physical page slots, page size, upload bytes,
  uploads per frame, fallback labels, and material texture budget class.
- Camera packets: camera position, forward vector, viewport height, and field
  of view.
- Visibility packets: stable object id, asset id, world bounds/transform,
  visibility state, occlusion certainty, material slot, and transform revision.

These are renderer/asset inputs, not reusable scene nodes. Distance-like switch
points are derived from screen error, projected size, bounds, and budgets.

## Private Outputs

The policy emits renderer-private packets:

- `representation`: `meshHigh`, `meshMid`, `octahedral`, `billboard`, or
  `culled`.
- `meshLod`: selected mesh artifact when the representation is mesh-backed.
- `transition`: previous representation, next representation, cross-fade mode,
  stable depth policy, and fade frame count.
- `requestedAtlasPages`: atlas page ids needed by selected impostors.
- `fallbackQuality`: renderer label for page misses or unsupported features.
- `batchKey`: private instancing/binning key.
- `depthPolicy` and `sortKey`: alpha/depth ordering policy for renderer bins.
- `churn`: whether a packet changed representation this frame.

The packet shape is intentionally backend-private. It can lower to WebGL2
instanced quads and page-table textures now, or WebGPU storage-buffer/indirect
paths later.

## Selection Loop

1. Start from renderer visibility packets, not app traversal.
2. Inflate bounds by the maximum transform scale axis. Label nonuniform scale
   because octahedral depth/normal impostors may be invalid under shear or
   uneven axes.
3. Compute projected diameter and screen error for each candidate from asset
   error metrics and the camera packet.
4. Reject unsupported candidates: static impostors for skinned/animated assets,
   octahedral impostors for unsupported nonuniform scales, or WebGPU-only paths
   under WebGL2.
5. Pick the lowest-cost candidate inside the screen-error budget. If none fit,
   degrade to the highest-detail supported mesh candidate.
6. Apply hysteresis: coarsening must be comfortably inside the error budget,
   refinement must exceed the budget by a margin, and a pending candidate must
   be stable for multiple frames.
7. Emit transition metadata for representation changes. Do not snap directly
   across mesh/impostor/billboard boundaries.
8. Schedule atlas page residency from private page requests. Current-frame
   misses get labeled fallback quality while uploads are queued under budget.

## Edge Cases

- Camera hysteresis: small camera jitter near a boundary must not alternate
  mesh and impostor packets every frame.
- Transition popping: every representation switch needs a depth-stable
  cross-fade window and previous-representation carry.
- Alpha/depth ordering: foliage impostors need explicit alpha-tested depth
  policy, depth-page use where available, and stable per-cell sort keys.
- Terrain/object occlusion uncertainty: uncertain occlusion is conservative.
  The renderer may lower priority, but it must not create false-negative culls.
- Memory pressure: page misses are allowed under tight budgets, but packets
  must report fallback quality and queued page demand.
- Atlas page misses: octahedral misses can temporarily fall back to billboard;
  billboard misses can fall back to a coarse bounds card.
- Nonuniform scales: bounds use max-axis inflation. Octahedral candidates are
  skipped unless the atlas declares support for nonuniform transforms.
- Animated/skinned objects: static impostors are unsupported in this slice.
  They degrade to mesh LOD with diagnostics until a live-regeneration or
  animation-aware impostor path exists.
- Batching/instancing pressure: selected packets are grouped by private batch
  keys; selection cost must account for draw packet bins, not just triangles.
- WebGL/WebGPU portability: WebGL2 starts with instanced quads and texture
  page-table resources. WebGPU can later replace selection/compaction with
  storage buffers and indirect draws without changing public scene shape.

## Validator

Run the automatic policy validator:

```sh
node research/dynamic-impostors/automatic-policy-validator.mjs --check
```

The check mode runs three deterministic cases:

- The proposed automatic fixture must pass.
- A naive no-hysteresis policy must fail.
- A fixture with a public per-object `DynamicImpostorNode`/threshold leak must
  fail.

The fixture and validator are deliberately CPU-only. They validate policy
boundary, churn, fallback labeling, unsupported/degraded assets, occlusion
conservatism, batching pressure, and private packet shape before any browser
renderer path exists.
