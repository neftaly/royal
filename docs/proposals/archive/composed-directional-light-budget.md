# Composing application and glTF directional lights

Status: imported-light control included in Royal 0.0.25, 2026-09-11. `gltf` and
`gltfInstances` now accept `importLights: false`; omitted or true preserves
embedded lighting. The option omits imported directional, point, and spot lights
per mount without changing asset identity or shared resources. Existing scene
light limits remain unchanged. The linked Play checkout now explicitly disables imported lights on model mounts. Larger-count architecture is covered
by [unlimited lights](../unlimited-lights.md).

## Problem

Royal's `MAX_CANONICAL_DIRECTIONAL_LIGHTS` is four. Authored scene lights and
lights imported through glTF share that limit. Scene lowering throws when it
encounters a fifth directional light, including when asynchronous glTF
preparation adds lights after the initial scene was accepted.

Probability Play supplies three directional lights: key, fill and a horizontal
south-side light. A model with two embedded directional lights therefore exceeds
the limit. Before the third application light, that same model fitted. Multiple
copies of a lit model can exhaust the budget too. Point/spot lights have separate
limits and are not addressed by simply changing this directional-light constant.

Relevant implementation: `packages/renderer-webgl/src/surface/scene-lowering.ts`,
including `MAX_CANONICAL_DIRECTIONAL_LIGHTS`, imported-light expansion and direct
scene-light validation. This is a renderer composition limitation; Play should
not have to rewrite every imported glTF to avoid it.

## Desired outcome

Applications should be able to combine their lighting with arbitrary model assets
without an unexpected whole-scene failure after loading. Preserve authored-light
semantics by default and expose any deliberate omission or approximation. Avoid
silent truncation, load-order-dependent selection, and a separate Play-only path.

## Options to evaluate

1. **Explicit control of imported lighting.** Allow an application to use model
   geometry/materials with its own lighting, while retaining embedded lights by
   default. Investigate whether this belongs on a glTF node, a root policy, or a
   scene policy. Per-node control should not duplicate asset decoding or geometry
   caches. This is the smallest likely solution for a tabletop application.
2. **Increase the supported exact count.** Measure shader compile time, feature
   keys, uniform limits and fragment cost on constrained GPUs before choosing a
   new ceiling. Raising four to another finite number only postpones overflow;
   repeated model instances still need defined behaviour.
3. **Explicit bounded selection or another lighting architecture.** Investigate
   stable light prioritisation or additional passes only if exact composition is
   required. Specify diagnostics and transitions as assets arrive or move. Do not
   approximate excess directional lights as ambient without measuring the loss of
   directionality and specular response.

Recommendation: prototype explicit imported-light control first, alongside an
exact-count benchmark. Keep the existing error until an intentional policy is
selected; do not implement silent light dropping as a quick fix.

## Acceptance criteria

- Cover three application lights plus models containing zero, one and two
  directional lights, both initially resident and asynchronously loaded.
- Cover multiple instances, asset replacement/removal, transforms and render
  object handles; light ownership and order must remain deterministic.
- Test that imported-light control preserves geometry, materials, picking and
  shared-resource reuse, and that its default retains existing asset semantics.
- Exercise point/spot lights and mixed light types to prevent accidental changes
  to their independent budgets.
- Verify live views, history/secondary roots, XR views and context restoration.
- If selection is introduced, expose which lights were omitted and why; identical
  scenes must produce identical results regardless of asset completion order.
- Benchmark cold shader preparation and steady rendering on desktop and a
  constrained physical device. No claimed performance benefit from mock tests.

`importLights` is the implemented per-mount control. Higher-count policy remains
undecided. This proposal does not authorise
changing Play's three-light setup or silently disabling lights in existing assets.
