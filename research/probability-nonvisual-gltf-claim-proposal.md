# Proposal: explicit non-visual glTF asset claims

Status: accepted and implemented.

Royal exposes the validated `gltfAsset(...)` identity constructor,
`<Canvas gltfAssetClaims={...}>`, and
`RendererRoot.setGltfAssetClaims(...)`. These are complete ownership lists,
not observation, invisible nodes, or an immortal preload cache. Visual and
non-visual use shares one keyed preparation entry and can hand off before or
after settlement without another read. React uses the root's atomic
scene-and-claim commit; imperative hosts either use that commit or install the
incoming owner before removing the outgoing one.

The original motivating placement description used prepared AABB extrema. That
is intentionally not the long-term contact contract. Royal's bounds are
conservative framing/coarse-layout/broad-phase data. Probability should use
`visitGltfAssetGeometry` / `useVisitGltfAssetGeometry` to build and own the
minimal support representation its placement model needs. That cold visitor
borrows Royal's already-prepared highest-detail indexed positions and packed
asset-space transforms without another source read, mesh copy, or retained
renderer representation.

## Consumer need

Royal now exposes authoritative prepared bounds and uninterpreted root extras
through `GltfAssetSnapshot`. Some consumers need those values before they can
construct a correctly placed visible node.

Probability stores a supported piece as `[x, null, z]`. Its Y position is
derived from the prepared bounds of that piece and its support. It therefore
cannot emit the final visible glTF transform until Royal has prepared both
assets. `useGltfAssetStatus()` observes an existing claim but deliberately does
not create one, so omitting the unresolved visible node leaves the asset idle.

This also occurs in camera fitting, asset browsers, metadata-driven layout and
editors which inspect an asset before adding it to the visible scene.

## Requested primitive

Consider one explicit, non-visual glTF asset claim using the same
source/version/selected-scene identity and lifecycle as a normal glTF node. The
exact API shape belongs to Royal. Useful semantics are:

- starts ordinary bounded Royal preparation;
- publishes through the existing focused asset snapshot;
- creates no surface, draw, light, picking or transform work;
- is cancelled/released when the claim disappears unless another visual or
  non-visual claim for that exact asset remains; and
- changing from the non-visual claim to a visible node reuses the same prepared
  asset without another read or preparation.

This should not make status observation itself claim resources. Observation and
ownership remain separate. It also should not require consumers to invent
declared bounds, transparent materials, zero-scale instances, off-screen
transforms or placeholder scene geometry.

Possible designs include a declarative asset-claim descriptor or a focused
root/React claim primitive. A general `visible: false` scene-node feature could
cover the use case only if it truly avoids surface, lighting and picking work;
otherwise it is a larger hot-path contract than the asset claim requires.

## Why this belongs in Royal

Royal owns preparation deduplication, scheduling, cancellation and retained
asset lifetime. Recreating those semantics in each host would either add a
second loader or depend on invisible rendering tricks. The claim is renderer
resource intent, not Probability gameplay state or a document protocol.

## Suggested acceptance evidence

1. A non-visual claim moves an asset from idle to a drawable snapshot containing
   bounds and root extras without submitting a surface.
2. Removing the last claim cancels pending preparation and releases settled
   ownership according to Royal's normal policy.
3. Adding a visible node with the same identity before or after preparation
   performs one root read and one preparation.
4. Authenticated/custom `gltfResourceReader` transport follows the same path.
5. A browser frame captured while only the claim exists contains no asset
   geometry, punctual lights or picking target.

## Adversarial resolution

- Status subscribers remain non-owning; otherwise mounting an observer would
  silently alter transport and retention.
- A general hidden-node flag is rejected because it enlarges scene, picking,
  lighting, and culling contracts.
- A permanent preload cache is rejected because it obscures cancellation and
  memory lifetime.
- Per-component retain/release is not the React surface because effect cleanup
  and Strict Mode remounts can cause avoidable abort/restart churn. `Canvas`
  instead reconciles one complete declarative list.
- Equivalent regenerated React descriptors compare by exact loading identity,
  so they do not restart preparation.
- Non-visual completion does not lower or invalidate the scene.
- Image decode remains visible-material demand. A textured non-visual claim can
  remain `streaming` with usable geometry and metadata until it becomes
  visible.
- The geometry visitor is deliberately cold and borrowed. Consumers pay only
  for the specialized compact structure they choose to retain; Royal does not
  add a second collision/support mesh or per-frame allocation.
