# Proposal: explicit non-visual glTF asset claims

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

