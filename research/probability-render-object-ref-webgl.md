# Proposal: honor render-object refs in the WebGL renderer

Status: accepted and implemented after a production-consumer integration check.

## Existing public contract

`mesh` and `gltf` descriptors already accept `RenderObjectRef`, and
renderer-core already implements shared, lifecycle-safe
`attachRenderObjectRef()` handles with `setTransform()`. The React surface also
re-exports that contract. The current renderer-webgl source does not attach
either descriptor's ref, so object and glTF refs remain `null` after the node is
drawn.

This is observable with an ordinary ref object on either one mesh or one glTF
node. Probability currently detects the missing handle and falls back to
republishing its complete declarative scene during pointer-rate drags. That
keeps interaction correct but defeats the API's intended high-frequency local
transform path.

## Desired renderer property

The WebGL root should honor the existing descriptor contract:

- publish one handle after a mesh or glTF node is attached;
- apply `setTransform()` to the attached render object and invalidate a frame
  without requiring a new scene descriptor or whole-scene reconciliation;
- reconcile a later declarative transform with the handle;
- clear the ref when its final attachment is removed; and
- preserve renderer-core's defined shared-ref, callback, failure, reentrancy,
  and detach behavior.

This is a general animation and direct-manipulation primitive. It needs no
Probability drag protocol, presence state, or renderer-specific consumer flag.
Royal should choose the WebGL ownership point which can update the existing
object/GPU transform without introducing a second scene path.

## Acceptance evidence

1. Object and callback refs become non-null for both `mesh` and `gltf`, then
   return to null after final detach.
2. Repeated `setTransform()` calls produce rendered movement while scene
   descriptor identity stays unchanged.
3. A later declarative transform becomes authoritative and the handle reports
   the reconciled value.
4. Multiple attachments to the same ref retain the renderer-core lifecycle and
   invalidation semantics.
5. Picking observes the moved transform.
6. A browser fixture records one initial scene transaction and pointer-rate
   object updates, rather than one complete scene transaction per move.

## Adversarial review

- Do not add an app-owned animation loop or drag API to Royal.
- Do not publish a handle before the node has an attachment able to render and
  pick it.
- Do not retain detached roots merely to keep a ref alive.
- Do not implement mesh only: the public descriptor contract is the same
  consumer boundary for glTF pieces.
- Do not call support complete if only the core helper is tested while the
  WebGL descriptors still leave refs null.

## Royal decision

The WebGL root now reconciles `mesh` and `gltf` refs through renderer-core's
existing shared attachment authority. Scene replacement preserves a handle
when the same ref remains attached, declarative transforms synchronize that
handle, final detach clears it, and callback failures retain the core helper's
defined cleanup behavior while reporting through the root listener boundary.

Imperative changes enter one retained transform core. Cold lowering indexes
only ref-bearing nodes; a change updates the affected model/normal matrices,
world and LOD bounds, exact picking inverses, handedness, and authored glTF
light positions/directions. The WebGL shell refreshes only those retained draw
packets and light uniforms. Geometry, materials, textures, scene descriptors,
and GPU buffers are not recreated.

The optional multi-draw run planner now writes into exact caller-retained typed
storage when topology is unchanged. Pointer-rate transform updates therefore
do not exchange whole-scene work for typed-array garbage. Mesh, progressively
prepared glTF, object/callback/shared refs, declarative reconciliation,
negative-scale front-face state, exact picking, and one-scene-transaction
behavior have focused oracles.
